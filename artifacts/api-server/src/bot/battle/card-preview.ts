// ─────────────────────────────────────────────────────────────────────────────
// Card battle preview — one reusable read that surfaces a card's battle-facing
// info (Level-1 stats with Star Rank bonus, signature move, special ability) for
// Collection/Search/Card-Viewer detail pages. Reuses the existing stat engine,
// moveset + special registries, and the Star Rank module — no new battle logic.
// ─────────────────────────────────────────────────────────────────────────────

import type { Card } from "@workspace/db";
import type { Rarity } from "../cards-data.js";
import { getBattleSettings } from "./config-engine.js";
import { getBattleCardConfig } from "./db.js";
import { getScaledStats } from "./stat-engine.js";
import { getMoveset, inferMoveset } from "./movesets.js";
import { getEffectDef, inferSpecialEffect } from "./special-cards.js";
import { getStarRank } from "../cards/stars.js";

export interface CardBattlePreview {
  starRank: number;
  stats: { hp: number; atk: number; def: number; spd: number; crit: number; acc: number };
  move: { name: string; emoji: string; description: string } | null;
  special: { name: string; emoji: string; description: string } | null;
}

export async function getCardBattlePreview(
  guildId: string,
  userId: string,
  card: Pick<Card, "id" | "name" | "rarity" | "worthValue" | "cardType">,
): Promise<CardBattlePreview | null> {
  const [settings, cfg, starRank] = await Promise.all([
    getBattleSettings(guildId).catch(() => null),
    getBattleCardConfig(guildId, card.id).catch(() => null),
    getStarRank(guildId, userId, card.id).catch(() => 0),
  ]);
  if (!settings) return null;

  const battleRarity = (cfg?.rarity as Rarity) || (card.rarity as Rarity);
  const s = getScaledStats(card, cfg, settings, 1, battleRarity, starRank);
  const moveset = getMoveset(cfg?.moveset ?? inferMoveset(card.cardType, battleRarity));
  const special = getEffectDef(cfg?.specialEffect ?? inferSpecialEffect(card.cardType, battleRarity));

  return {
    starRank,
    stats: {
      hp: s.maxHealth, atk: s.attack, def: s.defense, spd: s.speed,
      crit: Math.round(s.critChance), acc: Math.round(s.accuracy),
    },
    move: moveset ? { name: moveset.name, emoji: moveset.emoji, description: moveset.description } : null,
    special: special ? { name: special.label, emoji: special.emoji, description: special.description } : null,
  };
}
