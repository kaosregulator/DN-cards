// ─────────────────────────────────────────────────────────────────────────────
// Shared card reveal canvas — the same hero image players see after a successful
// catch, reusable anywhere a card should be shown off (/info, Battle Stats).
//
// Mirrors spawn-manager's buildCatchPreview (renderCardReveal + the battle stat
// engine) so /info and the Battle Stats view render the identical catch canvas.
// Best-effort: returns null if the native canvas isn't available or a draw
// throws, so callers fall back to the plain card image.
// ─────────────────────────────────────────────────────────────────────────────

import { AttachmentBuilder } from "discord.js";
import { renderCardReveal, type RevealStats, type RevealInfo } from "../animations/index.js";
import { withGuildFrames } from "../animations/card-frames.js";
import type { RenderCard } from "../battle/image/render.js";
import {
  getAllCardsCached, getRarityContext, getOrCreateGuildSettings,
  getRarityDisplayOverrides, getCardDisplayRarity,
} from "../db.js";
import { getBattleSettings } from "../battle/config-engine.js";
import { getScaledStats } from "../battle/stat-engine.js";
import { getStarRank } from "./stars.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import type { Rarity } from "../cards-data.js";
import { logger } from "../../lib/logger.js";

export const CARD_REVEAL_FILE = "card-reveal.png";

export interface CardRevealResult {
  file: AttachmentBuilder;
  color: number;
}

// Render the reveal canvas for a card. `withStats` includes the Level-1 battle
// stat block (as on a catch); omit it for a clean art-only reveal. `userId`,
// when given, layers the owner's ⭐ Star Rank into the Level-1 stats.
export async function renderCardRevealCanvas(
  guildId: string, cardId: number,
  opts: { withStats?: boolean; shiny?: boolean; userId?: string; info?: RevealInfo | null } = {},
): Promise<CardRevealResult | null> {
  try {
    const [cards, ctx, settings, displayMap, battleSettings] = await Promise.all([
      getAllCardsCached(guildId),
      getRarityContext(guildId),
      getOrCreateGuildSettings(guildId),
      getRarityDisplayOverrides(guildId),
      getBattleSettings(guildId).catch(() => null),
    ]);
    const card = cards.find(c => c.id === cardId);
    if (!card) return null;
    const display = getCardDisplayRarity(card, ctx, settings, displayMap);
    const color = display.color ?? 0x00b894;

    let stats: RevealStats | null = null;
    if (opts.withStats && battleSettings) {
      const star = opts.userId ? await getStarRank(guildId, opts.userId, card.id).catch(() => 0) : 0;
      const s = getScaledStats(
        { id: card.id, name: card.name, rarity: card.rarity, worthValue: card.worthValue, cardType: card.cardType },
        null, battleSettings, 1, undefined, star,
      );
      stats = {
        hp: s.maxHealth, atk: s.attack, def: s.defense, spd: s.speed,
        critChance: Math.round(s.critChance), accuracy: Math.round(s.accuracy),
      };
    }

    const renderCard: RenderCard = {
      name: card.name,
      rarity: card.rarity as Rarity,
      rarityLabel: display.label,
      rarityColor: display.color,
      cardId: card.id,
      cardType: card.cardType,
      artUrl: toAbsoluteImageUrl(card.imageUrl),
    };
    const canvas = await withGuildFrames(settings, () => renderCardReveal({ card: renderCard, stats, info: opts.info ?? null, shiny: !!opts.shiny, index: 1, total: 1 }));
    if (!canvas) return null;
    return { file: new AttachmentBuilder(canvas, { name: CARD_REVEAL_FILE }), color };
  } catch (err) {
    logger.debug({ err, guildId, cardId }, "renderCardRevealCanvas failed (non-fatal)");
    return null;
  }
}
