// Quests / Missions engine.
//
// Generates a deterministic daily + weekly quest set per user, tracks progress
// via lightweight event hooks scattered through the catch/pack/trade/battle/
// burn flows, and grants rewards (shards + optional free pack) on completion.
//
// Everything here is best-effort and self-contained: a failure in quest
// tracking must never break a catch, pack open, trade, or battle. Callers wrap
// recordQuestEvent in a catch (or ignore its rejection).

import { db, questProgressTable } from "@workspace/db";
import type { Quest } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { addShards } from "../db.js";
import { grantFreePack } from "../battle/pack-grant.js";
import { logger } from "../../lib/logger.js";
import type { Rarity } from "../cards-data.js";

export type QuestEventType = "catch" | "pack_open" | "trade" | "battle_win" | "burn" | "daily";

const RARITY_RANK: Record<string, number> = {
  common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6,
};

// ── Templates ────────────────────────────────────────────────────────────────
// A pool the daily/weekly generator draws from. Weekly variants scale goals and
// rewards up. `rarityMin` narrows catch quests to a tier floor.
type QuestTemplate = Omit<Quest, "progress" | "done">;

const DAILY_TEMPLATES: QuestTemplate[] = [
  { key: "d_catch5", label: "Catch 5 cards", emoji: "🎯", type: "catch", goal: 5, rewardShards: 80 },
  { key: "d_catch10", label: "Catch 10 cards", emoji: "🎯", type: "catch", goal: 10, rewardShards: 140 },
  { key: "d_rare3", label: "Catch 3 Rare-or-better cards", emoji: "🔵", type: "catch", rarityMin: "rare", goal: 3, rewardShards: 150 },
  { key: "d_epic1", label: "Catch an Epic-or-better card", emoji: "🟣", type: "catch", rarityMin: "epic", goal: 1, rewardShards: 120 },
  { key: "d_pack2", label: "Open 2 packs", emoji: "📦", type: "pack_open", goal: 2, rewardShards: 100 },
  { key: "d_trade1", label: "Complete a trade", emoji: "🔄", type: "trade", goal: 1, rewardShards: 90 },
  { key: "d_burn5", label: "Burn 5 duplicate cards", emoji: "🔥", type: "burn", goal: 5, rewardShards: 70 },
  { key: "d_battle1", label: "Win a battle", emoji: "⚔️", type: "battle_win", goal: 1, rewardShards: 110 },
  { key: "d_daily1", label: "Claim your daily reward", emoji: "🎁", type: "daily", goal: 1, rewardShards: 50 },
];

const WEEKLY_TEMPLATES: QuestTemplate[] = [
  { key: "w_catch40", label: "Catch 40 cards this week", emoji: "🎯", type: "catch", goal: 40, rewardShards: 500, rewardPackTier: "basic" },
  { key: "w_rare15", label: "Catch 15 Rare-or-better cards", emoji: "🔵", type: "catch", rarityMin: "rare", goal: 15, rewardShards: 550 },
  { key: "w_legendary1", label: "Catch a Legendary-or-better card", emoji: "🟡", type: "catch", rarityMin: "legendary", goal: 1, rewardShards: 600 },
  { key: "w_pack10", label: "Open 10 packs", emoji: "📦", type: "pack_open", goal: 10, rewardShards: 450, rewardPackTier: "basic" },
  { key: "w_trade5", label: "Complete 5 trades", emoji: "🔄", type: "trade", goal: 5, rewardShards: 500 },
  { key: "w_battle5", label: "Win 5 battles", emoji: "⚔️", type: "battle_win", goal: 5, rewardShards: 550 },
  { key: "w_burn25", label: "Burn 25 duplicate cards", emoji: "🔥", type: "burn", goal: 25, rewardShards: 400 },
];

const DAILY_COUNT = 3;
const WEEKLY_COUNT = 3;

// ── Period keys ──────────────────────────────────────────────────────────────
export function dailyKey(d = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// ISO week key: YYYY-Www (UTC). Stable Monday-based week.
export function weeklyKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── Deterministic per-user selection ─────────────────────────────────────────
// Seed the shuffle from (userId + periodKey) so each user gets a stable-but-
// varied set that rotates each day/week and differs between players.
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickTemplates(pool: QuestTemplate[], count: number, seed: number): QuestTemplate[] {
  // Fisher-Yates with a seeded LCG.
  const arr = [...pool];
  let state = seed || 1;
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(count, arr.length));
}

function newQuestSet(userId: string, period: "daily" | "weekly", periodKey: string): Quest[] {
  const pool = period === "daily" ? DAILY_TEMPLATES : WEEKLY_TEMPLATES;
  const count = period === "daily" ? DAILY_COUNT : WEEKLY_COUNT;
  const seed = hashSeed(`${userId}:${periodKey}`);
  return pickTemplates(pool, count, seed).map(t => ({ ...t, progress: 0, done: false }));
}

// ── Fetch / ensure the current period rows ───────────────────────────────────
async function ensurePeriod(
  guildId: string, userId: string, period: "daily" | "weekly", periodKey: string,
): Promise<Quest[]> {
  const [row] = await db.select().from(questProgressTable)
    .where(and(
      eq(questProgressTable.guildId, guildId),
      eq(questProgressTable.userId, userId),
      eq(questProgressTable.period, period),
      eq(questProgressTable.periodKey, periodKey),
    )).limit(1);
  if (row) return row.quests;

  const quests = newQuestSet(userId, period, periodKey);
  await db.insert(questProgressTable)
    .values({ guildId, userId, period, periodKey, quests })
    .onConflictDoNothing();
  // Re-read in case a concurrent insert won.
  const [after] = await db.select().from(questProgressTable)
    .where(and(
      eq(questProgressTable.guildId, guildId),
      eq(questProgressTable.userId, userId),
      eq(questProgressTable.period, period),
      eq(questProgressTable.periodKey, periodKey),
    )).limit(1);
  return after?.quests ?? quests;
}

export interface QuestView {
  daily: { periodKey: string; quests: Quest[] };
  weekly: { periodKey: string; quests: Quest[] };
}

export async function getQuestView(guildId: string, userId: string): Promise<QuestView> {
  const dKey = dailyKey();
  const wKey = weeklyKey();
  const [daily, weekly] = await Promise.all([
    ensurePeriod(guildId, userId, "daily", dKey),
    ensurePeriod(guildId, userId, "weekly", wKey),
  ]);
  return { daily: { periodKey: dKey, quests: daily }, weekly: { periodKey: wKey, quests: weekly } };
}

// ── Event tracking ───────────────────────────────────────────────────────────
export interface CompletedQuest {
  quest: Quest;
  period: "daily" | "weekly";
}

function questMatches(q: Quest, type: QuestEventType, rarity?: Rarity): boolean {
  if (q.done || q.type !== type) return false;
  if (q.type === "catch" && q.rarityMin) {
    if (!rarity) return false;
    return (RARITY_RANK[rarity] ?? 0) >= (RARITY_RANK[q.rarityMin] ?? 99);
  }
  return true;
}

async function applyToPeriod(
  guildId: string, userId: string, period: "daily" | "weekly", periodKey: string,
  type: QuestEventType, amount: number, rarity: Rarity | undefined,
): Promise<CompletedQuest[]> {
  const quests = await ensurePeriod(guildId, userId, period, periodKey);
  let changed = false;
  const completed: CompletedQuest[] = [];
  for (const q of quests) {
    if (!questMatches(q, type, rarity)) continue;
    q.progress = Math.min(q.goal, q.progress + amount);
    changed = true;
    if (q.progress >= q.goal && !q.done) {
      q.done = true;
      completed.push({ quest: q, period });
    }
  }
  if (!changed) return [];

  await db.update(questProgressTable)
    .set({ quests, updatedAt: new Date() })
    .where(and(
      eq(questProgressTable.guildId, guildId),
      eq(questProgressTable.userId, userId),
      eq(questProgressTable.period, period),
      eq(questProgressTable.periodKey, periodKey),
    ));

  // Grant rewards for newly-completed quests.
  for (const c of completed) {
    if (c.quest.rewardShards > 0) {
      await addShards(guildId, userId, c.quest.rewardShards).catch(() => undefined);
    }
    if (c.quest.rewardPackTier) {
      await grantFreePack(guildId, userId, c.quest.rewardPackTier).catch(() => undefined);
    }
  }
  return completed;
}

// Fire-and-forget entry point. Returns the quests completed by this event so a
// caller CAN surface them, but callers may also ignore the result entirely.
export async function recordQuestEvent(
  guildId: string, userId: string, type: QuestEventType,
  amount = 1, rarity?: Rarity,
): Promise<CompletedQuest[]> {
  if (amount <= 0) return [];
  try {
    const [d, w] = await Promise.all([
      applyToPeriod(guildId, userId, "daily", dailyKey(), type, amount, rarity),
      applyToPeriod(guildId, userId, "weekly", weeklyKey(), type, amount, rarity),
    ]);
    const completed = [...d, ...w];
    // Unified account XP: one award per quest completed (best-effort).
    if (completed.length > 0) {
      const { awardPlayerXp, XP } = await import("../player/xp.js");
      await awardPlayerXp(guildId, userId, "quest", XP.quest * completed.length);
    }
    return completed;
  } catch (err) {
    logger.warn({ err, guildId, userId, type }, "recordQuestEvent failed (non-fatal)");
    return [];
  }
}

// Formats completed quests for an inline "quest complete!" notice.
export function formatQuestCompletions(completed: CompletedQuest[]): string | null {
  if (completed.length === 0) return null;
  const lines = completed.map(c => {
    const pack = c.quest.rewardPackTier ? ` + 📦 ${c.quest.rewardPackTier} pack` : "";
    const scope = c.period === "weekly" ? "Weekly" : "Daily";
    return `✅ **${scope} Quest:** ${c.quest.emoji} ${c.quest.label} — 💠 **${c.quest.rewardShards.toLocaleString()}**${pack}`;
  });
  return "🎯 **Quest complete!**\n" + lines.join("\n");
}
