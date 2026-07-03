// /editcard — interactive admin slash command for editing ANY card (defaults
// and custom alike). Mirrors the dashboard editor so admins can manage their
// roster without leaving Discord.
//
// Flow:
//   /editcard name:<autocomplete>
//     → ephemeral preview + StringSelect "what to edit?"
//   On select:
//     • rarity / type        → secondary StringSelect with the valid values
//     • text/number fields   → Modal with a single input
//     • image upload         → pass image:<file> to /editcard
//     • boolean toggles      → flipped immediately, panel re-renders
//
// Custom IDs:
//   editcard:menu:<id>            — main field picker select
//   editcard:rarity:<id>          — rarity sub-select
//   editcard:type:<id>            — card type sub-select
//   editcard:toggle:<field>:<id>  — immediate boolean flip via the menu select
//   editcard:modal:<field>:<id>   — text/number input modal

import {
  ActionRowBuilder, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder,
  TextInputBuilder, TextInputStyle, MessageFlags,
  type ChatInputCommandInteraction, type StringSelectMenuInteraction,
  type ModalSubmitInteraction, type RepliableInteraction,
} from "discord.js";
import { randomUUID } from "crypto";
import {
  assignCardToCustomRarity,
  getCardByName,
  getCardById,
  getCardDisplayRarity,
  getDisplayRarities,
  getOrCreateGuildSettings,
  getRarityContext,
  getRarityDisplayOverrides,
  unassignCardCustomRarity,
  updateCard,
} from "../db.js";
import { RARITY_EMOJI, selectMenuEmoji, type Rarity } from "../cards-data.js";
import { objectStorageClient } from "../../lib/objectStorage.js";

// ── Permanent image upload ────────────────────────────────────────────────────
// Discord slash-command attachment URLs are ephemeral — they expire within
// hours/days. Download the bytes and re-upload to object storage so the URL
// is permanent and usable in Discord embeds + the website indefinitely.
// Falls back to the original URL silently if GCS is unavailable or upload fails.
export async function persistBotImage(url: string, contentType?: string): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) return url;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!resp.ok) return url;
    const ct = contentType ?? resp.headers.get("content-type") ?? "image/png";
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0 || buf.length > 10 * 1024 * 1024) return url; // 10 MB cap
    const ext = ct.includes("gif") ? "gif" : ct.includes("webp") ? "webp" : ct.includes("png") ? "png" : "jpg";
    const objectName = `bot-uploads/${randomUUID()}.${ext}`;
    const file = objectStorageClient.bucket(bucketId).file(objectName);
    await file.save(buf, { contentType: ct, public: true });
    return `https://storage.googleapis.com/${bucketId}/${objectName}`;
  } catch {
    return url; // graceful fallback — command still works, image just ephemeral
  }
}

const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
const TYPE_CHOICES = ["tank", "aircraft", "ship", "vehicle", "infantry", "boss", "community", "event", "achievement", "limited"];

// ── Preview embed + field-picker select ─────────────────────────────────────
async function buildPanel(cardId: number, guildId?: string | null): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } | null> {
  const card = await getCardById(cardId);
  if (!card) return null;
  const [settings, displayMap, ctx] = guildId
    ? await Promise.all([getOrCreateGuildSettings(guildId), getRarityDisplayOverrides(guildId), getRarityContext(guildId)])
    : [null, null, null] as const;
  const displayRarity = getCardDisplayRarity(card, ctx, settings, displayMap);
  const embed = new EmbedBuilder()
    .setTitle(`✏️ Edit: ${card.name}`)
    .setColor(displayRarity.color)
    .setDescription(card.description || "_(no description)_")
    .addFields(
      { name: "Rarity", value: `${displayRarity.emoji} ${displayRarity.label}`, inline: true },
      { name: "Type", value: card.cardType, inline: true },
      { name: "Worth", value: `💠 ${card.worthValue.toLocaleString()}`, inline: true },
      { name: "Burn", value: `💠 ${card.burnValue.toLocaleString()}`, inline: true },
      { name: "In Packs", value: card.inPacks ? "✅ Yes" : "❌ No", inline: true },
      { name: "Droppable", value: card.droppable ? "✅ Yes" : "❌ No", inline: true },
      { name: "Archived", value: card.isArchived ? "🗄️ Yes" : "❌ No", inline: true },
      { name: "Limited", value: card.isLimitedEdition ? `💎 Yes (${card.totalMinted}/${card.maxCopies ?? "?"})` : "❌ No", inline: true },
    )
    .setFooter({ text: `Card #${card.id} — use /editcard name:<card> image:<file> to replace the image.` });
  if (card.imageUrl) embed.setThumbnail(card.imageUrl);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`editcard:menu:${card.id}`)
    .setPlaceholder("Pick a field to edit…")
    .addOptions(
      { label: "Rarity", value: "rarity", emoji: "✨", description: `Currently ${displayRarity.label}` },
      { label: "Name", value: "name", emoji: "🏷️" },
      { label: "Description", value: "description", emoji: "📝" },
      { label: "Type", value: "type", emoji: "🎯", description: `Currently ${card.cardType}` },
      { label: "Worth value", value: "worthValue", emoji: "💠", description: `Currently ${card.worthValue.toLocaleString()}` },
      { label: "Burn value", value: "burnValue", emoji: "🔥", description: `Currently ${card.burnValue.toLocaleString()}` },
      { label: card.inPacks ? "Toggle: remove from packs" : "Toggle: add to packs", value: "toggle:inPacks", emoji: "📦" },
      { label: card.droppable ? "Toggle: make undroppable" : "Toggle: make droppable", value: "toggle:droppable", emoji: "🎁" },
      { label: card.isArchived ? "Toggle: un-archive" : "Toggle: archive", value: "toggle:isArchived", emoji: "🗄️" },
    );

  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] };
}

export async function renderPanel(
  interaction: RepliableInteraction,
  cardId: number,
  reply: boolean,
  content?: string,
): Promise<void> {
  const panel = await buildPanel(cardId, (interaction as { guildId?: string | null }).guildId);
  if (!panel) {
    const errContent = "❌ Card not found.";
    if (reply) await interaction.reply({ content: errContent, flags: MessageFlags.Ephemeral }).catch(() => {});
    else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      await interaction.editReply({ content: errContent, embeds: [], components: [] }).catch(() => {});
    }
    return;
  }
  if (reply) {
    await interaction.reply({ ...panel, content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.editReply({ ...panel, content: content ?? "" });
  }
}

// ── Slash entry ─────────────────────────────────────────────────────────────
// admin.ts already called deferReply(ephemeral) before dispatching here,
// so we use editReply (reply=false) instead of reply.
export async function handleEditCardCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString("name", true).trim();
  const image = interaction.options.getAttachment("image");
  const card = await getCardByName(name);
  if (!card) {
    await interaction.editReply(`❌ No card named **${name}**. Use autocomplete to pick one.`);
    return;
  }
  if (image) {
    const permanentUrl = await persistBotImage(image.url, image.contentType ?? undefined);
    await updateCard(card.id, { imageUrl: permanentUrl });
  }
  await renderPanel(
    interaction,
    card.id,
    false,
    image ? `✅ Updated **${card.name}** image from your upload.` : undefined,
  );
}

// ── Select handler ──────────────────────────────────────────────────────────
export async function handleEditCardSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const parts = interaction.customId.split(":"); // editcard:<sub>:<id> or editcard:toggle:<field>:<id>
  const sub = parts[1];
  const cardId = Number(parts[parts.length - 1]);
  const value = interaction.values[0]!;

  // Main menu — route to sub-flows
  if (sub === "menu") {
    // Boolean toggle: "toggle:<field>"
    if (value.startsWith("toggle:")) {
      await interaction.deferUpdate();
      const field = value.slice("toggle:".length) as "inPacks" | "droppable" | "isArchived";
      const card = await getCardById(cardId);
      if (!card) { await interaction.editReply({ content: "❌ Card not found.", embeds: [], components: [] }); return; }
      const cur = (card as unknown as Record<string, boolean>)[field];
      await updateCard(card.id, { [field]: !cur } as Parameters<typeof updateCard>[1]);
      await renderPanel(interaction, cardId, false);
      return;
    }

    // Rarity → secondary select. Built-ins update the card identity; custom
    // tiers write the same Setup Hub assignment table used by /rarity.
    if (value === "rarity") {
      const [settings, displayMap, ctx] = interaction.guildId
        ? await Promise.all([getOrCreateGuildSettings(interaction.guildId), getRarityDisplayOverrides(interaction.guildId), getRarityContext(interaction.guildId)])
        : [null, null, null] as const;
      const rarities = ctx
        ? getDisplayRarities(ctx, settings, { displayMap, rarestFirst: false })
        : RARITIES.map(r => getCardDisplayRarity({ id: -1, rarity: r }, null, settings, displayMap));
      const select = new StringSelectMenuBuilder()
        .setCustomId(`editcard:rarity:${cardId}`)
        .setPlaceholder("Pick a rarity…")
        .addOptions(rarities.slice(0, 25).map(r => ({
          label: r.label.slice(0, 100),
          value: r.isCustom ? `custom:${r.slug}` : `builtin:${r.rarity}`,
          emoji: selectMenuEmoji(r.emoji, r.isCustom ? "⭐" : RARITY_EMOJI[r.rarity as Rarity] ?? "🃏"),
        })));
      await interaction.update({
        content: "✨ Pick the new rarity:",
        embeds: [],
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      });
      return;
    }

    // Type → secondary select with TYPE_CHOICES
    if (value === "type") {
      const select = new StringSelectMenuBuilder()
        .setCustomId(`editcard:type:${cardId}`)
        .setPlaceholder("Pick a card type…")
        .addOptions(TYPE_CHOICES.map(t => ({ label: t, value: t })));
      await interaction.update({
        content: "🎯 Pick the new type:",
        embeds: [],
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      });
      return;
    }

    // Text/number fields → open a modal
    await openFieldModal(interaction, cardId, value);
    return;
  }

  // Rarity sub-select. Built-ins clear any custom assignment; custom tiers use
  // the authoritative card_rarity_overrides row so every display stays synced.
  if (sub === "rarity") {
    await interaction.deferUpdate();
    if (!interaction.guildId) return;
    if (value.startsWith("custom:")) {
      const slug = value.slice("custom:".length);
      const ctx = await getRarityContext(interaction.guildId);
      if (!ctx.customBySlug.has(slug)) {
        await renderPanel(interaction, cardId, false, "❌ That custom rarity no longer exists.");
        return;
      }
      await assignCardToCustomRarity(interaction.guildId, cardId, slug);
    } else {
      const rarity = value.startsWith("builtin:") ? value.slice("builtin:".length) : value;
      if (!RARITIES.includes(rarity as Rarity)) return;
      await updateCard(cardId, { rarity });
      await unassignCardCustomRarity(interaction.guildId, cardId);
    }
    await renderPanel(interaction, cardId, false);
    return;
  }

  // Type sub-select
  if (sub === "type") {
    await interaction.deferUpdate();
    await updateCard(cardId, { cardType: value });
    await renderPanel(interaction, cardId, false);
    return;
  }
}

// ── Modal for text/number fields ────────────────────────────────────────────
const TEXT_FIELDS: Record<string, { title: string; label: string; style: TextInputStyle; max?: number; placeholder?: string }> = {
  name:        { title: "Edit Name",        label: "Card name (1–80 chars)",        style: TextInputStyle.Short,     max: 80 },
  description: { title: "Edit Description", label: "Description (max 500 chars)",   style: TextInputStyle.Paragraph, max: 500 },
  worthValue:  { title: "Edit Worth Value", label: "Worth value in DN Shards",       style: TextInputStyle.Short,     placeholder: "Example: 2500" },
  burnValue:   { title: "Edit Burn Value",  label: "Burn value in DN Shards",        style: TextInputStyle.Short,     placeholder: "Example: 1250" },
};

async function openFieldModal(interaction: StringSelectMenuInteraction, cardId: number, field: string): Promise<void> {
  const def = TEXT_FIELDS[field];
  if (!def) { await interaction.deferUpdate().catch(() => {}); return; }
  const card = await getCardById(cardId);
  const current = card ? String((card as unknown as Record<string, unknown>)[field] ?? "") : "";
  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel(def.label)
    .setStyle(def.style)
    .setRequired(field === "name") // only name is required; others may be blank/0
    .setValue(current.length <= (def.max ?? 4000) ? current : "");
  if (def.max) input.setMaxLength(def.max);
  if (def.placeholder) input.setPlaceholder(def.placeholder);

  const modal = new ModalBuilder()
    .setCustomId(`editcard:modal:${field}:${cardId}`)
    .setTitle(def.title)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await interaction.showModal(modal);
}

export async function handleEditCardModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split(":"); // editcard:modal:<field>:<id>
  const field = parts[2]!;
  const cardId = Number(parts[3]);
  const raw = interaction.fields.getTextInputValue("value").trim();

  const patch: Record<string, unknown> = {};
  switch (field) {
    case "name":
      if (!raw) { await interaction.reply({ content: "❌ Name cannot be empty.", flags: MessageFlags.Ephemeral }); return; }
      patch.name = raw;
      break;
    case "description":
      patch.description = raw;
      break;
    case "worthValue":
    case "burnValue": {
      const value = Number(raw.replace(/,/g, ""));
      if (!Number.isInteger(value) || value < 0) {
        await interaction.reply({ content: "❌ Enter a whole number of shards, 0 or higher.", flags: MessageFlags.Ephemeral });
        return;
      }
      patch[field] = value;
      break;
    }
    default:
      await interaction.reply({ content: "❌ Unknown field.", flags: MessageFlags.Ephemeral });
      return;
  }

  try {
    await updateCard(cardId, patch as Parameters<typeof updateCard>[1]);
  } catch (err) {
    const msg = err instanceof Error && /unique|duplicate/i.test(err.message)
      ? "❌ Another card already has that name."
      : "❌ Update failed.";
    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    return;
  }

  // Re-render the panel in the original ephemeral message.
  await interaction.deferUpdate();
  await renderPanel(interaction, cardId, false);
}
