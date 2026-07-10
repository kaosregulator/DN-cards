// Bob tasks (daily) + quests (long-term). Progress is fed by fire-and-forget
// events from games/roasts/talk. Completing an objective pays Bob Coins + XP
// (and quests can grant a cosmetic title). Self-contained and best-effort.

import { db, bobProgressTable, bobProfilesTable } from "@workspace/db";
import type { BobObjective, BobSettings } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { grantReward, getBobSettings } from "./db.js";
import { TITLES } from "./persona.js";
import { logger } from "../../lib/logger.js";

export type BobEventType =
  | "game_play" | "game_win" | "roulette_win" | "roulette_survive"
  | "roast" | "talk" | "jackpot" | "duel_win";

// ── Templates ────────────────────────────────────────────────────────────────
type Template = Omit<BobObjective, "progress" | "done">;

const DAILY_TEMPLATES: Template[] = [
  { key: "d_play3", label: "Play 3 Bob games", emoji: "🎮", type: "game_play", goal: 3, rewardCoins: 60, rewardXp: 40 },
  { key: "d_win1", label: "Win a Bob game", emoji: "🏆", type: "game_win", goal: 1, rewardCoins: 80, rewardXp: 50 },
  { key: "d_roulette", label: "Survive a roulette spin", emoji: "🎲", type: "roulette_survive", goal: 1, rewardCoins: 70, rewardXp: 45 },
  { key: "d_roast", label: "Roast a friend", emoji: "😂", type: "roast", goal: 1, rewardCoins: 40, rewardXp: 30 },
  { key: "d_talk", label: "Talk to Bob", emoji: "💬", type: "talk", goal: 1, rewardCoins: 30, rewardXp: 25 },
];

const QUEST_TEMPLATES: Template[] = [
  { key: "q_first", label: "Bob's First Challenge — play 10 games", emoji: "🎯", type: "game_play", goal: 10, rewardCoins: 300, rewardXp: 200, rewardTitle: TITLES.chaos },
  { key: "q_lucky", label: "Lucky Challenge — hit 3 jackpots", emoji: "💎", type: "jackpot", goal: 3, rewardCoins: 500, rewardXp: 300, rewardTitle: TITLES.jackpot },
  { key: "q_survivor", label: "Survivor — survive 15 roulette spins", emoji: "🎲", type: "roulette_survive", goal: 15, rewardCoins: 400, rewardXp: 250, rewardTitle: TITLES.survivor },
  { key: "q_roastmaster", label: "Roast Master — roast 10 times", emoji: "🔥", type: "roast", goal: 10, rewardCoins: 250, rewardXp: 180 },
  { key: "q_winner", label: "On a Roll — win 20 games", emoji: "🏆", type: "game_win", goal: 20, rewardCoins: 450, rewardXp: 280, rewardTitle: TITLES.gambler },
];

const DAILY_COUNT = 3;

export function dailyKey(d = new Date()): string { return d.toISOString().slice(0, 10); }

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function pickTemplates(pool: Template[], count: number, seed: number): Template[] {
  const arr = [...pool]; let state = seed || 1;
  const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0xffffffff; };
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j]!, arr[i]!]; }
  return arr.slice(0, Math.min(count, arr.length));
}

async function ensureRow(
  guildId: string, userId: string, kind: "daily_task" | "quest", periodKey: string, build: () => BobObjective[],
): Promise<BobObjective[]> {
  const [row] = await db.select().from(bobProgressTable).where(and(
    eq(bobProgressTable.guildId, guildId), eq(bobProgressTable.userId, userId),
    eq(bobProgressTable.kind, kind), eq(bobProgressTable.periodKey, periodKey),
  )).limit(1);
  if (row) return row.items;
  const items = build();
  await db.insert(bobProgressTable).values({ guildId, userId, kind, periodKey, items }).onConflictDoNothing();
  const [after] = await db.select().from(bobProgressTable).where(and(
    eq(bobProgressTable.guildId, guildId), eq(bobProgressTable.userId, userId),
    eq(bobProgressTable.kind, kind), eq(bobProgressTable.periodKey, periodKey),
  )).limit(1);
  return after?.items ?? items;
}

export async function getDailyTasks(guildId: string, userId: string): Promise<{ periodKey: string; items: BobObjective[] }> {
  const periodKey = dailyKey();
  const items = await ensureRow(guildId, userId, "daily_task", periodKey, () => {
    const seed = hashSeed(`${userId}:${periodKey}`);
    return pickTemplates(DAILY_TEMPLATES, DAILY_COUNT, seed).map(t => ({ ...t, progress: 0, done: false }));
  });
  return { periodKey, items };
}

export async function getQuests(guildId: string, userId: string): Promise<BobObjective[]> {
  return ensureRow(guildId, userId, "quest", "global", () =>
    QUEST_TEMPLATES.map(t => ({ ...t, progress: 0, done: false })));
}

export interface CompletedObjective { objective: BobObjective; kind: "daily_task" | "quest" }

function matches(o: BobObjective, type: BobEventType): boolean {
  if (o.done) return false;
  // roulette_win events also satisfy generic game_win; jackpots satisfy game_win.
  if (o.type === type) return true;
  if (o.type === "game_win" && (type === "roulette_win" || type === "duel_win" || type === "jackpot")) return true;
  if (o.type === "game_play" && (type === "game_win" || type === "roulette_win" || type === "roulette_survive" || type === "duel_win")) return true;
  return false;
}

async function applyTo(
  guildId: string, userId: string, kind: "daily_task" | "quest", periodKey: string,
  items: BobObjective[], type: BobEventType, amount: number, settings: BobSettings,
): Promise<CompletedObjective[]> {
  let changed = false;
  const completed: CompletedObjective[] = [];
  for (const o of items) {
    if (!matches(o, type)) continue;
    o.progress = Math.min(o.goal, o.progress + amount);
    changed = true;
    if (o.progress >= o.goal && !o.done) { o.done = true; completed.push({ objective: o, kind }); }
  }
  if (!changed) return [];
  await db.update(bobProgressTable).set({ items, updatedAt: new Date() }).where(and(
    eq(bobProgressTable.guildId, guildId), eq(bobProgressTable.userId, userId),
    eq(bobProgressTable.kind, kind), eq(bobProgressTable.periodKey, periodKey),
  ));
  // Pay out completions.
  for (const c of completed) {
    await grantReward(guildId, userId, settings, {
      coins: c.objective.rewardCoins, xp: c.objective.rewardXp, title: c.objective.rewardTitle,
    }).catch(() => undefined);
    const col = kind === "quest" ? bobProfilesTable.questsCompleted : bobProfilesTable.tasksCompleted;
    await db.update(bobProfilesTable).set({ [kind === "quest" ? "questsCompleted" : "tasksCompleted"]: sql`${col} + 1` })
      .where(and(eq(bobProfilesTable.guildId, guildId), eq(bobProfilesTable.userId, userId))).catch(() => undefined);
  }
  return completed;
}

// Fire-and-forget. Returns completed objectives so a caller can surface them.
export async function recordBobEvent(
  guildId: string, userId: string, type: BobEventType, amount = 1,
): Promise<CompletedObjective[]> {
  if (amount <= 0) return [];
  try {
    const settings = await getBobSettings(guildId);
    const daily = await getDailyTasks(guildId, userId);
    const quests = await getQuests(guildId, userId);
    const [d, q] = await Promise.all([
      applyTo(guildId, userId, "daily_task", daily.periodKey, daily.items, type, amount, settings),
      applyTo(guildId, userId, "quest", "global", quests, type, amount, settings),
    ]);
    return [...d, ...q];
  } catch (err) {
    logger.warn({ err, guildId, userId, type }, "recordBobEvent failed (non-fatal)");
    return [];
  }
}

export function formatCompletions(completed: CompletedObjective[]): string | null {
  if (completed.length === 0) return null;
  const lines = completed.map(c => {
    const scope = c.kind === "quest" ? "Quest" : "Task";
    const title = c.objective.rewardTitle ? ` + title **${c.objective.rewardTitle}**` : "";
    return `✅ **${scope}:** ${c.objective.emoji} ${c.objective.label} — 🪙 ${c.objective.rewardCoins} · ⭐ ${c.objective.rewardXp} XP${title}`;
  });
  return "🎉 **Bob objective complete!**\n" + lines.join("\n");
}
