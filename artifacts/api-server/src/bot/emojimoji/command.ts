// ─────────────────────────────────────────────────────────────────────────────
// /emojimoji — turn any image into an animated emote, with a full picker UI.
//
// Flow: run the command → an ephemeral "board" shows a page of 4-5 animated
// previews (each numbered 1-5) rendered over the current target image. Buttons:
//   • 1-5   — highlight / select which animation to send
//   • ◀ ▶   — page through the rest of the animations
//   • 👤 User   — pick a member (native user select) → previews retarget to their avatar
//   • 🏠 Server — pick a shared server → previews retarget to your server avatar there
//   • 🖼️ Image  — paste an image URL (device uploads use the /emojimoji image: option)
//   • ✅ Send    — post the highlighted animation to the channel, as the user
//
// The animations are templates extracted from the uploaded emoji packs and
// replayed over the target image (see effects.ts). Send posts the gif through a
// channel webhook wearing the member's name + avatar, so it reads as theirs.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, MessageFlags,
  type ChatInputCommandInteraction, type StringSelectMenuInteraction,
  type UserSelectMenuInteraction, type ButtonInteraction, type ModalSubmitInteraction,
  type MessageComponentInteraction, type Interaction, type TextBasedChannel,
  type Webhook, type Collection,
} from "discord.js";
import sharp from "sharp";
import { EMOJI_EFFECTS, renderEmojiGif, SRC_MAX } from "./effects.js";
import { logger } from "../../lib/logger.js";

const PER_PAGE = 5;
const PAGES = Math.max(1, Math.ceil(EMOJI_EFFECTS.length / PER_PAGE));
const NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
const TTL = 10 * 60 * 1000;
/** Discord CDN avatar size — nearest power-of-two ≥ SRC_MAX so we don't fetch soft 256s. */
const AVATAR_SIZE = 512;

interface Session {
  userId: string;
  expires: number;
  targetUrl: string;
  targetLabel: string;         // human label of the current target, e.g. "@Alice"
  src: Buffer | null;          // fetched + normalized source frame
  version: number;             // bumps whenever the target changes (cache key)
  page: number;
  selected: string;            // effect id currently highlighted
  cache: Map<string, Buffer>;  // `${version}:${effectId}` → rendered preview gif
}
const sessions = new Map<string, Session>();

function token(): string { return Math.random().toString(36).slice(2, 10); }
function sweep(): void { const now = Date.now(); for (const [k, s] of sessions) if (s.expires < now) sessions.delete(k); }
function pageEffects(page: number) { return EMOJI_EFFECTS.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE); }
function avatarUrl(user: { displayAvatarURL: (o: { extension: "png"; size: number }) => string }): string {
  return user.displayAvatarURL({ extension: "png", size: AVATAR_SIZE });
}

// ── source resolution ────────────────────────────────────────────────────────
function resolveSource(interaction: ChatInputCommandInteraction): { url: string; label: string } | null {
  const att = interaction.options.getAttachment("image");
  if (att) {
    if (att.contentType && !att.contentType.startsWith("image/")) return null;
    return { url: att.url, label: "your upload" };
  }
  const user = interaction.options.getUser("user");
  if (user) return { url: avatarUrl(user), label: `@${user.username}` };
  const url = interaction.options.getString("url");
  if (url) return /^https?:\/\//i.test(url) ? { url, label: "that image" } : null;
  return { url: avatarUrl(interaction.user), label: "your avatar" };
}

/** Normalize a source buffer: keep native size when already ≤ SRC_MAX, never
 *  upscale, only downscale large inputs, always emit PNG with alpha. */
export async function normalizeSource(buf: Buffer): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 1, h = meta.height ?? 1;
  const longest = Math.max(w, h);
  let pipeline = sharp(buf).ensureAlpha();
  if (longest > SRC_MAX) {
    pipeline = pipeline.resize(SRC_MAX, SRC_MAX, { fit: "inside", withoutEnlargement: true });
  }
  return pipeline.png().toBuffer();
}

// Download the source and normalize it for the encoder (see normalizeSource).
async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 12_000_000) return null;
    return await normalizeSource(buf);
  } catch { return null; }
}

async function ensureSrc(s: Session): Promise<boolean> {
  if (s.src) return true;
  s.src = await fetchImage(s.targetUrl);
  return !!s.src;
}

async function previewFor(s: Session, effectId: string): Promise<Buffer | null> {
  const key = `${s.version}:${effectId}`;
  const hit = s.cache.get(key);
  if (hit) return hit;
  if (!s.src) return null;
  const gif = await renderEmojiGif(s.src, effectId);
  if (gif) s.cache.set(key, gif);
  return gif;
}

// Fire-and-forget: render not-yet-cached effects in the background (bounded
// concurrency) so paging and Send rarely wait. Adjacent pages are prioritized.
const prewarming = new Set<string>();
function prewarm(s: Session): void {
  if (!s.src) return;
  const version = s.version;
  const tag = `${s.userId}:${version}`;
  if (prewarming.has(tag)) return;
  prewarming.add(tag);
  void (async () => {
    const cached = (id: string) => s.cache.has(`${version}:${id}`);
    const near = [s.page - 1, s.page + 1]
      .filter((p) => p >= 0 && p < PAGES)
      .flatMap((p) => pageEffects(p))
      .filter((e) => !cached(e.id));
    const rest = EMOJI_EFFECTS.filter((e) => !cached(e.id) && !near.some((n) => n.id === e.id));
    const pending = [...near, ...rest];
    const LIMIT = 3; // keep CPU calm while prewarming larger 128px GIFs
    for (let i = 0; i < pending.length; i += LIMIT) {
      if (s.version !== version) break; // target changed — abandon
      await Promise.all(pending.slice(i, i + LIMIT).map((e) => previewFor(s, e.id).catch(() => null)));
    }
    prewarming.delete(tag);
  })();
}

// ── screen builders ──────────────────────────────────────────────────────────
type Screen = Parameters<ButtonInteraction["editReply"]>[0];

function boardComponents(s: Session, tok: string, effs: typeof EMOJI_EFFECTS) {
  const numRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...effs.map((eff, i) =>
      new ButtonBuilder()
        .setCustomId(`emojimoji:num:${tok}:${i}`)
        .setLabel(String(i + 1))
        .setStyle(eff.id === s.selected ? ButtonStyle.Primary : ButtonStyle.Secondary)),
  );
  const pageRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`emojimoji:page:${tok}:p`).setEmoji("◀️").setStyle(ButtonStyle.Secondary).setDisabled(s.page === 0),
    new ButtonBuilder().setCustomId(`emojimoji:noop:${tok}`).setLabel(`Page ${s.page + 1}/${PAGES}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`emojimoji:page:${tok}:n`).setEmoji("▶️").setStyle(ButtonStyle.Secondary).setDisabled(s.page >= PAGES - 1),
  );
  const srcRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`emojimoji:user:${tok}`).setEmoji("👤").setLabel("User").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`emojimoji:server:${tok}`).setEmoji("🏠").setLabel("Server").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`emojimoji:image:${tok}`).setEmoji("🖼️").setLabel("Image").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`emojimoji:send:${tok}`).setEmoji("✅").setLabel("Send").setStyle(ButtonStyle.Success),
  );
  return [numRow, pageRow, srcRow];
}

function boardEmbeds(s: Session, effs: typeof EMOJI_EFFECTS, gifs: (Buffer | null | undefined)[]): EmbedBuilder[] {
  const embeds: EmbedBuilder[] = [];
  for (let i = 0; i < effs.length; i++) {
    const eff = effs[i]!;
    const gif = gifs[i];
    const name = `p${i}.gif`;
    const isSel = eff.id === s.selected;
    const embed = new EmbedBuilder()
      .setColor(isSel ? 0x57f287 : 0x2b2d31)
      .setTitle(`${NUM_EMOJI[i]} ${eff.emoji} ${eff.name}${isSel ? "  ✅" : ""}`)
      .setDescription(eff.desc);
    if (i === 0) embed.setAuthor({ name: `Emojimoji · target: ${s.targetLabel} · page ${s.page + 1}/${PAGES}` });
    if (gif) embed.setImage(`attachment://${name}`);
    embeds.push(embed);
  }
  return embeds;
}

function boardFiles(gifs: (Buffer | null | undefined)[]): AttachmentBuilder[] {
  const files: AttachmentBuilder[] = [];
  for (let i = 0; i < gifs.length; i++) {
    const gif = gifs[i];
    if (gif) files.push(new AttachmentBuilder(gif, { name: `p${i}.gif` }));
  }
  return files;
}

async function buildBoard(s: Session, tok: string): Promise<Screen> {
  if (!(await ensureSrc(s))) {
    return { content: "❌ Couldn't read that image. Try a PNG/JPG/GIF, a member, or a valid image URL.", embeds: [], components: [], files: [] };
  }
  const effs = pageEffects(s.page);
  if (!effs.some((e) => e.id === s.selected)) s.selected = effs[0]!.id;

  // Render this page's previews (cache hits are instant). Promise.all overlaps
  // sheet I/O; GIF encode itself is CPU-bound on the main thread.
  const gifs = await Promise.all(effs.map((eff) => previewFor(s, eff.id)));
  prewarm(s); // adjacent pages first, then the rest — ◀ ▶ and Send stay instant

  return {
    content: `🪄 **Emojimoji** — pick a number to highlight an animation, page through with ◀ ▶, then **Send**. Change the target with 👤 / 🏠 / 🖼️.`,
    embeds: boardEmbeds(s, effs, gifs),
    files: boardFiles(gifs),
    components: boardComponents(s, tok, effs),
  };
}

/** Selection-only update: refresh embed colours / buttons without re-uploading
 *  GIFs when every preview on this page is already cached. Existing message
 *  attachments are retained by id so Discord doesn't drop the images. */
function buildBoardChrome(s: Session, tok: string, interaction: ButtonInteraction): Screen | null {
  const effs = pageEffects(s.page);
  if (!effs.some((e) => e.id === s.selected)) s.selected = effs[0]!.id;
  if (effs.some((e) => !s.cache.has(`${s.version}:${e.id}`))) return null;
  // Rebuild embeds pointing at the same attachment://pN.gif names already on the message.
  const gifs = effs.map((e) => s.cache.get(`${s.version}:${e.id}`) ?? null);
  const keep = [...interaction.message.attachments.values()].map((a) => ({ id: a.id }));
  return {
    content: `🪄 **Emojimoji** — pick a number to highlight an animation, page through with ◀ ▶, then **Send**. Change the target with 👤 / 🏠 / 🖼️.`,
    embeds: boardEmbeds(s, effs, gifs),
    components: boardComponents(s, tok, effs),
    ...(keep.length ? { attachments: keep } : {}),
  };
}

// Swap the board out for a picker sub-screen (user select / server select).
function pickerScreen(content: string, row: ActionRowBuilder<UserSelectMenuBuilder | StringSelectMenuBuilder>, tok: string): Screen {
  const back = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`emojimoji:back:${tok}`).setEmoji("↩️").setLabel("Back").setStyle(ButtonStyle.Secondary),
  );
  return { content, embeds: [], files: [], components: [row as ActionRowBuilder<never>, back] };
}

// ── entry point ──────────────────────────────────────────────────────────────
export async function handleEmojimoji(interaction: ChatInputCommandInteraction): Promise<void> {
  sweep();
  const src = resolveSource(interaction);
  if (!src) {
    await interaction.reply({ content: "❌ Give me an image — an upload, a member, or an image URL.", flags: MessageFlags.Ephemeral });
    return;
  }
  const tok = token();
  sessions.set(tok, {
    userId: interaction.user.id, expires: Date.now() + TTL,
    targetUrl: src.url, targetLabel: src.label, src: null, version: 0,
    page: 0, selected: EMOJI_EFFECTS[0]!.id, cache: new Map(),
  });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const s = sessions.get(tok)!;

  // Progressive first paint: show the selected effect as soon as it's ready,
  // then fill the rest of the page. Feels much snappier on a cold cache.
  if (!(await ensureSrc(s))) {
    await interaction.editReply({ content: "❌ Couldn't read that image. Try a PNG/JPG/GIF, a member, or a valid image URL.", embeds: [], components: [], files: [] });
    return;
  }
  const effs = pageEffects(s.page);
  if (!effs.some((e) => e.id === s.selected)) s.selected = effs[0]!.id;
  const firstId = s.selected;
  const firstGif = await previewFor(s, firstId);
  const partialGifs = effs.map((e) => (e.id === firstId ? firstGif : null));
  await interaction.editReply({
    content: `🪄 **Emojimoji** — pick a number to highlight an animation, page through with ◀ ▶, then **Send**. Change the target with 👤 / 🏠 / 🖼️.`,
    embeds: boardEmbeds(s, effs, partialGifs),
    files: boardFiles(partialGifs),
    components: boardComponents(s, tok, effs),
  });
  await interaction.editReply(await buildBoard(s, tok));
}

// ── unified component/modal router (registered in index.ts) ────────────────────
export async function handleEmojimojiInteraction(interaction: Interaction): Promise<void> {
  if (!("customId" in interaction)) return;
  const parts = interaction.customId.split(":");
  const action = parts[1] ?? "";
  const tok = parts[2] ?? "";
  const s = sessions.get(tok);

  const expired = async () => {
    const msg = { content: "⌛ That emojimoji session expired — run `/emojimoji` again.", flags: MessageFlags.Ephemeral } as const;
    if (interaction.isModalSubmit() || interaction.isMessageComponent()) await interaction.reply(msg);
  };
  if (!s || s.userId !== interaction.user.id) { await expired(); return; }
  s.expires = Date.now() + TTL;

  try {
    // Modal submit: image URL entered.
    if (interaction.isModalSubmit()) {
      const url = interaction.fields.getTextInputValue("url").trim();
      if (!/^https?:\/\/\S+$/i.test(url)) {
        await interaction.reply({ content: "❌ That doesn't look like an image URL.", flags: MessageFlags.Ephemeral });
        return;
      }
      retarget(s, url, "that image");
      await interaction.deferUpdate();
      await interaction.editReply(await buildBoard(s, tok));
      return;
    }

    // Native user picker result.
    if (interaction.isUserSelectMenu()) {
      await interaction.deferUpdate();
      const userId = interaction.values[0];
      const user = interaction.users.first()
        ?? (userId ? await interaction.client.users.fetch(userId).catch(() => null) : null);
      if (!user) {
        await interaction.editReply({
          content: "❌ I couldn't read that member. Please choose them again.",
          embeds: [],
          files: [],
          components: [],
        });
        return;
      }
      retarget(s, avatarUrl(user), `@${user.username}`);
      await interaction.editReply(await buildBoard(s, tok));
      return;
    }

    // Server picker result.
    if (interaction.isStringSelectMenu()) {
      const guildId = interaction.values[0]!;
      const guild = interaction.client.guilds.cache.get(guildId);
      const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
      const url = member
        ? avatarUrl(member)
        : (guild?.iconURL({ extension: "png", size: AVATAR_SIZE }) ?? null);
      if (url) retarget(s, url, `🏠 ${guild?.name ?? "server"}`);
      await interaction.deferUpdate();
      await interaction.editReply(await buildBoard(s, tok));
      return;
    }

    if (!interaction.isButton()) return;

    switch (action) {
      case "num": {
        const idx = Number(parts[3] ?? 0);
        const eff = pageEffects(s.page)[idx];
        if (eff) s.selected = eff.id;
        await interaction.deferUpdate();
        const chrome = buildBoardChrome(s, tok, interaction);
        await interaction.editReply(chrome ?? await buildBoard(s, tok));
        return;
      }
      case "page": {
        s.page = Math.min(PAGES - 1, Math.max(0, s.page + (parts[3] === "n" ? 1 : -1)));
        await interaction.deferUpdate();
        await interaction.editReply(await buildBoard(s, tok));
        return;
      }
      case "user": {
        const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
          new UserSelectMenuBuilder().setCustomId(`emojimoji:uspick:${tok}`).setPlaceholder("Search for a member…").setMaxValues(1),
        );
        await interaction.update(pickerScreen("👤 **Pick a member** — their avatar becomes the target.", row, tok));
        return;
      }
      case "server": {
        await interaction.update(serverPicker(interaction, tok));
        return;
      }
      case "image": {
        const modal = new ModalBuilder().setCustomId(`emojimoji:imgmodal:${tok}`).setTitle("Animate an image URL");
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("url").setLabel("Image URL (PNG/JPG/GIF)").setPlaceholder("https://…").setStyle(TextInputStyle.Short).setRequired(true),
        ));
        await interaction.showModal(modal);
        return;
      }
      case "back": {
        await interaction.deferUpdate();
        await interaction.editReply(await buildBoard(s, tok));
        return;
      }
      case "send": {
        await sendSelected(interaction, s, tok);
        return;
      }
      default:
        await interaction.deferUpdate();
    }
  } catch (err) {
    logger.error({ err }, "emojimoji: interaction failed");
    if (interaction.isMessageComponent() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ Something went wrong. Try again.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

function retarget(s: Session, url: string, label: string): void {
  s.targetUrl = url; s.targetLabel = label; s.src = null; s.version += 1; s.cache.clear();
}

function serverPicker(interaction: ButtonInteraction, tok: string): Screen {
  // Offer servers the bot shares with the user (at minimum the current one).
  const options: { label: string; value: string; description?: string }[] = [];
  const seen = new Set<string>();
  const add = (id: string, name: string) => { if (!seen.has(id) && options.length < 25) { seen.add(id); options.push({ label: name.slice(0, 100), value: id }); } };
  if (interaction.guild) add(interaction.guild.id, interaction.guild.name);
  for (const g of interaction.client.guilds.cache.values()) {
    if (g.members.cache.has(interaction.user.id)) add(g.id, g.name);
  }
  if (!options.length) {
    const back = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`emojimoji:back:${tok}`).setEmoji("↩️").setLabel("Back").setStyle(ButtonStyle.Secondary),
    );
    return { content: "🏠 No shared servers to pull an avatar from here. Use 👤 User or 🖼️ Image instead.", embeds: [], files: [], components: [back] };
  }
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(`emojimoji:svpick:${tok}`).setPlaceholder("Choose a server…").addOptions(options),
  );
  return pickerScreen("🏠 **Pick a server** — your avatar there becomes the target.", row, tok);
}

async function sendSelected(interaction: ButtonInteraction, s: Session, tok: string): Promise<void> {
  const eff = EMOJI_EFFECTS.find((e) => e.id === s.selected);
  const channel = interaction.channel as TextBasedChannel | null;
  if (!channel || !("send" in channel)) {
    await interaction.reply({ content: "❌ I can't post here.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  const gif = await previewFor(s, s.selected);
  if (!gif) { await interaction.editReply({ content: "❌ Couldn't render that one — pick another.", embeds: [], files: [], components: [] }); return; }
  const file = new AttachmentBuilder(gif, { name: "emojimoji.gif" });
  try {
    // Post the gif on its own AS THE USER (webhook impersonation) — no bot name,
    // no caption, so it reads like an emoji the member dropped in the channel.
    const asUser = await postAsUser(interaction, file);
    if (!asUser) {
      // No webhook permission — fall back to a plain bot post of just the gif.
      await channel.send({ files: [file] });
    }
    await interaction.editReply({ content: `✅ Sent **${eff?.name ?? "your animation"}**!`, embeds: [], files: [], components: [] });
    sessions.delete(tok);
  } catch (err) {
    logger.error({ err }, "emojimoji: send failed");
    await interaction.editReply({ content: "❌ Couldn't post it — do I have permission to send here?" });
  }
}

const WEBHOOK_NAME = "Emojimoji";

interface WebhookHost {
  fetchWebhooks(): Promise<Collection<string, Webhook>>;
  createWebhook(options: { name: string }): Promise<Webhook>;
}

// Post the gif AS the invoking member — a channel webhook wearing their display
// name + avatar — so it appears to come from them, not the bot. Returns true on
// success, or null when webhooks aren't available (missing Manage Webhooks, DMs,
// unsupported channel) so the caller can fall back to a plain post.
async function postAsUser(interaction: ButtonInteraction, file: AttachmentBuilder): Promise<boolean | null> {
  const ch = interaction.channel as unknown as {
    isThread?: () => boolean; id: string; parent?: unknown;
  } | null;
  if (!ch || !interaction.guild) return null;

  // Webhooks live on the parent channel; posts into a thread pass threadId.
  let host = ch as unknown as WebhookHost | null;
  let threadId: string | undefined;
  if (typeof ch.isThread === "function" && ch.isThread()) { host = (ch.parent as WebhookHost) ?? null; threadId = ch.id; }
  if (!host || typeof host.fetchWebhooks !== "function" || typeof host.createWebhook !== "function") return null;

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const username = (member?.displayName ?? interaction.user.username).slice(0, 80);
  const avatarURL = (member ?? interaction.user).displayAvatarURL({ extension: "png", size: 128 });

  try {
    const hooks = await host.fetchWebhooks();
    let hook = hooks.find((w) => w.owner?.id === interaction.client.user?.id && w.name === WEBHOOK_NAME && !!w.token);
    if (!hook) hook = await host.createWebhook({ name: WEBHOOK_NAME });
    await hook.send({ username, avatarURL, files: [file], ...(threadId ? { threadId } : {}) });
    return true;
  } catch (err) {
    logger.warn({ err }, "emojimoji: webhook post unavailable, using fallback");
    return null;
  }
}
