// Configuration Engine — per-guild battle settings.
//
// Owns reads/writes of `battle_settings`. Every server has its own row; a
// missing row is created lazily with sane defaults (battles stay locked until
// an admin runs the setup wizard, which flips `setupComplete`). A tiny 5s
// per-guild cache mirrors the pattern used elsewhere in the bot.

import { db, battleSettingsTable } from "@workspace/db";
import type { BattleSettings } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Rarity } from "./types.js";

export const RARITY_ORDER: Rarity[] = [
  "common", "uncommon", "rare", "epic", "legendary", "mythic",
];

export function rarityRank(r: Rarity): number {
  const i = RARITY_ORDER.indexOf(r);
  return i < 0 ? 0 : i;
}

const _cache = new Map<string, { value: BattleSettings; expiresAt: number }>();
const TTL_MS = 5_000;

export async function getBattleSettings(guildId: string): Promise<BattleSettings> {
  const cached = _cache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const [row] = await db.select().from(battleSettingsTable)
    .where(eq(battleSettingsTable.guildId, guildId)).limit(1);
  const value = row ?? (await db.insert(battleSettingsTable).values({ guildId }).returning())[0]!;
  _cache.set(guildId, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export async function updateBattleSettings(
  guildId: string, patch: Partial<BattleSettings>,
): Promise<BattleSettings> {
  await getBattleSettings(guildId); // ensure a row exists
  const [row] = await db.update(battleSettingsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(battleSettingsTable.guildId, guildId))
    .returning();
  invalidateBattleSettings(guildId);
  return row!;
}

export function invalidateBattleSettings(guildId?: string): void {
  if (guildId) _cache.delete(guildId);
  else _cache.clear();
}

// Is a card's rarity inside the guild's allowed [min, max] window?
export function rarityAllowed(settings: BattleSettings, rarity: Rarity): boolean {
  const r = rarityRank(rarity);
  return r >= rarityRank(settings.minRarity as Rarity)
      && r <= rarityRank(settings.maxRarity as Rarity);
}

export function typeAllowed(settings: BattleSettings, cardType: string): boolean {
  const allow = settings.allowedTypes;
  if (!allow || allow.length === 0) return true;
  return allow.map(t => t.toLowerCase()).includes((cardType ?? "").toLowerCase());
}
