// ─────────────────────────────────────────────────────────────────────────────
// HQ — catch drops.
//
// A small chance that catching a card also yields a Headquarters cosmetic, so
// the collection loop feeds the HQ without a separate grind (the same pull-based
// spirit as the rest of the engine). Droppable items are pure data (any
// decoration with `drop: true`); a drop is granted into the existing hq_unlocks
// ledger with source "drop". Rarer items are weighted lower so a drop still
// feels like a small win, not a jackpot.
//
// Called best-effort from the catch flow (spawn-manager.ts); it must never throw
// into or slow down a catch.
// ─────────────────────────────────────────────────────────────────────────────

import { HQ_DECORATIONS } from "./defs/decorations.js";
import { BUILTIN_RARITIES, type Rarity } from "../cards-data.js";
import { getUnlockedItemIds, grantUnlock } from "./db.js";

// Base per-catch chance that ANY drop happens.
const DROP_CHANCE = 0.1;

const DROPPABLE = HQ_DECORATIONS.filter(d => d.drop);

// Inverse-rarity weight: commons drop most often, top tiers rarely.
const RARITY_WEIGHT: Record<Rarity, number> =
  Object.fromEntries(
    BUILTIN_RARITIES.map((r, i) => [r, Math.max(1, BUILTIN_RARITIES.length - i)]),
  ) as Record<Rarity, number>;

export interface CatchDrop { id: string; name: string; emoji: string }

// Roll for a catch drop. Returns the granted decoration, or null when nothing
// dropped (no roll hit, or the player already owns every droppable item).
export async function rollCatchDrop(guildId: string, userId: string): Promise<CatchDrop | null> {
  if (DROPPABLE.length === 0) return null;
  if (Math.random() >= DROP_CHANCE) return null;

  const owned = await getUnlockedItemIds(guildId, userId);
  const pool = DROPPABLE.filter(d => !owned.has(d.id));
  if (pool.length === 0) return null;

  const total = pool.reduce((s, d) => s + (RARITY_WEIGHT[d.rarity] ?? 1), 0);
  let roll = Math.random() * total;
  let pick = pool[0]!;
  for (const d of pool) {
    roll -= RARITY_WEIGHT[d.rarity] ?? 1;
    if (roll <= 0) { pick = d; break; }
  }

  const granted = await grantUnlock(guildId, userId, pick.id, "decoration", "drop").catch(() => false);
  if (!granted) return null; // lost a race / already owned
  return { id: pick.id, name: pick.name, emoji: pick.emoji };
}
