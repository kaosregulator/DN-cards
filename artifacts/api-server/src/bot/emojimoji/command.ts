// ─────────────────────────────────────────────────────────────────────────────
// /postmojidashboard — admin dashboard that turns any image (upload, member,
// URL, or a live Giphy search) into an animated emote and posts it to a channel
// of the admin's choosing. Successor to /emojimoji.
//
// Board (ephemeral, admin-only):
//   • 1-5 / ◀ ▶            pick + page the emoji-pack animations
//   • 👤 / 🏠 / 🖼️          retarget the source (member / server / image URL)
//   • 🔎 Search            live Giphy GIF search → use a result as the source
//   • 🟩 Green screen      live Giphy green-screen search → chroma-key overlay
//   • ⬇️ Download           get the finished GIF as an ephemeral file
//   • 📤 Post               choose a channel → post the finished GIF there
//
// Emoji-pack animations are templates replayed over the source (effects.ts).
// Green-screen mode keys out the green of a Giphy GIF and composites it over the
// source (greenscreen.ts). The Giphy key is a deployment secret (GIPHY_API_KEY).
// ─────────────────────────────────────────────────────────────────────────────

import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  StringSelectMenuBuilder, UserSelectMenuBuilder, ChannelSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, ChannelType,
  PermissionsBitField,
  type ChatInputCommandInteraction, type ButtonInteraction,
  type Interaction, type TextBasedChannel, type GuildTextBasedChannel,
  type MessageComponentInteraction, type Message, type Collection,
} from "discord.js";
import sharp from "sharp";
import { EMOJI_EFFECTS, renderEmojiGif, SRC_MAX } from "./effects.js";
import { renderGreenScreenGif, decodeGifFrames } from "./greenscreen.js";
import { searchGifs, giphyConfigured, type GiphyGif } from "./giphy.js";
import { isAdmin } from "../db.js";
import { logger } from "../../lib/logger.js";

const CID = "pmd"; // component customId namespace
const PER_PAGE = 5;
const PAGES = Math.max(1, Math.ceil(EMOJI_EFFECTS.length / PER_PAGE));
const NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
const TTL = 10 * 60 * 1000;
const AVATAR_SIZE = 512;
const GIPHY_LIMIT = 5;

type Mode = "effect" | "greenscreen";

interface Session {
  userId: string;
  expires: number;
  targetUrl: string;
  targetLabel: string;
  src: Buffer | null;          // fetched + normalized source frame
  version: number;             // bumps whenever the target changes (cache key)
  page: number;
  selected: string;            // effect id currently highlighted
  cache: Map<string, Buffer>;  // `${version}:${effectId}` → rendered preview gif
  mode: Mode;
  results: GiphyGif[];         // last Giphy search results (source or green-screen)
  gsBuf: Buffer | null;        // fetched green-screen gif bytes
  gsTitle: string;             // label of the chosen green-screen gif
  gsCache: Map<string, Buffer>; // `${version}` → composited green-screen gif
}
const sessions = new Map<string, Session>();

function token(): string { return Math.random().toString(36).slice(2, 10); }
function sweep(): void { const now = Date.now(); for (const [k, s] of sessions) if (s.expires < now) sessions.delete(k); }
function pageEffects(page: number) { return EMOJI_EFFECTS.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE); }
function avatarUrl(user: { displayAvatarURL: (o: { extension: "png"; size: number }) => string }): string {
  return user.displayAvatarURL({ extension: "png", size: AVATAR_SIZE });
}

// ── admin gate ─────────────────────────────────────────────────────────────
// Owner OR Discord Administrator OR admin_users row — same acceptance as the
// rest of the app's admin surfaces.
async function isPostmojiAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) return true;
  return isAdmin(interaction.guild.id, interaction.user.id).catch(() => false);
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

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 12_000_000) return null;
    return await normalizeSource(buf);
  } catch { return null; }
}

/** Fetch raw bytes (unnormalized) — used for the animated green-screen GIF. */
async function fetchBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length <= 20_000_000 ? buf : null;
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

async function greenScreenPreview(s: Session): Promise<Buffer | null> {
  if (!s.gsBuf) return null;
  const key = `${s.version}`;
  const hit = s.gsCache.get(key);
  if (hit) return hit;
  if (!(await ensureSrc(s)) || !s.src) return null;
  const gif = await renderGreenScreenGif(s.src, s.gsBuf);
  if (gif) s.gsCache.set(key, gif);
  return gif;
}

// Prewarm effect previews in the background so paging / actions rarely wait.
const prewarming = new Set<string>();
function prewarm(s: Session): void {
  if (!s.src || s.mode !== "effect") return;
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
    const LIMIT = 3;
    for (let i = 0; i < pending.length; i += LIMIT) {
      if (s.version !== version) break;
      await Promise.all(pending.slice(i, i + LIMIT).map((e) => previewFor(s, e.id).catch(() => null)));
    }
    prewarming.delete(tag);
  })();
}

// ── screen builders ──────────────────────────────────────────────────────────
type Screen = Parameters<ButtonInteraction["editReply"]>[0];

const HINT = "🪄 **Postmoji** — pick an animation, or 🔎 search / 🟩 green screen, then ⬇️ Download or 📤 Post to a channel.";

function actionRow(s: Session, tok: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CID}:download:${tok}`).setEmoji("⬇️").setLabel("Download").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${CID}:post:${tok}`).setEmoji("📤").setLabel("Post to channel").setStyle(ButtonStyle.Success),
  );
}

function boardComponents(s: Session, tok: string, effs: typeof EMOJI_EFFECTS) {
  const numRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...effs.map((eff, i) =>
      new ButtonBuilder()
        .setCustomId(`${CID}:num:${tok}:${i}`)
        .setLabel(String(i + 1))
        .setStyle(eff.id === s.selected ? ButtonStyle.Primary : ButtonStyle.Secondary)),
  );
  const pageRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CID}:page:${tok}:p`).setEmoji("◀️").setStyle(ButtonStyle.Secondary).setDisabled(s.page === 0),
    new ButtonBuilder().setCustomId(`${CID}:noop:${tok}`).setLabel(`Page ${s.page + 1}/${PAGES}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`${CID}:page:${tok}:n`).setEmoji("▶️").setStyle(ButtonStyle.Secondary).setDisabled(s.page >= PAGES - 1),
  );
  const srcRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CID}:user:${tok}`).setEmoji("👤").setLabel("User").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${CID}:server:${tok}`).setEmoji("🏠").setLabel("Server").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${CID}:image:${tok}`).setEmoji("🖼️").setLabel("Image").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${CID}:search:${tok}`).setEmoji("🔎").setLabel("Search").setStyle(ButtonStyle.Secondary).setDisabled(!giphyConfigured()),
    new ButtonBuilder().setCustomId(`${CID}:green:${tok}`).setEmoji("🟩").setLabel("Green").setStyle(ButtonStyle.Secondary),
  );
  return [numRow, pageRow, srcRow, actionRow(s, tok)];
}

function boardEmbeds(s: Session, effs: typeof EMOJI_EFFECTS, gifs: (Buffer | null | undefined)[]): EmbedBuilder[] {
  const embeds: EmbedBuilder[] = [];
  for (let i = 0; i < effs.length; i++) {
    const eff = effs[i]!;
    const gif = gifs[i];
    const isSel = eff.id === s.selected;
    const embed = new EmbedBuilder()
      .setColor(isSel ? 0x57f287 : 0x2b2d31)
      .setTitle(`${NUM_EMOJI[i]} ${eff.emoji} ${eff.name}${isSel ? "  ✅" : ""}`)
      .setDescription(eff.desc);
    if (i === 0) embed.setAuthor({ name: `Postmoji · target: ${s.targetLabel} · page ${s.page + 1}/${PAGES}` });
    if (gif) embed.setImage(`attachment://p${i}.gif`);
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
  if (s.mode === "greenscreen") return buildGsBoard(s, tok);
  if (!(await ensureSrc(s))) {
    return { content: "❌ Couldn't read that image. Try a PNG/JPG/GIF, a member, or a valid image URL.", embeds: [], components: [], files: [] };
  }
  const effs = pageEffects(s.page);
  if (!effs.some((e) => e.id === s.selected)) s.selected = effs[0]!.id;
  const gifs = await Promise.all(effs.map((eff) => previewFor(s, eff.id)));
  prewarm(s);
  return {
    content: HINT,
    embeds: boardEmbeds(s, effs, gifs),
    files: boardFiles(gifs),
    components: boardComponents(s, tok, effs),
  };
}

/** Green-screen board: one composited preview + its own controls. */
async function buildGsBoard(s: Session, tok: string): Promise<Screen> {
  const gif = await greenScreenPreview(s);
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setAuthor({ name: `Postmoji · green screen · target: ${s.targetLabel}` })
    .setTitle(`🟩 ${s.gsTitle || "Green screen"}`)
    .setDescription(gif ? "Keyed and composited over your source. Download or post it." : "❌ Couldn't render this green-screen GIF — try another.");
  if (gif) embed.setImage("attachment://postmoji.gif");
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CID}:green:${tok}`).setEmoji("🟩").setLabel("New green search").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${CID}:effects:${tok}`).setEmoji("🎭").setLabel("Effects").setStyle(ButtonStyle.Secondary),
  );
  return {
    content: HINT,
    embeds: [embed],
    files: gif ? [new AttachmentBuilder(gif, { name: "postmoji.gif" })] : [],
    components: [controls, actionRow(s, tok)],
  };
}

function pickerScreen(content: string, row: ActionRowBuilder<never>, tok: string): Screen {
  const back = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CID}:back:${tok}`).setEmoji("↩️").setLabel("Back").setStyle(ButtonStyle.Secondary),
  );
  return { content, embeds: [], files: [], components: [row, back] };
}

// ── entry point ──────────────────────────────────────────────────────────────
export async function handlePostmojiDashboard(interaction: ChatInputCommandInteraction): Promise<void> {
  sweep();
  if (!(await isPostmojiAdmin(interaction))) {
    await interaction.reply({ content: "❌ /postmojidashboard is admin-only.", flags: MessageFlags.Ephemeral });
    return;
  }
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
    mode: "effect", results: [], gsBuf: null, gsTitle: "", gsCache: new Map(),
  });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const s = sessions.get(tok)!;

  if (!(await ensureSrc(s))) {
    await interaction.editReply({ content: "❌ Couldn't read that image. Try a PNG/JPG/GIF, a member, or a valid image URL.", embeds: [], components: [], files: [] });
    return;
  }
  await interaction.editReply(await buildBoard(s, tok));
}

// ── unified component/modal router (registered in index.ts) ────────────────────
export async function handlePostmojiInteraction(interaction: Interaction): Promise<void> {
  if (!("customId" in interaction)) return;
  const parts = interaction.customId.split(":");
  const action = parts[1] ?? "";
  const tok = parts[2] ?? "";
  const s = sessions.get(tok);

  const expired = async () => {
    const msg = { content: "⌛ That session expired — run `/postmojidashboard` again.", flags: MessageFlags.Ephemeral } as const;
    if (interaction.isModalSubmit() || interaction.isMessageComponent()) await interaction.reply(msg);
  };
  if (!s || s.userId !== interaction.user.id) { await expired(); return; }
  s.expires = Date.now() + TTL;

  try {
    // ── modal submits ──────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      if (action === "imgmodal") {
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
      if (action === "srchmodal" || action === "greenmodal") {
        const q = interaction.fields.getTextInputValue("q").trim();
        await interaction.deferUpdate();
        const green = action === "greenmodal";
        s.results = await searchGifs(q, { limit: GIPHY_LIMIT, greenScreen: green });
        if (!s.results.length) {
          await interaction.editReply({ content: `❌ No Giphy results for “${q}”. ${giphyConfigured() ? "Try another search." : "Giphy isn't configured on this bot."}`, embeds: [], files: [], components: [backOnly(tok)] });
          return;
        }
        await interaction.editReply(searchResults(s, tok, green));
        return;
      }
      if (action === "gsurlmodal") {
        const url = interaction.fields.getTextInputValue("url").trim();
        await interaction.deferUpdate();
        if (!/^https?:\/\/\S+$/i.test(url)) {
          await interaction.editReply({ content: "❌ That doesn't look like a URL.", embeds: [], files: [], components: [backOnly(tok)] });
          return;
        }
        if (isVideoLike(url)) {
          await interaction.editReply({ content: "❌ That's a video link — GIFs only for now (MP4/WebM needs ffmpeg). Try a GIF URL.", embeds: [], files: [], components: [backOnly(tok)] });
          return;
        }
        const bytes = await fetchBytes(url);
        if (!bytes || !(await decodeGifFrames(bytes))) {
          await interaction.editReply({ content: "❌ Couldn't read that as a green-screen GIF. Try another link.", embeds: [], files: [], components: [backOnly(tok)] });
          return;
        }
        applyGreenScreen(s, bytes, "clip URL");
        await interaction.editReply(await buildGsBoard(s, tok));
        return;
      }
      return;
    }

    // ── user select (member avatar) ─────────────────────────────────────────
    if (interaction.isUserSelectMenu()) {
      await interaction.deferUpdate();
      const userId = interaction.values[0];
      const user = interaction.users.first()
        ?? (userId ? await interaction.client.users.fetch(userId).catch(() => null) : null);
      if (!user) { await interaction.editReply({ content: "❌ Couldn't read that member — choose again.", embeds: [], files: [], components: [] }); return; }
      retarget(s, avatarUrl(user), `@${user.username}`);
      await interaction.editReply(await buildBoard(s, tok));
      return;
    }

    // ── channel select (post target) ────────────────────────────────────────
    if (interaction.isChannelSelectMenu()) {
      await interaction.deferUpdate();
      await postToChannel(interaction.values[0]!, interaction, s, tok);
      return;
    }

    // ── string selects (server / search results / green results) ────────────
    if (interaction.isStringSelectMenu()) {
      if (action === "svpick") {
        const guildId = interaction.values[0]!;
        const guild = interaction.client.guilds.cache.get(guildId);
        const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
        const url = member ? avatarUrl(member) : (guild?.iconURL({ extension: "png", size: AVATAR_SIZE }) ?? null);
        if (url) retarget(s, url, `🏠 ${guild?.name ?? "server"}`);
        await interaction.deferUpdate();
        await interaction.editReply(await buildBoard(s, tok));
        return;
      }
      if (action === "srchpick") {
        const gif = s.results.find((g) => g.id === interaction.values[0]);
        await interaction.deferUpdate();
        if (gif) retarget(s, gif.originalUrl, gif.title);
        s.mode = "effect";
        await interaction.editReply(await buildBoard(s, tok));
        return;
      }
      if (action === "gspick") {
        const gif = s.results.find((g) => g.id === interaction.values[0]);
        await interaction.deferUpdate();
        if (!gif) { await interaction.editReply(await buildBoard(s, tok)); return; }
        const bytes = await fetchBytes(gif.originalUrl);
        if (!bytes) { await interaction.editReply({ content: "❌ Couldn't fetch that GIF — try another.", embeds: [], files: [], components: [backOnly(tok)] }); return; }
        s.gsBuf = bytes; s.gsTitle = gif.title; s.mode = "greenscreen"; s.gsCache.clear();
        await interaction.editReply(await buildGsBoard(s, tok));
        return;
      }
      return;
    }

    if (!interaction.isButton()) return;

    switch (action) {
      case "num": {
        const eff = pageEffects(s.page)[Number(parts[3] ?? 0)];
        if (eff) s.selected = eff.id;
        await interaction.deferUpdate();
        await interaction.editReply(await buildBoard(s, tok));
        return;
      }
      case "page": {
        s.page = Math.min(PAGES - 1, Math.max(0, s.page + (parts[3] === "n" ? 1 : -1)));
        await interaction.deferUpdate();
        await interaction.editReply(await buildBoard(s, tok));
        return;
      }
      case "effects": {
        s.mode = "effect";
        await interaction.deferUpdate();
        await interaction.editReply(await buildBoard(s, tok));
        return;
      }
      case "user": {
        const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
          new UserSelectMenuBuilder().setCustomId(`${CID}:uspick:${tok}`).setPlaceholder("Search for a member…").setMaxValues(1),
        );
        await interaction.update(pickerScreen("👤 **Pick a member** — their avatar becomes the source.", row as unknown as ActionRowBuilder<never>, tok));
        return;
      }
      case "server": {
        await interaction.update(serverPicker(interaction, tok));
        return;
      }
      case "image": {
        await interaction.showModal(textModal(`${CID}:imgmodal:${tok}`, "Animate an image URL", "url", "Image URL (PNG/JPG/GIF)", "https://…"));
        return;
      }
      case "search": {
        if (!giphyConfigured()) { await interaction.reply({ content: "❌ Giphy isn't configured on this bot.", flags: MessageFlags.Ephemeral }); return; }
        await interaction.showModal(textModal(`${CID}:srchmodal:${tok}`, "Search Giphy", "q", "Search for a GIF", "e.g. celebrate, cat, confetti"));
        return;
      }
      case "green": {
        await interaction.update(greenSourceScreen(tok));
        return;
      }
      case "gsgiphy": {
        if (!giphyConfigured()) { await interaction.reply({ content: "❌ Giphy isn't configured on this bot.", flags: MessageFlags.Ephemeral }); return; }
        await interaction.showModal(textModal(`${CID}:greenmodal:${tok}`, "Green-screen search", "q", "Search green-screen GIFs", "e.g. explosion, hearts, fire"));
        return;
      }
      case "gsurl": {
        await interaction.showModal(textModal(`${CID}:gsurlmodal:${tok}`, "Green-screen from URL", "url", "Green-screen GIF URL", "https://…/clip.gif"));
        return;
      }
      case "gsupload": {
        await collectUpload(interaction, s, tok);
        return;
      }
      case "back": {
        await interaction.deferUpdate();
        await interaction.editReply(await buildBoard(s, tok));
        return;
      }
      case "download": {
        await downloadSelected(interaction, s);
        return;
      }
      case "post": {
        await interaction.update(channelPicker(tok));
        return;
      }
      default:
        await interaction.deferUpdate();
    }
  } catch (err) {
    logger.error({ err }, "postmoji: interaction failed");
    if (interaction.isMessageComponent() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ Something went wrong. Try again.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

// ── helpers ────────────────────────────────────────────────────────────────
function retarget(s: Session, url: string, label: string): void {
  s.targetUrl = url; s.targetLabel = label; s.src = null; s.version += 1; s.cache.clear(); s.gsCache.clear();
}

function backOnly(tok: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CID}:back:${tok}`).setEmoji("↩️").setLabel("Back").setStyle(ButtonStyle.Secondary),
  );
}

function textModal(customId: string, title: string, fieldId: string, label: string, placeholder: string): ModalBuilder {
  return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId(fieldId).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(true),
    ),
  );
}

function searchResults(s: Session, tok: string, green: boolean): Screen {
  const options = s.results.slice(0, GIPHY_LIMIT).map((g) => ({
    label: g.title.slice(0, 100) || "GIF",
    value: g.id,
    description: green ? "green-screen overlay" : "use as source",
  }));
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CID}:${green ? "gspick" : "srchpick"}:${tok}`)
      .setPlaceholder(green ? "Pick a green-screen GIF…" : "Pick a GIF to use…")
      .addOptions(options),
  );
  const content = green
    ? "🟩 **Green-screen results** — pick one; I'll key out the green and lay it over your source."
    : "🔎 **Giphy results** — pick one to animate with an effect.";
  return pickerScreen(content, row as unknown as ActionRowBuilder<never>, tok);
}

function greenSourceScreen(tok: string): Screen {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CID}:gsgiphy:${tok}`).setEmoji("🔎").setLabel("Search Giphy").setStyle(ButtonStyle.Secondary).setDisabled(!giphyConfigured()),
    new ButtonBuilder().setCustomId(`${CID}:gsupload:${tok}`).setEmoji("📁").setLabel("Upload Clip").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${CID}:gsurl:${tok}`).setEmoji("🔗").setLabel("Clip URL").setStyle(ButtonStyle.Secondary),
  );
  return pickerScreen("🟩 **Green screen** — choose a source (GIFs work today; MP4/WebM not yet). I'll key out the green and lay it over your source.", row as unknown as ActionRowBuilder<never>, tok);
}

function applyGreenScreen(s: Session, bytes: Buffer, title: string): void {
  s.gsBuf = bytes; s.gsTitle = title; s.mode = "greenscreen"; s.gsCache.clear();
}

/** GIF-only for now — flag anything that looks like a video so we can say so clearly. */
function isVideoLike(nameOrUrl: string, contentType?: string | null): boolean {
  if (contentType && contentType.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|m4v|mkv|avi)(\?|#|$)/i.test(nameOrUrl);
}

/** Wait (≤60s) for the admin to drop a green-screen GIF in the channel, then use it. */
async function collectUpload(interaction: ButtonInteraction, s: Session, tok: string): Promise<void> {
  await interaction.deferUpdate();
  const channel = interaction.channel;
  if (!channel || !("awaitMessages" in channel)) {
    await interaction.editReply({ content: "❌ Can't collect an upload here — use 🔗 Clip URL instead.", embeds: [], files: [], components: [backOnly(tok)] });
    return;
  }
  await interaction.editReply({ content: "📎 **Upload now** — send your green-screen **GIF** as a message in this channel within 60s.", embeds: [], files: [], components: [backOnly(tok)] });
  const collector = channel as unknown as {
    awaitMessages: (o: unknown) => Promise<Collection<string, Message>>;
  };
  try {
    const collected = await collector.awaitMessages({
      filter: (m: Message) => m.author.id === s.userId && m.attachments.size > 0,
      max: 1, time: 60_000, errors: ["time"],
    });
    const msg = collected.first()!;
    const att = msg.attachments.first()!;
    await msg.delete().catch(() => { /* missing Manage Messages — leave it */ });
    if (isVideoLike(att.name ?? att.url, att.contentType)) {
      await interaction.editReply({ content: "❌ That's a video — GIFs only for now (MP4/WebM needs ffmpeg). Try a GIF.", embeds: [], files: [], components: [backOnly(tok)] });
      return;
    }
    const bytes = await fetchBytes(att.url);
    if (!bytes || !(await decodeGifFrames(bytes))) {
      await interaction.editReply({ content: "❌ Couldn't read that as a GIF. Try another clip.", embeds: [], files: [], components: [backOnly(tok)] });
      return;
    }
    applyGreenScreen(s, bytes, att.name ?? "uploaded clip");
    await interaction.editReply(await buildGsBoard(s, tok));
  } catch {
    await interaction.editReply({ content: "⌛ No clip received in time. Tap 🟩 Green to try again.", embeds: [], files: [], components: [backOnly(tok)] });
  }
}

function channelPicker(tok: string): Screen {
  const row = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`${CID}:chpick:${tok}`)
      .setPlaceholder("Choose a channel to post in…")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread),
  );
  return pickerScreen("📤 **Post where?** — choose the channel for the finished GIF.", row as unknown as ActionRowBuilder<never>, tok);
}

function serverPicker(interaction: ButtonInteraction, tok: string): Screen {
  const options: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  const add = (id: string, name: string) => { if (!seen.has(id) && options.length < 25) { seen.add(id); options.push({ label: name.slice(0, 100), value: id }); } };
  if (interaction.guild) add(interaction.guild.id, interaction.guild.name);
  for (const g of interaction.client.guilds.cache.values()) {
    if (g.members.cache.has(interaction.user.id)) add(g.id, g.name);
  }
  if (!options.length) {
    return { content: "🏠 No shared servers to pull an avatar from here. Use 👤 User or 🖼️ Image instead.", embeds: [], files: [], components: [backOnly(tok)] };
  }
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(`${CID}:svpick:${tok}`).setPlaceholder("Choose a server…").addOptions(options),
  );
  return pickerScreen("🏠 **Pick a server** — your avatar there becomes the source.", row as unknown as ActionRowBuilder<never>, tok);
}

/** Render whatever is currently selected (effect preview or green-screen composite). */
async function renderCurrent(s: Session): Promise<{ buf: Buffer | null; label: string }> {
  if (s.mode === "greenscreen") {
    return { buf: await greenScreenPreview(s), label: s.gsTitle || "green screen" };
  }
  const eff = EMOJI_EFFECTS.find((e) => e.id === s.selected);
  return { buf: await previewFor(s, s.selected), label: eff?.name ?? "animation" };
}

async function downloadSelected(interaction: ButtonInteraction, s: Session): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { buf, label } = await renderCurrent(s);
  if (!buf) { await interaction.editReply({ content: "❌ Couldn't render that one — pick another." }); return; }
  await interaction.editReply({ content: `⬇️ **${label}** — here's your GIF.`, files: [new AttachmentBuilder(buf, { name: "postmoji.gif" })] });
}

async function postToChannel(channelId: string, interaction: MessageComponentInteraction, s: Session, tok: string): Promise<void> {
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null) as TextBasedChannel | null;
  if (!channel || !("send" in channel)) {
    await interaction.editReply({ content: "❌ I can't post in that channel.", embeds: [], files: [], components: [backOnly(tok)] });
    return;
  }
  // Permission check: the bot must be able to send + attach files there.
  const guildChannel = channel as GuildTextBasedChannel;
  const me = interaction.guild?.members.me ?? null;
  if (me && "permissionsFor" in guildChannel) {
    const perms = guildChannel.permissionsFor(me);
    if (perms && !(perms.has(PermissionsBitField.Flags.SendMessages) && perms.has(PermissionsBitField.Flags.AttachFiles))) {
      await interaction.editReply({ content: `❌ I don't have permission to post in <#${channelId}>. I need **Send Messages** + **Attach Files** there.`, embeds: [], files: [], components: [backOnly(tok)] });
      return;
    }
  }
  const { buf, label } = await renderCurrent(s);
  if (!buf) { await interaction.editReply({ content: "❌ Couldn't render that one — pick another.", embeds: [], files: [], components: [backOnly(tok)] }); return; }
  try {
    await channel.send({ files: [new AttachmentBuilder(buf, { name: "postmoji.gif" })] });
    await interaction.editReply({ content: `✅ Posted **${label}** to <#${channelId}>.`, embeds: [], files: [], components: [] });
    sessions.delete(tok);
  } catch (err) {
    logger.error({ err }, "postmoji: channel post failed");
    await interaction.editReply({ content: `❌ Couldn't post to <#${channelId}> — check my permissions there.`, embeds: [], files: [], components: [backOnly(tok)] });
  }
}
