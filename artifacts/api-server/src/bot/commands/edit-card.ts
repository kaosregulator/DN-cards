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
import {
  getCardByName, getCardById, updateCard,
  getOrCreateGuildSettings, getRarityDisplayOverrides,
  getRarityContext, listCustomRarities, assignCardToCustomRarity, unassignCardCustomRarity,
} from "../db.js";
import { RARITY_EMOJI, RARITY_LABELS, RARITY_COLORS, rarityLabel, rarityEmoji, rarityColor, type Rarity } from "../cards-data.js";

const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
const TYPE_CHOICES = ["tank", "aircraft", "ship", "vehicle", "infantry", "boss", "community", "event", "achievement", "limited"];

// ── Preview embed + field-picker select ─────────────────────────────────────
async function buildPanel(cardId: number, guildId?: string | null): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } | null> {
  const card = await getCardById(cardId);
  if (!card) return null;
  const r = card.rarity as Rarity;
  const [settings, displayMap, ctx] = guildId
    ? await Promise.all([
        getOrCreateGuildSettings(guildId),
        getRarityDisplayOverrides(guildId),
        getRarityContext(guildId),
      ])
    : [null, null, null] as const;
  const customTier = ctx?.customByCard.get(card.id);
  const displayLabel = customTier?.name ?? rarityLabel(r, settings, displayMap);
  const displayEmoji = customTier?.emoji ?? rarityEmoji(r, settings, displayMap);
  const displayColor = customTier?.color ?? rarityColor(r, settings, displayMap);
  const embed = new EmbedBuilder()
    .setTitle(`✏️ Edit: ${card.name}`)
    .setColor(displayColor ?? RARITY_COLORS[r] ?? 0x5865f2)
    .setDescription(card.description || "_(no description)_")
    .addFields(
      { name: "Rarity", value: `${displayEmoji} ${displayLabel}`, inline: true },
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
      { label: "Rarity", value: "rarity", emoji: "✨", description: `Currently ${displayLabel}` },
      { label: "Name", value: "name", emoji: "🏷️" },
      { label: "Description", value: "description", emoji: "📝" },
      { label: "Type", value: "type", emoji: "🎯", description: `Currently ${card.cardType}` },
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
    await updateCard(card.id, { imageUrl: image.url });
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

    // Rarity → secondary select. Built-ins keep stable card identity; custom
    // rarities write to the same per-card override table used by the runtime.
    if (value === "rarity") {
      const [settings, displayMap, customTiers] = interaction.guildId
        ? await Promise.all([
            getOrCreateGuildSettings(interaction.guildId),
            getRarityDisplayOverrides(interaction.guildId),
            listCustomRarities(interaction.guildId),
          ])
        : [null, null, []] as const;
      const options = [
        ...RARITIES.map(r => ({
          label: rarityLabel(r, settings, displayMap),
          value: r,
          emoji: rarityEmoji(r, settings, displayMap) ?? RARITY_EMOJI[r] ?? "🃏",
          description: "built-in",
        })),
        ...customTiers.slice(0, 25 - RARITIES.length).map(t => ({
          label: t.name,
          value: `custom:${t.slug}`,
          emoji: t.emoji,
          description: "custom",
        })),
      ];
      const select = new StringSelectMenuBuilder()
        .setCustomId(`editcard:rarity:${cardId}`)
        .setPlaceholder("Pick a rarity…")
        .addOptions(options);
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

  // Rarity sub-select (built-in OR custom:slug)
  if (sub === "rarity") {
    await interaction.deferUpdate();
    if (value.startsWith("custom:")) {
      if (!interaction.guildId) return;
      await assignCardToCustomRarity(interaction.guildId, cardId, value.slice("custom:".length));
    } else {
      if (!RARITIES.includes(value as Rarity)) return;
      await updateCard(cardId, { rarity: value });
      if (interaction.guildId) await unassignCardCustomRarity(interaction.guildId, cardId);
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
