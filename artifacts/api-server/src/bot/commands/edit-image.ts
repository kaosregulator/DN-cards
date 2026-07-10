// /edit_image — interactive admin command to update a card's image + description.
//
// Flow:
//   /edit_image name:<card>
//     → ephemeral panel with buttons: [Search MTTV] [Upload own image]
//   Search MTTV → modal asking for the MTTV item name
//   Modal submit → fuzzy search results shown as buttons
//   Pick a result → image + description pulled from MTTV and saved
//   Upload own image → instructions (use the slash command's image option)
//
// You can also skip the panel by providing the image option directly:
//   /edit_image name:<card> image:<file>

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, MessageFlags,
} from "discord.js";
import { getCardByName, getCardById, updateCard } from "../db.js";
import { isOwnedBy } from "../home-guild.js";
import { logger } from "../../lib/logger.js";
import { renderPanel, persistBotImage } from "./edit-card.js";
import { fetchMTTVItems, matchScore, buildMTTVItemEmbed, rarityEmoji, type MTTVItem } from "./mttvalues.js";

const CUSTOM_ID_PREFIX = "editimage";
const SEARCH_TTL_MS = 15 * 60 * 1000; // 15 min

const searchStates = new Map<string, { items: MTTVItem[]; cardId: number; userId: string }>();
const searchTimers = new Map<string, ReturnType<typeof setTimeout>>();

function resetSearchTimer(messageId: string): void {
  const existing = searchTimers.get(messageId);
  if (existing) clearTimeout(existing);
  searchTimers.set(
    messageId,
    setTimeout(() => {
      searchStates.delete(messageId);
      searchTimers.delete(messageId);
    }, SEARCH_TTL_MS),
  );
}

export async function handleEditImageCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString("name", true).trim();
  const image = interaction.options.getAttachment("image");
  const guildId = interaction.guildId;
  if (!guildId) return;

  const card = await getCardByName(name, guildId);
  if (!card) {
    await interaction.editReply(`❌ No card named **${name}**. Use autocomplete to pick one.`);
    return;
  }
  if (!isOwnedBy(card, guildId)) {
    await interaction.editReply(`❌ You can only edit cards owned by this server.`);
    return;
  }

  // If the user uploaded an image directly, just apply it.
  if (image) {
    const imageUrl = await persistBotImage(image.url, image.contentType ?? undefined);
    await updateCard(card.id, { imageUrl });
    await renderPanel(interaction, card.id, false, `✅ Updated image for **${card.name}**`);
    return;
  }

  // Show the choice panel.
  const embed = new EmbedBuilder()
    .setTitle(`🖼️ Edit image: ${card.name}`)
    .setDescription("Choose where to pull the new image from.")
    .setColor(0x3498db);

  const rows = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID_PREFIX}:search:${card.id}`)
        .setLabel("Search from MTTV")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID_PREFIX}:upload:${card.id}`)
        .setLabel("Upload own image")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  await interaction.editReply({ embeds: [embed], components: rows });
}

// ── Button: open the MTTV search modal or show upload instructions ───────────
export async function handleEditImageButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const action = parts[1];
  const cardId = Number(parts[2]);
  if (Number.isNaN(cardId)) return;

  if (action === "search") {
    const modal = new ModalBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}:search_modal:${cardId}`)
      .setTitle("Search MTTV")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("query")
            .setLabel("MTTV item name")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
            .setPlaceholder("e.g. Super Tiger Mech"),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (action === "upload") {
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("📎 Upload your own image")
          .setDescription(
            `Use the command with the image option:\n` +
            `\`/edit_image name:${cardId} image:<your file>\``,
          )
          .setColor(0x95a5a6),
      ],
      components: [],
    });
  }
}

// ── Modal: run the MTTV search and show results as buttons ──────────────────
export async function handleEditImageModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const cardId = Number(parts[2]);
  if (Number.isNaN(cardId)) return;

  const query = interaction.fields.getTextInputValue("query").trim();
  if (!query) {
    await interaction.reply({ content: "❌ Search term cannot be empty.", flags: MessageFlags.Ephemeral });
    return;
  }

  let items: MTTVItem[];
  try {
    items = await fetchMTTVItems();
  } catch (err) {
    logger.error({ err }, "Failed to fetch MTTV items for edit_image modal");
    await interaction.reply({ content: "❌ Could not reach MTTV. Try again later.", flags: MessageFlags.Ephemeral });
    return;
  }

  const exact = items.find((i) => i.name.toLowerCase() === query.toLowerCase());
  if (exact && exact.image) {
    await applyMTTVItem(interaction, cardId, exact);
    return;
  }

  const results = items
    .map((i) => ({ i, score: matchScore(i, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map(({ i }) => i);

  if (results.length === 0) {
    await interaction.reply({
      content: `❌ No MTTV items found for "${query}". Try a different name or upload your own image.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let current = new ActionRowBuilder<ButtonBuilder>();
  results.forEach((res, idx) => {
    const rarity = res.rarity.map(rarityEmoji).join("") || "—";
    const label = `${rarity} ${res.name.slice(0, 80)}`.slice(0, 80);
    if (current.components.length >= 5) {
      rows.push(current);
      current = new ActionRowBuilder<ButtonBuilder>();
    }
    current.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID_PREFIX}:pick:${cardId}:${idx}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary),
    );
  });
  if (current.components.length > 0) rows.push(current);
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID_PREFIX}:cancel:${cardId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  const embed = new EmbedBuilder()
    .setTitle(`🔍 MTTV results for "${query}"`)
    .setDescription("Pick the item whose image + description you want to use.")
    .setColor(0x9b59b6);

  await interaction.reply({
    embeds: [embed],
    components: rows,
    flags: MessageFlags.Ephemeral,
  });

  const message = await interaction.fetchReply();
  searchStates.set(message.id, { items: results, cardId, userId: interaction.user.id });
  resetSearchTimer(message.id);
}

// ── Button: pick a result from the search results message ───────────────────
export async function handleEditImagePick(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const action = parts[1];
  const cardId = Number(parts[2]);

  if (action === "cancel" || Number.isNaN(cardId)) {
    await interaction.update({ content: "Cancelled.", embeds: [], components: [] }).catch(() => {});
    searchStates.delete(interaction.message.id);
    return;
  }

  if (action !== "pick") return;

  const idx = Number(parts[3]);
  const state = searchStates.get(interaction.message.id);
  if (!state || state.userId !== interaction.user.id || state.cardId !== cardId) {
    await interaction.reply({ content: "❌ This search belongs to someone else or has expired.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const item = state.items[idx];
  if (!item) {
    await interaction.reply({ content: "❌ That result is no longer available.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  await applyMTTVItem(interaction, cardId, item);
}

// ── Apply the chosen MTTV item to the card ────────────────────────────────────
async function applyMTTVItem(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  cardId: number,
  item: MTTVItem,
): Promise<void> {
  if (!item.image) {
    const content = `❌ **${item.name}** has no image on MTTV. Pick another item or upload your own.`;
    if (interaction.isButton()) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }

  const card = await getCardById(cardId);
  if (!card) {
    if (interaction.isButton()) {
      await interaction.followUp({ content: "❌ Card not found.", flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content: "❌ Card not found.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }

  const imageUrl = await persistBotImage(item.image);
  await updateCard(card.id, { imageUrl, description: item.description || "" });

  const embed = buildMTTVItemEmbed(item).setTitle(`✅ Updated ${card.name} from MTTV`);

  if (interaction.isButton()) {
    await interaction.update({ embeds: [embed], components: [] }).catch(() => {});
  } else {
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}
