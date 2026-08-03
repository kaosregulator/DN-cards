// ─────────────────────────────────────────────────────────────────────────────
// /show-shiny — show off your shiny cards.
//
// The sibling of the /user-hub "🏆 Show Card" trophy, but built for SHINIES and
// wired as its own slash command. It renders the same premium holo/foil/shine
// effect used by the shiny catch reveal (renderShinyShowcase) and posts it
// PUBLICLY in the channel so everyone can admire the sparkle.
//
//   • You own exactly one shiny → it's posted straight away.
//   • You own several           → an ephemeral picker (+ "✨ Show Best") lets you
//                                  choose which one to flex.
//
// Every path is scoped to the invoker; the only public output is the final
// showcase image the user chooses to post.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ChatInputCommandInteraction, StringSelectMenuInteraction, ButtonInteraction,
} from "discord.js";
import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, MessageFlags, AttachmentBuilder,
} from "discord.js";
import { getUserCollection, getOrCreateGuildSettings } from "../db.js";
import { getShinyName, SHINY_EMOJI, type Rarity } from "../cards-data.js";
import { getCardProgress, starsForLevel } from "../cards/leveling.js";
import { renderShinyShowcase } from "../animations/index.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import { logger } from "../../lib/logger.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

// How long the public showcase stays in the channel before it self-deletes.
// Mirrors the /user-hub "Show Card" trophy showcase.
const SHOWCASE_TTL_MS = 40_000;

type ShinyItem = Awaited<ReturnType<typeof getUserCollection>>[number];

// The invoker's shiny cards, best first (worth → shiny copies → name).
async function getShinyCards(guildId: string, userId: string): Promise<ShinyItem[]> {
  const items = await getUserCollection(guildId, userId);
  return items
    .filter(i => (i.shinyCount ?? 0) > 0)
    .sort((a, b) =>
      b.worthValue - a.worthValue ||
      (b.shinyCount ?? 0) - (a.shinyCount ?? 0) ||
      a.name.localeCompare(b.name));
}

// ── Slash entry ───────────────────────────────────────────────────────────────
export async function handleShowShinyCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "❌ This command can only be used in a server.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  const shinies = await getShinyCards(guildId, interaction.user.id);

  if (shinies.length === 0) {
    await interaction.reply({
      content: `${SHINY_EMOJI} You don't have any shinies yet. Catch or pull a **shiny** card, then come back to show it off!`,
      ...EPHEMERAL,
    }).catch(() => {});
    return;
  }

  // A single shiny — no need to pick, post it straight away.
  if (shinies.length === 1) {
    await interaction.deferReply(EPHEMERAL).catch(() => {});
    await postShiny(interaction, shinies[0]!);
    return;
  }

  // Several shinies — offer a picker (+ Show Best).
  await interaction.reply(buildPickerView(shinies)).catch(() => {});
}

// ── Component routing (show-shiny:*) ──────────────────────────────────────────
export async function handleShowShinyComponent(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;
  const action = interaction.customId.split(":")[1];

  if (action === "best" && interaction.isButton()) {
    const shinies = await getShinyCards(guildId, interaction.user.id);
    if (shinies.length === 0) {
      await interaction.reply({ content: `${SHINY_EMOJI} No shinies to show off yet.`, ...EPHEMERAL }).catch(() => {});
      return;
    }
    await interaction.deferReply(EPHEMERAL).catch(() => {});
    await postShiny(interaction, shinies[0]!);
    return;
  }

  if (action === "pick" && interaction.isStringSelectMenu()) {
    const cardId = Number(interaction.values[0]);
    const item = (await getUserCollection(guildId, interaction.user.id))
      .find(i => i.cardId === cardId && (i.shinyCount ?? 0) > 0);
    if (!item) {
      await interaction.reply({ content: "❌ You don't own a shiny copy of that card anymore.", ...EPHEMERAL }).catch(() => {});
      return;
    }
    await interaction.deferReply(EPHEMERAL).catch(() => {});
    await postShiny(interaction, item);
    return;
  }
}

// ── Picker view ───────────────────────────────────────────────────────────────
function buildPickerView(shinies: ShinyItem[]) {
  const select = new StringSelectMenuBuilder()
    .setCustomId("show-shiny:pick")
    .setPlaceholder("Pick a shiny to show off…")
    .addOptions(
      shinies.slice(0, 24).map(item => ({
        label: `${item.name.slice(0, 80)}${item.shinyCount > 1 ? ` ×${item.shinyCount}` : ""}`,
        value: item.cardId.toString(),
        description: `${item.rarity} · ${item.worthValue} shards`,
        emoji: SHINY_EMOJI,
      })),
    );
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`${SHINY_EMOJI} Show Shiny`)
    .setDescription(
      `You have **${shinies.length}** shiny cards. Pick one below to post it with the full shiny effect, ` +
      "or hit **Show Best** to flex your most valuable shiny instantly.",
    );
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("show-shiny:best").setLabel("Show Best").setEmoji(SHINY_EMOJI).setStyle(ButtonStyle.Success),
      ),
    ],
    ...EPHEMERAL,
  };
}

// ── Render + public post ──────────────────────────────────────────────────────
// The interaction is expected to already be deferred ephemerally. We render the
// animated shiny showcase, acknowledge the invoker privately, then post the
// image publicly in-channel for everyone to see.
async function postShiny(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  item: ShinyItem,
): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  const [settings, progress] = await Promise.all([
    getOrCreateGuildSettings(guildId),
    getCardProgress(guildId, userId, item.cardId),
  ]);
  const level = progress?.level ?? 1;
  const stars = starsForLevel(level);
  const shinyLabel = getShinyName(settings);

  const img = await renderShinyShowcase({
    artUrl: toAbsoluteImageUrl(item.imageUrl),
    rarity: item.rarity as Rarity,
    rarityLabel: (item.rarity as string).toUpperCase(),
    rarityColor: null,
    name: item.name,
    ownerName: interaction.user.username,
    level,
    stars,
    shinyCount: item.shinyCount,
    shinyLabel,
  }).catch(() => null);

  await interaction.editReply({ content: `${SHINY_EMOJI} Showing off your shiny…` }).catch(() => {});

  const channel = interaction.channel;
  if (!channel || !("send" in channel) || !channel.isSendable?.()) {
    await interaction.editReply({ content: "❌ I can't post in this channel." }).catch(() => {});
    return;
  }

  const copies = item.shinyCount > 1 ? ` (${shinyLabel} ×${item.shinyCount})` : "";
  const content = `${SHINY_EMOJI} <@${userId}> shows off their shiny **${item.name}**${copies}`;

  let msg: { delete: () => Promise<unknown> } | null;
  if (img) {
    msg = await channel.send({
      content,
      files: [new AttachmentBuilder(img, { name: "shiny-showcase.gif" })],
      allowedMentions: { users: [] },
    }).catch((err: unknown) => { logger.debug({ err }, "show-shiny: public post failed"); return null; });
  } else {
    // Canvas unavailable — still show something, using the plain card art.
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`${SHINY_EMOJI} ${item.name}`)
      .setDescription(`${(item.rarity as string).toUpperCase()} · Lv ${level} ${"★".repeat(stars)}${"☆".repeat(5 - stars)}`)
      .setImage(toAbsoluteImageUrl(item.imageUrl));
    msg = await channel.send({ content, embeds: [embed], allowedMentions: { users: [] } })
      .catch((err: unknown) => { logger.debug({ err }, "show-shiny: public fallback post failed"); return null; });
  }
  // Auto-clean the public showcase so channels don't fill up with flexes —
  // same TTL as the /user-hub trophy showcase.
  if (msg) setTimeout(() => { void msg!.delete().catch(() => {}); }, SHOWCASE_TTL_MS);
}
