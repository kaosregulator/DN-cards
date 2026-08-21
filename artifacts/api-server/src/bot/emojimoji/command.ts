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
//   • ✅ Send    — post the highlighted animation to the channel
//
// The animation effects themselves are our own canvas transforms + pack-extracted
// overlays (see effects.ts) — nothing streamed from a third-party service.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, MessageFlags,
  type ChatInputCommandInteraction, type StringSelectMenuInteraction,
  type UserSelectMenuInteraction, type ButtonInteraction, type ModalSubmitInteraction,
  type MessageComponentInteraction, type Interaction, type TextBasedChannel,
} from "discord.js";
import sharp from "sharp";
import { EMOJI_EFFECTS, renderEmojiGif } from "./effects.js";
import { logger } from "../../lib/logger.js";

const PER_PAGE = 5;
const PAGES = Math.max(1, Math.ceil(EMOJI_EFFECTS.length / PER_PAGE));
const NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
const TTL = 10 * 60 * 1000;

interface Session {
  userId: string;
  expires: number;
  targetUrl: string;
  targetLabel: string;         // human label of the current target, e.g. "@Alice"
  src: Buffer | null;          // fetched + flattened source frame
  version: number;             // bumps whenever the target changes (cache key)
  page: number;
  selected: string;            // effect id currently highlighted
  cache: Map<string, Buffer>;  // `${version}:${effectId}` → rendered preview gif
}
const sessions = new Map<string, Session>();

function token(): string { return Math.random().toString(36).slice(2, 10); }
function sweep(): void { const now = Date.now(); for (const [k, s] of sessions) if (s.expires < now) sessions.delete(k); }
function pageEffects(page: number) { return EMOJI_EFFECTS.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE); }

// ── source resolution ────────────────────────────────────────────────────────
function resolveSource(interaction: ChatInputCommandInteraction): { url: string; label: string } | null {
  const att = interaction.options.getAttachment("image");
  if (att) {
    if (att.contentType && !att.contentType.startsWith("image/")) return null;
    return { url: att.url, label: "your upload" };
  }
  const user = interaction.options.getUser("user");
  if (user) return { url: user.displayAvatarURL({ extension: "png", size: 256 }), label: `@${user.username}` };
  const url = interaction.options.getString("url");
  if (url) return /^https?:\/\//i.test(url) ? { url, label: "that image" } : null;
  return { url: interaction.user.displayAvatarURL({ extension: "png", size: 256 }), label: "your avatar" };
}

// Download the source and flatten it to a single 256px PNG frame for the encoder.
async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 12_000_000) return null;
    return await sharp(buf).resize(256, 256, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
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

// ── screen builders ──────────────────────────────────────────────────────────
type Screen = Parameters<ButtonInteraction["editReply"]>[0];

async function buildBoard(s: Session, tok: string): Promise<Screen> {
  if (!(await ensureSrc(s))) {
    return { content: "❌ Couldn't read that image. Try a PNG/JPG/GIF, a member, or a valid image URL.", embeds: [], components: [], files: [] };
  }
  const effs = pageEffects(s.page);
  if (!effs.some((e) => e.id === s.selected)) s.selected = effs[0]!.id;

  const files: AttachmentBuilder[] = [];
  const embeds: EmbedBuilder[] = [];
  for (let i = 0; i < effs.length; i++) {
    const eff = effs[i]!;
    const gif = await previewFor(s, eff.id);
    const name = `p${i}.gif`;
    const isSel = eff.id === s.selected;
    const embed = new EmbedBuilder()
      .setColor(isSel ? 0x57f287 : 0x2b2d31)
      .setTitle(`${NUM_EMOJI[i]} ${eff.emoji} ${eff.name}${isSel ? "  ✅" : ""}`)
      .setDescription(eff.desc);
    if (i === 0) embed.setAuthor({ name: `Emojimoji · target: ${s.targetLabel} · page ${s.page + 1}/${PAGES}` });
    if (gif) { files.push(new AttachmentBuilder(gif, { name })); embed.setImage(`attachment://${name}`); }
    embeds.push(embed);
  }

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

  return {
    content: `🪄 **Emojimoji** — pick a number to highlight an animation, page through with ◀ ▶, then **Send**. Change the target with 👤 / 🏠 / 🖼️.`,
    embeds, files, components: [numRow, pageRow, srcRow],
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
      retarget(s, user.displayAvatarURL({ extension: "png", size: 256 }), `@${user.username}`);
      await interaction.editReply(await buildBoard(s, tok));
      return;
    }

    // Server picker result.
    if (interaction.isStringSelectMenu()) {
      const guildId = interaction.values[0]!;
      const guild = interaction.client.guilds.cache.get(guildId);
      const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
      const url = member?.displayAvatarURL({ extension: "png", size: 256 }) ?? guild?.iconURL({ extension: "png", size: 256 }) ?? null;
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
        await interaction.editReply(await buildBoard(s, tok));
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
  try {
    await channel.send({
      content: `${eff?.emoji ?? "🪄"} emojimoji by <@${interaction.user.id}>`,
      files: [new AttachmentBuilder(gif, { name: "emojimoji.gif" })],
    });
    await interaction.editReply({ content: `✅ Sent **${eff?.name ?? "your animation"}** to the channel!`, embeds: [], files: [], components: [] });
    sessions.delete(tok);
  } catch (err) {
    logger.error({ err }, "emojimoji: send failed");
    await interaction.editReply({ content: "❌ Couldn't post it — do I have permission to send here?" });
  }
}
