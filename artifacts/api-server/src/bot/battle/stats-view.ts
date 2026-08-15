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
import { getRarityContext } from "../db.js";
import { effectiveRarityKey, rarityLadderRank } from "../rarity-runtime.js";
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

// "View animation" — shown on /info for cards whose art is an animated GIF.
// The /info hero is a rendered canvas (a still), so this button surfaces the
// live, looping GIF that Discord animates natively. See index.ts `cardgif`.
export function cardAnimationButtonId(cardId: number): string {
  return `cardgif:${cardId}`;
}

// The /info button row: always Battle Stats; adds ▶️ View Animation when the
// card's art is an animated GIF so the canvas hero doesn't hide the animation.
export function infoButtonRow(cardId: number, animated: boolean): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(battleStatsButtonId(cardId))
      .setLabel("⚔️ Battle Stats")
      .setStyle(ButtonStyle.Secondary),
  );
  if (animated) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(cardAnimationButtonId(cardId))
        .setLabel("▶️ View Animation")
        .setStyle(ButtonStyle.Primary),
    );
  }
  return row;
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
  const [settings, config, progress, ctx] = await Promise.all([
    getBattleSettings(guildId),
    getBattleCardConfig(guildId, card.id),
    getCardProgress(guildId, userId, card.id),
    getRarityContext(guildId).catch(() => null),
  ]);
  const level = progress?.level ?? 1;
  const rarity = (effectiveRarity ?? (card.rarity as Rarity));
  // Star Rank + guild strength-ladder rank so this view matches real combat.
  const rank = rarityLadderRank(config?.rarity ? String(config.rarity) : (ctx ? effectiveRarityKey(card, ctx) : card.rarity), ctx);
  const stats = getScaledStats(
    { id: card.id, name: card.name, rarity: card.rarity as Rarity, worthValue: card.worthValue, cardType: card.cardType },
    config, settings, level, rarity, progress?.starRank ?? 0, rank,
  );

  const movesetKey = config?.moveset ?? inferMoveset(card.cardType, rarity);
  const moveset = getMoveset(movesetKey);

  // The core stat grid (ATK / SPD / DEF / HP / CRIT / ACC) is rendered onto the
  // reveal canvas the caller attaches, so we don't repeat it as embed text. The
  // embed carries only what the canvas doesn't: the special move, dodge/luck,
  // and the power rating.
  const embed = new EmbedBuilder()
    .setTitle(`⚔️ ${card.name} — Battle Stats`)
    .setColor(0xe74c3c)
    .setDescription(`Stats shown are scaled to **Level ${level}**${progress ? "" : " (unowned/base)"}. Core stats are on the card below.`)
    .addFields(
      {
        name: "💥 Special",
        value: moveset ? `${moveset.emoji} **${moveset.name}** — ${moveset.description}` : "_None assigned._",
        inline: false,
      },
      { name: "🛡️ Dodge / ✨ Luck", value: `${stats.dodge}% / ${stats.luck}`, inline: true },
      { name: "📊 Power Rating", value: `${powerRating(stats)}`, inline: true },
    )
    .setFooter({ text: "Jump to /level for XP progress & frames ↓" });

  return embed;
}
