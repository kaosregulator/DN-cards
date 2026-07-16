// /embed designer — visual, interactive embed customizer.
//
// Opens an ephemeral panel with:
//   1. Dropdown of every embed key the bot can skin.
//   2. A rendered preview of the selected embed using sample data.
//   3. One-click buttons for each editable field (title, footer, color, image,
//      toggles, rarity colors, etc.) and reset.
//   4. A dedicated "Canvas Backgrounds" section to upload up to 3 images
//      that the /user-hub trophy renderer will pick from randomly.
//
// All changes are written to the existing embed_overrides table; backgrounds
// live in showcase_backgrounds. Nothing here is file-editing — every change is
// made live from Discord.

import type {
  ChatInputCommandInteraction, StringSelectMenuInteraction, ButtonInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
  AttachmentBuilder,
} from "discord.js";
import { EMBED_KEYS, type EmbedKey, type EmbedOverrideConfig } from "@workspace/db";
import {
  getRawEmbedOverride, upsertEmbedOverride, deleteEmbedOverride, applyEmbedOverride,
  DEFAULT_RARITY_COLORS,
} from "../embed-overrides.js";
import {
  getShowcaseBackgrounds, setShowcaseBackground, clearShowcaseBackground,
  clearAllShowcaseBackgrounds, getOrCreateGuildSettings, getRarityDisplayOverrides,
} from "../db.js";
import { rarityLabel, rarityEmoji, type Rarity } from "../cards-data.js";

// Resolve a rarity-color field's label/emoji through /rarity (source of truth),
// so the color editor shows the admin's custom rarity names/emojis.
async function rarityFieldDisplay(guildId: string) {
  const [gs, dm] = await Promise.all([
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
  ]);
  return (r: Rarity) => ({
    label: `${rarityLabel(r, gs, dm)} Color`,
    emoji: rarityEmoji(r, gs, dm),
  });
}
import { renderShowcaseImage } from "../battle/image/render.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import { persistBotImage } from "./edit-card.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const CUSTOM_ID_PREFIX = "embed";

const EMBED_FIELD_LIST = [
  { key: "title", label: "Title", emoji: "🏷️", type: "text" },
  { key: "footer", label: "Footer", emoji: "📌", type: "text" },
  { key: "descriptionPrefix", label: "Description Prefix", emoji: "📝", type: "text" },
  { key: "color", label: "Color", emoji: "🎨", type: "color" },
  { key: "customImageUrl", label: "Image URL", emoji: "🖼️", type: "url" },
  { key: "imageMode", label: "Image Mode", emoji: "🖽", type: "mode" },
  { key: "showWorth", label: "Show Worth", emoji: "💠", type: "toggle" },
  { key: "showDropChance", label: "Show Drop Chance", emoji: "🎲", type: "toggle" },
] as const;

// Static entries carry only the field KEY, the rarity, and a plain fallback
// label. The visible label/emoji are resolved live from /rarity at render time
// (see rarityFieldDisplay) — no hardcoded rarity name/emoji tables here.
const RARITY_COLOR_FIELDS = (["common", "uncommon", "rare", "epic", "legendary", "mythic"] as Rarity[])
  .map(r => ({
    key: `rarityColor.${r}` as const,
    rarity: r,
    label: `${r.charAt(0).toUpperCase()}${r.slice(1)} Color`,
    emoji: "🎨",
    type: "color" as const,
  }));

const IMAGE_MODES = [
  { label: "Default", value: "default" },
  { label: "Large Image", value: "large" },
  { label: "Thumbnail", value: "thumbnail" },
  { label: "No Image", value: "none" },
] as const;

const PRESETS = [
  {
    name: "default",
    label: "🔄 Bot Default",
    description: "Clear this embed and use the bot defaults.",
    style: ButtonStyle.Secondary,
  },
  {
    name: "dark",
    label: "🌑 Dark",
    description: "Black/purple theme with a subtle footer.",
    style: ButtonStyle.Primary,
  },
  {
    name: "military",
    label: "🫒 Military",
    description: "Olive drab and gold accent.",
    style: ButtonStyle.Success,
  },
  {
    name: "royal",
    label: "👑 Royal",
    description: "Deep purple and gold accent.",
    style: ButtonStyle.Primary,
  },
] as const;

type EmbedFieldKey = typeof EMBED_FIELD_LIST[number]["key"] | typeof RARITY_COLOR_FIELDS[number]["key"];

const SAMPLE_CARD = {
  name: "Sample Card",
  rarity: "epic" as Rarity,
  rarityLabel: "EPIC",
  cardId: 9999,
  cardType: "tank",
  imageUrl: "/assets/placeholder-card.png",
  worthValue: 250,
  dropChance: 3.5,
};

// ── Public entry ───────────────────────────────────────────────────────────
export async function handleEmbedDesignerCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.editReply("❌ This command can only be used in a server.");
    return;
  }
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  // Optional quick-upload: if an image is attached, assign it to the first empty slot.
  const image = interaction.options.getAttachment("image");
  if (image && image.url) {
    const existing = await getShowcaseBackgrounds(guildId);
    const slot = existing.length < 3 ? (existing.length + 1) as 1 | 2 | 3 : 1;
    let url = image.url;
    if (image.url.includes("cdn.discordapp.com") || image.url.includes("media.discordapp.net")) {
      try { url = await persistBotImage(image.url, image.contentType ?? undefined); } catch { /* fall back to raw URL */ }
    }
    await setShowcaseBackground(guildId, slot, url, userId);
    await interaction.editReply(await buildCanvasManager(guildId));
    return;
  }

  await interaction.editReply(await buildDesignerHome(guildId, userId));
}

// ── Component router ─────────────────────────────────────────────────────────
export async function handleEmbedDesignerComponent(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const action = parts[1];

  // Select menu: choose an embed key.
  if (action === "select" && interaction.isStringSelectMenu()) {
    const key = interaction.values[0] as EmbedKey | "canvas";
    if (key === "canvas") {
      await interaction.update(await buildCanvasManager(interaction.guildId!));
      return;
    }
    await interaction.update(await buildEmbedEditor(interaction.guildId!, key, interaction.user.id));
    return;
  }

  // Select menu: choose a field to edit.
  if (action === "field" && interaction.isStringSelectMenu()) {
    const key = parts[2] as EmbedKey;
    const field = interaction.values[0] as EmbedFieldKey;
    await handleFieldSelect(interaction, key, field);
    return;
  }

  // Select menu: choose an image mode.
  if (action === "mode" && interaction.isStringSelectMenu()) {
    const key = parts[2] as EmbedKey;
    const mode = interaction.values[0]!;   // applyField validates the imageMode value
    await applyField(interaction, key, "imageMode", mode);
    return;
  }

  // Buttons.
  if (action === "back") {
    await interaction.update(await buildDesignerHome(interaction.guildId!, interaction.user.id));
    return;
  }

  if (action === "canvas") {
    await interaction.update(await buildCanvasManager(interaction.guildId!));
    return;
  }

  if (action === "edit" && interaction.isButton()) {
    const key = parts[2] as EmbedKey;
    const field = parts[3] as EmbedFieldKey;
    await showEditModal(interaction, key, field);
    return;
  }

  if (action === "preset" && interaction.isButton()) {
    const key = parts[2] as EmbedKey;
    const preset = parts[3] as typeof PRESETS[number]["name"];
    await applyPreset(interaction, key, preset);
    return;
  }

  if (action === "reset" && interaction.isButton()) {
    const key = parts[2] as EmbedKey;
    await deleteEmbedOverride(interaction.guildId!, key);
    await interaction.update(await buildEmbedEditor(interaction.guildId!, key, interaction.user.id));
    return;
  }

  if (action === "bg-edit" && interaction.isButton()) {
    const slot = Number(parts[2]) as 1 | 2 | 3;
    await showBackgroundModal(interaction, slot);
    return;
  }

  if (action === "bg-clear" && interaction.isButton()) {
    const slot = Number(parts[2]) as 1 | 2 | 3;
    await clearShowcaseBackground(interaction.guildId!, slot);
    await interaction.update(await buildCanvasManager(interaction.guildId!));
    return;
  }

  if (action === "bg-clearall" && interaction.isButton()) {
    await clearAllShowcaseBackgrounds(interaction.guildId!);
    await interaction.update(await buildCanvasManager(interaction.guildId!));
    return;
  }
}

// ── Modal router ────────────────────────────────────────────────────────────
export async function handleEmbedDesignerModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const action = parts[1];

  if (action === "text" || action === "color" || action === "url") {
    const key = parts[2] as EmbedKey;
    const field = parts[3] as EmbedFieldKey;
    const raw = interaction.fields.getTextInputValue("value").trim();
    await applyField(interaction, key, field, raw);
    return;
  }

  if (action === "bg") {
    const slot = Number(parts[2]) as 1 | 2 | 3;
    const raw = interaction.fields.getTextInputValue("url").trim();
    await handleBackgroundUrl(interaction, slot, raw);
    return;
  }
}

// ── View builders ────────────────────────────────────────────────────────────
async function buildDesignerHome(guildId: string, userId: string) {
  const embed = new EmbedBuilder()
    .setTitle("🎨 Embed Designer")
    .setColor(0x5865f2)
    .setDescription(
      "Pick an embed below to preview and customize it. Every change is live instantly.\n\n" +
      "Use the **Canvas Backgrounds** button to upload up to 3 images that the /user-hub trophy will rotate randomly.",
    );

  const options: { label: string; value: string; description: string }[] = EMBED_KEYS.map(k => ({
    label: k.charAt(0).toUpperCase() + k.slice(1),
    value: k,
    description: `Customize the ${k} embed`,
  }));
  options.push({ label: "🏆 Canvas Backgrounds", value: "canvas", description: "Upload trophy/showcase backgrounds" });

  const rows: ActionRowBuilder<any>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${CUSTOM_ID_PREFIX}:select`)
        .setPlaceholder("Choose an embed to customize…")
        .addOptions(options),
    ),
  ];

  // No `flags` here: these views are delivered via editReply()/update(), which
  // inherit ephemerality from the initial deferred reply and reject `flags`.
  return { embeds: [embed], components: rows };
}

async function buildEmbedEditor(guildId: string, key: EmbedKey, userId: string) {
  const cfg = await getRawEmbedOverride(guildId, key);
  const preview = await buildPreviewEmbed(guildId, key, cfg);
  const rarityField = await rarityFieldDisplay(guildId);

  const fieldOptions = [
    ...EMBED_FIELD_LIST.map(f => ({
      label: `${f.emoji} ${f.label}`,
      value: f.key,
      description: `Edit ${f.label.toLowerCase()}`,
    })),
    ...RARITY_COLOR_FIELDS.map(f => {
      const d = rarityField(f.rarity); // resolved through /rarity
      return {
        label: `${d.emoji} ${d.label}`,
        value: f.key,
        description: `Edit ${d.label}`,
      };
    }),
  ];

  const rows: ActionRowBuilder<any>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${CUSTOM_ID_PREFIX}:field:${key}`)
        .setPlaceholder("Pick a field to edit…")
        .addOptions(fieldOptions),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${CUSTOM_ID_PREFIX}:preset:${key}:default`).setLabel("🔄 Default").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID_PREFIX}:preset:${key}:dark`).setLabel("🌑 Dark").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID_PREFIX}:preset:${key}:military`).setLabel("🫒 Military").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID_PREFIX}:preset:${key}:royal`).setLabel("👑 Royal").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID_PREFIX}:reset:${key}`).setLabel("🗑️ Reset").setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${CUSTOM_ID_PREFIX}:canvas`).setLabel("🏆 Canvas Backgrounds").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID_PREFIX}:back`).setLabel("↩️ Back").setStyle(ButtonStyle.Secondary),
    ),
  ];

  return { embeds: [preview], components: rows };
}

async function buildCanvasManager(guildId: string) {
  const backgrounds = await getShowcaseBackgrounds(guildId);
  const slots = [1, 2, 3] as const;

  const embed = new EmbedBuilder()
    .setTitle("🏆 Canvas Backgrounds")
    .setColor(0xffd76b)
    .setDescription(
      "Upload up to 3 background images. The /user-hub trophy will pick one at random each time a card is shown off.\n\n" +
      slots.map(s => {
        const url = backgrounds[s - 1];
        return `**Slot ${s}:** ${url ? url : "*(empty — uses default gradient)*"}`;
      }).join("\n"),
    );

  const rows: ActionRowBuilder<any>[] = [];
  const row1 = new ActionRowBuilder<ButtonBuilder>();
  for (const slot of slots) {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID_PREFIX}:bg-edit:${slot}`)
        .setLabel(`Set Slot ${slot}`)
        .setStyle(ButtonStyle.Primary),
    );
  }
  rows.push(row1);

  const row2 = new ActionRowBuilder<ButtonBuilder>();
  for (const slot of slots) {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID_PREFIX}:bg-clear:${slot}`)
        .setLabel(`Clear ${slot}`)
        .setStyle(ButtonStyle.Danger),
    );
  }
  rows.push(row2);

  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CUSTOM_ID_PREFIX}:bg-clearall`).setLabel("Clear All").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${CUSTOM_ID_PREFIX}:back`).setLabel("↩️ Back").setStyle(ButtonStyle.Secondary),
  ));

  return { embeds: [embed], components: rows };
}

// ── Preview renderer ─────────────────────────────────────────────────────────
async function buildPreviewEmbed(guildId: string, key: EmbedKey, cfg: EmbedOverrideConfig | null): Promise<EmbedBuilder> {
  const ctx = {
    userId: "123456789012345678",
    username: "DemoUser",
    card: SAMPLE_CARD.name,
    rarity: SAMPLE_CARD.rarityLabel,
    worth: SAMPLE_CARD.worthValue,
    chance: SAMPLE_CARD.dropChance,
    streak: 7,
    tier: "Premium",
    amount: 100,
    balance: 1250,
    guild: "Demo Server",
    channelId: "123456789012345678",
  };

  let base = new EmbedBuilder();
  switch (key) {
    case "spawn":
      base.setTitle("A wild card appeared!").setDescription(`Type the card name to catch **${SAMPLE_CARD.name}**.`);
      base.setImage(toAbsoluteImageUrl(SAMPLE_CARD.imageUrl) ?? null);
      break;
    case "claimed":
      base.setTitle("You caught a card!").setDescription(`<@${ctx.userId}> caught **${SAMPLE_CARD.name}**.`);
      base.setImage(toAbsoluteImageUrl(SAMPLE_CARD.imageUrl) ?? null);
      break;
    case "daily":
      base.setTitle("Daily Reward").setDescription("Come back tomorrow to keep your streak alive!");
      break;
    case "pack":
      base.setTitle("Pack Opened").setDescription("You ripped a Premium pack and found some cards.");
      break;
    case "trade":
      base.setTitle("Trade Offer").setDescription("A trade is waiting for your response.");
      break;
    case "welcome":
      base.setTitle("Welcome to the server!").setDescription("Catch cards, trade, and battle your way to the top.");
      break;
    case "rules":
      base.setTitle("Server Rules").setDescription("Be respectful. No bot abuse. Have fun.");
      break;
    case "commands":
      base.setTitle("Bot Commands").setDescription("/collection, /trade, /battle, /daily, /help");
      break;
    case "help":
      base.setTitle("Need help?").setDescription("Use /user-hub for your profile and /adminhub for admin tools.");
      break;
  }
  base.setColor(0x5865f2);
  await applyEmbedOverride(base, { guildId, key, ctx, defaultImageUrl: toAbsoluteImageUrl(SAMPLE_CARD.imageUrl), rarity: SAMPLE_CARD.rarity });
  return base;
}

// ── Field editing ────────────────────────────────────────────────────────────
async function handleFieldSelect(
  interaction: StringSelectMenuInteraction,
  key: EmbedKey,
  field: EmbedFieldKey,
): Promise<void> {
  const meta = [...EMBED_FIELD_LIST, ...RARITY_COLOR_FIELDS].find(f => f.key === field);
  if (!meta) return;

  if (meta.type === "toggle") {
    const cfg = await getRawEmbedOverride(interaction.guildId!, key) ?? {};
    const current = cfg[field as keyof EmbedOverrideConfig] as boolean | undefined;
    await applyField(interaction, key, field, String(!current));
    return;
  }

  if (meta.type === "mode") {
    const rows = [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${CUSTOM_ID_PREFIX}:mode:${key}`)
        .setPlaceholder("Pick image mode…")
        .addOptions(IMAGE_MODES.map(m => ({ label: m.label, value: m.value, description: `Use ${m.label.toLowerCase()}` }))),
    )];
    await interaction.update({ embeds: interaction.message.embeds, components: rows });
    return;
  }

  // text / color / url all open a modal.
  await showEditModal(interaction, key, field);
}

async function showEditModal(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  key: EmbedKey,
  field: EmbedFieldKey,
): Promise<void> {
  const meta = [...EMBED_FIELD_LIST, ...RARITY_COLOR_FIELDS].find(f => f.key === field)!;
  const isColor = meta.type === "color";
  const isUrl = meta.type === "url";
  // Rarity-color fields resolve their label live from /rarity.
  let label = meta.label;
  if (field.startsWith("rarityColor.") && interaction.guildId) {
    const r = field.slice("rarityColor.".length) as Rarity;
    label = (await rarityFieldDisplay(interaction.guildId))(r).label;
  }
  const modal = new ModalBuilder()
    .setCustomId(`${CUSTOM_ID_PREFIX}:${isColor ? "color" : isUrl ? "url" : "text"}:${key}:${field}`)
    .setTitle(`Edit ${label}`);
  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder(isColor ? "#5865f2" : isUrl ? "https://example.com/image.png" : "Leave empty to clear");
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  return interaction.showModal(modal);
}

async function applyField(
  interaction: StringSelectMenuInteraction | ButtonInteraction | ModalSubmitInteraction,
  key: EmbedKey,
  field: EmbedFieldKey,
  raw: string,
): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const existing = (await getRawEmbedOverride(guildId, key)) ?? {};
  const cfg: EmbedOverrideConfig = { ...existing };

  const boolFields = ["enabled", "showWorth", "showDropChance"] as const;
  if (boolFields.includes(field as any)) {
    const v = raw.toLowerCase();
    const b = ["true", "yes", "y", "on", "1"].includes(v);
    (cfg as any)[field] = b;
  } else if (field === "imageMode") {
    if (["default", "large", "thumbnail", "none"].includes(raw)) cfg.imageMode = raw as any;
  } else if (field === "color") {
    if (raw === "") { delete cfg.color; }
    else {
      const n = parseHexColor(raw);
      if (n === null) { await replyError(interaction, "Color must be a hex code like `#5865f2`."); return; }
      cfg.color = n;
    }
  } else if (field.startsWith("rarityColor.")) {
    const r = field.slice("rarityColor.".length) as Rarity;
    const colors = { ...(cfg.rarityColors ?? {}) };
    if (raw === "") { delete colors[r]; if (Object.keys(colors).length === 0) delete cfg.rarityColors; else cfg.rarityColors = colors; }
    else {
      const n = parseHexColor(raw);
      if (n === null) { await replyError(interaction, "Color must be a hex code like `#5865f2`."); return; }
      colors[r] = n; cfg.rarityColors = colors;
    }
  } else if (field === "customImageUrl") {
    if (raw === "") { delete cfg.customImageUrl; }
    else if (!/^https?:\/\//i.test(raw)) { await replyError(interaction, "Image URL must start with `http://` or `https://`."); return; }
    else { cfg.customImageUrl = raw; }
  } else {
    // text fields
    if (raw === "") { delete (cfg as any)[field]; }
    else { (cfg as any)[field] = raw; }
  }

  await upsertEmbedOverride(guildId, key, cfg, userId);
  await refreshEditorView(interaction, guildId, key, userId);
}

// Re-render the editor on whichever interaction triggered the change. Component
// interactions (select/button) and message-backed modal submits can update the
// source message in place; a plain modal submit falls back to editReply.
async function refreshEditorView(
  interaction: StringSelectMenuInteraction | ButtonInteraction | ModalSubmitInteraction,
  guildId: string,
  key: EmbedKey,
  userId: string,
): Promise<void> {
  const view = await buildEmbedEditor(guildId, key, userId);
  if (interaction.isModalSubmit()) {
    if (interaction.isFromMessage()) await interaction.update(view);
    else await interaction.editReply(view);
  } else {
    await interaction.update(view);
  }
}

function parseHexColor(input: string): number | null {
  const s = input.trim().replace(/^#/, "").replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{6}$/.test(s) && !/^[0-9a-fA-F]{3}$/.test(s)) return null;
  const full = s.length === 3 ? s.split("").map(c => c + c).join("") : s;
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? n : null;
}

async function applyPreset(
  interaction: ButtonInteraction,
  key: EmbedKey,
  preset: typeof PRESETS[number]["name"],
): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  let cfg: EmbedOverrideConfig = {};
  if (preset === "dark") {
    cfg = { color: 0x1a1a2e, footer: "DN Cards · {guild}", title: undefined };
  } else if (preset === "military") {
    cfg = { color: 0x4b5320, footer: "DN Cards · {guild}", title: undefined };
  } else if (preset === "royal") {
    cfg = { color: 0x4b0082, footer: "DN Cards · {guild}", title: undefined };
  } else if (preset === "default") {
    await deleteEmbedOverride(guildId, key);
    await interaction.update(await buildEmbedEditor(guildId, key, userId));
    return;
  }

  await upsertEmbedOverride(guildId, key, cfg, userId);
  await interaction.update(await buildEmbedEditor(guildId, key, userId));
}

// ── Canvas background editing ────────────────────────────────────────────────
function showBackgroundModal(interaction: ButtonInteraction, slot: 1 | 2 | 3): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(`${CUSTOM_ID_PREFIX}:bg:${slot}`)
    .setTitle(`Set Background Slot ${slot}`);
  const input = new TextInputBuilder()
    .setCustomId("url")
    .setLabel("Image URL or upload to Discord and paste the link")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(500)
    .setPlaceholder("https://cdn.discordapp.com/attachments/.../image.png");
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  return interaction.showModal(modal);
}

async function handleBackgroundUrl(
  interaction: ModalSubmitInteraction,
  slot: 1 | 2 | 3,
  raw: string,
): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  if (!/^https?:\/\//i.test(raw)) {
    await interaction.reply({ content: "❌ Background URL must start with `http://` or `https://`.", ...EPHEMERAL }).catch(() => {});
    return;
  }

  // Optional: if the URL is a Discord attachment, re-upload it to object storage so it survives.
  let url = raw;
  if (raw.includes("cdn.discordapp.com") || raw.includes("media.discordapp.net")) {
    try {
      url = await persistBotImage(raw, "image/png");
    } catch {
      // Fall back to the raw Discord URL if the upload fails.
    }
  }

  await setShowcaseBackground(guildId, slot, url, userId);
  await interaction.reply({ content: `✅ Background slot ${slot} set.`, ...EPHEMERAL }).catch(() => {});
  await interaction.editReply(await buildCanvasManager(guildId));
}

// ── Helpers ─────────────────────────────────────────────────────────────────
async function replyError(
  interaction: StringSelectMenuInteraction | ButtonInteraction | ModalSubmitInteraction,
  message: string,
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content: `❌ ${message}`, ...EPHEMERAL }).catch(() => {});
  } else {
    await interaction.reply({ content: `❌ ${message}`, ...EPHEMERAL }).catch(() => {});
  }
}
