// Free-pack reward — grants a pack using the EXISTING pack economy + inventory.
//
// Rather than re-implement pack logic, this reuses the guild's pack tier sizing
// and the shared weighted-pick + catchCard acquisition path, so a "free pack"
// battle reward mints real cards into the winner's collection exactly like a
// bought pack would. Best-effort: if the guild has no active spawn set, it
// silently no-ops (the caller already credited the streak shards).

import {
  getOrCreateGuildSettings, getActiveSetSpawnPoolCached, getRarityContext,
  getGuildRarityWeights, pickRandomCard, catchCard,
} from "../db.js";
import { resolveTierConfig, type PackTier } from "../commands/pack.js";
import { logger } from "../../lib/logger.js";

export async function grantFreePack(
  guildId: string, userId: string, tier: string,
): Promise<number[]> {
  try {
    const settings = await getOrCreateGuildSettings(guildId);
    const size = Math.max(1, Math.min(10, resolveTierConfig(settings, tier as PackTier).size));
    const [pool, ctx] = await Promise.all([
      getActiveSetSpawnPoolCached(guildId),
      getRarityContext(guildId),
    ]);
    if (pool.cards.length === 0) return [];
    const rarityWeights = getGuildRarityWeights(settings);
    const granted: number[] = [];
    for (let i = 0; i < size; i++) {
      const card = await pickRandomCard(rarityWeights, undefined, ctx, pool.cards, pool.rarityWeights);
      if (!card) continue;
      await catchCard(guildId, userId, card.id);
      granted.push(card.id);
    }
    return granted;
  } catch (err) {
    logger.warn({ err, guildId, userId, tier }, "grantFreePack failed (non-fatal)");
    return [];
  }
}
