// Battle Stats View — a READ-ONLY display of a card's battle identity
// (attack / move-speed / special) plus a quick-jump button into `/level`.
//
// This module never touches combat resolution: it only reads through the
// existing `getScaledStats` / moveset registry (the exact same pure functions
// combat-engine and battle-manager already use) and renders an embed. It does
// not mutate any card, config, or in-progress battle state.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { getBattleSettings } from "./config-engine.js";
import { getBattleCardConfig } from "./db.js";
import { getScaledStats, powerRating } from "./stat-engine.js";
import { getMoveset, inferMoveset } from "./movesets.js";
import { getCardProgress } from "../cards/leveling.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import type { Rarity } from "./types.js";

export interface StatsViewCard {
  id: number;
  name: string;
  rarity: string;
  cardType: string;
  worthValue: number;
  imageUrl: string | null;
}

export function battleStatsButtonId(cardId: number): string {
  return `battlestats:${cardId}`;
}

export function battleStatsButtonRow(cardId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(battleStatsButtonId(cardId))
      .setLabel("⚔️ Battle Stats")
      .setStyle(ButtonStyle.Secondary),
  );
}

// Quick-jump: renders the exact same embed `/level name:<card>` would, without
// the player having to type the command. Purely additive — reuses
// `buildCardLevelEmbed` from the cards module (see level-command.ts).
export function battleStatsLevelJumpButtonId(cardId: number): string {
  return `battlestats_level:${cardId}`;
}

export function battleStatsLevelJumpRow(cardId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(battleStatsLevelJumpButtonId(cardId))
      .setLabel("🎖️ Jump to Level")
      .setStyle(ButtonStyle.Primary),
  );
}

// Builds the stats-view embed for `card`, scaled to `userId`'s level for that
// card (or level 1 if unowned/never leveled). `effectiveRarity` should be the
// same resolved tier the caller already computed (e.g. from /info's rarity
// context) so the numbers match what the player sees elsewhere; falls back to
// the card's base rarity when not supplied.
export async function buildBattleStatsEmbed(
  guildId: string,
  userId: string,
  card: StatsViewCard,
  effectiveRarity?: Rarity,
): Promise<EmbedBuilder> {
  const [settings, config, progress] = await Promise.all([
    getBattleSettings(guildId),
    getBattleCardConfig(guildId, card.id),
    getCardProgress(guildId, userId, card.id),
  ]);
  const level = progress?.level ?? 1;
  const rarity = (effectiveRarity ?? (card.rarity as Rarity));
  const stats = getScaledStats(
    { id: card.id, name: card.name, rarity: card.rarity as Rarity, worthValue: card.worthValue, cardType: card.cardType },
    config, settings, level, rarity,
  );

  const movesetKey = config?.moveset ?? inferMoveset(card.cardType, rarity);
  const moveset = getMoveset(movesetKey);

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ ${card.name} — Battle Stats`)
    .setColor(0xe74c3c)
    .setDescription(`Stats shown are scaled to **Level ${level}**${progress ? "" : " (unowned/base)"}.`)
    .addFields(
      { name: "🗡️ Attack", value: `${stats.attack}`, inline: true },
      { name: "🏃 Move (Speed)", value: `${stats.speed}`, inline: true },
      { name: "🛡️ Defense", value: `${stats.defense}`, inline: true },
      { name: "❤️ Health", value: `${stats.maxHealth}`, inline: true },
      { name: "🎯 Accuracy / Dodge", value: `${stats.accuracy}% / ${stats.dodge}%`, inline: true },
      { name: "✨ Crit / Luck", value: `${stats.critChance}% / ${stats.luck}`, inline: true },
      {
        name: "💥 Special",
        value: moveset ? `${moveset.emoji} **${moveset.name}** — ${moveset.description}` : "_None assigned._",
        inline: false,
      },
      { name: "📊 Power Rating", value: `${powerRating(stats)}`, inline: true },
    )
    .setFooter({ text: "Jump to /level for XP progress & frames ↓" });
  const img = toAbsoluteImageUrl(card.imageUrl);
  if (img) embed.setThumbnail(img);

  return embed;
}
