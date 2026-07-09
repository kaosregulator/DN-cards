// Giveaway message-requirement tracking.
//
// Counts REAL Discord activity toward "send N messages" requirements while
// resisting farming: bots are ignored, game/prefix commands don't count, very
// short messages don't count, and each member is rate-limited to one counted
// message per cooldown window. Purely best-effort — never consumes the message
// or blocks the catch / prefix pipeline.

import type { Message } from "discord.js";
import { recordGiveawayEvent } from "./engine.js";
import { getActiveGiveaways } from "./db.js";
import { logger } from "../../lib/logger.js";

// One counted message per member per window (anti-spam).
const COUNT_COOLDOWN_MS = 12_000;
const MIN_LENGTH = 3;
const lastCounted = new Map<string, number>(); // "guild:user" → epoch ms

// Cheap gate so we don't hit the DB for every message in guilds with no active
// message-requirement giveaway.
const HAS_MSG_REQ_TTL_MS = 60_000;
const hasMsgReqCache = new Map<string, { at: number; value: boolean }>();

async function guildHasMessageRequirement(guildId: string): Promise<boolean> {
  const hit = hasMsgReqCache.get(guildId);
  if (hit && Date.now() - hit.at < HAS_MSG_REQ_TTL_MS) return hit.value;
  let value = false;
  try {
    const active = await getActiveGiveaways(guildId);
    value = active.some(g => g.requirements.some(r => r.type === "message"));
  } catch { /* ignore */ }
  hasMsgReqCache.set(guildId, { at: Date.now(), value });
  return value;
}

export function invalidateMessageReqCache(guildId?: string): void {
  if (guildId) hasMsgReqCache.delete(guildId);
  else hasMsgReqCache.clear();
}

export async function handleGiveawayMessage(msg: Message, prefix: string): Promise<void> {
  try {
    if (msg.author.bot || !msg.guild) return;
    const content = msg.content.trim();
    if (content.length < MIN_LENGTH) return;
    // Ignore prefix commands and slash-style/bot invocations.
    if (prefix && content.startsWith(prefix)) return;
    if (content.startsWith("/") || content.startsWith("!") || content.startsWith("?")) return;

    if (!(await guildHasMessageRequirement(msg.guild.id))) return;

    const key = `${msg.guild.id}:${msg.author.id}`;
    const now = Date.now();
    const last = lastCounted.get(key) ?? 0;
    if (now - last < COUNT_COOLDOWN_MS) return;
    lastCounted.set(key, now);

    await recordGiveawayEvent(msg.guild.id, msg.author.id, "message", 1);
  } catch (err) {
    logger.debug({ err }, "giveaway message hook error (non-fatal)");
  }
}
