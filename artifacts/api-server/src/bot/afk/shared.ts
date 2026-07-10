import {
  type GuildMember, type Guild, type Client, PermissionFlagsBits, EmbedBuilder,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  getWhitelist, deleteAfk, getSubscribers, clearSubscribers,
  type AfkGuildSettingsRow, type AfkStateRow,
} from "./models.js";

// ─────────────────────────────────────────────────────────────────────────────
// AFK Secretary — shared constants, in-memory caches, access wall & the
// nickname "soft hierarchy shield". Everything here is stateless glue that the
// command, hook and interaction layers all lean on.
// ─────────────────────────────────────────────────────────────────────────────

// ── Brand / presentation ─────────────────────────────────────────────────────
// A single palette + copy deck so every embed reads as one corporate-grade
// product surface. Tweak here, not in twelve call sites.
export const AFK_BRAND = {
  COLOR_PRIMARY: 0x5865f2, // Blurple — active AFK / neutral dashboards
  COLOR_SUCCESS: 0x2ecc71, // Green   — welcome-back / confirmations
  COLOR_DANGER: 0xed4245,  // Red     — access denied / destructive
  COLOR_MUTED: 0x2b2d31,   // Slate   — secretary intercept card
  FOOTER: "AFK Secretary • Concierge Desk",
} as const;

export const AFK_EMOJI = {
  RETURN: "👋",
  STATUS: "🟢",
  TIMED: "⏰",
  NOTE: "📩",
  NOTIFY: "🔔",
  PROFILE: "👤",
  DISMISS: "❌",
  LOCK: "🔒",
  SPARKLE: "✨",
} as const;

// ── Timing knobs (the "True AFK" standard) ───────────────────────────────────
/** Grace window after `/afk set`. Messages inside it never clear the AFK. */
export const GRACE_PERIOD_MS = 45_000;
/** Cross-fire guard: at most one Secretary embed per channel per this window. */
export const INTERCEPT_COOLDOWN_MS = 10_000;
/** Dismiss ownership lock: only the first pinger may dismiss for this long. */
export const DISMISS_LOCK_MS = 5_000;
/** How long an unconfirmed /afk set draft lives in memory before it's dropped. */
export const DRAFT_TTL_MS = 5 * 60_000;

/**
 * Whether the "On Status Change" trigger is usable. It depends on the
 * privileged GuildPresences intent, which index.ts only requests when
 * AFK_PRESENCE_INTENT=1. When off we hide the option so nobody sets an AFK that
 * can never auto-clear.
 */
export function isPresenceTriggerEnabled(): boolean {
  return process.env["AFK_PRESENCE_INTENT"] === "1";
}

// Timed auto-remove presets surfaced in the second select menu.
export const AFK_DURATIONS: { label: string; value: string; ms: number }[] = [
  { label: "5 minutes", value: "5m", ms: 5 * 60_000 },
  { label: "15 minutes", value: "15m", ms: 15 * 60_000 },
  { label: "30 minutes", value: "30m", ms: 30 * 60_000 },
  { label: "1 hour", value: "1h", ms: 60 * 60_000 },
  { label: "4 hours", value: "4h", ms: 4 * 60 * 60_000 },
];

export const MAX_CUSTOM_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Format a millisecond duration as a human-readable string (e.g. "2h 30m"). */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0) parts.push(`${secs}s`);
  return parts.join(" ") || "0m";
}

/**
 * Parse a human duration string into milliseconds. Accepts:
 *   "90m", "2h30m", "1h", "5m30s", "1d", or a bare number (treated as minutes).
 * Returns null if the string cannot be parsed.
 */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const minutes = parseInt(trimmed, 10);
    return minutes > 0 ? minutes * 60 * 1000 : null;
  }
  const regex = /(\d+)([dhms])/g;
  let totalMs = 0;
  let match: RegExpExecArray | null;
  let foundAny = false;
  while ((match = regex.exec(trimmed)) !== null) {
    foundAny = true;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    if (value <= 0) continue;
    if (unit === "d") totalMs += value * 24 * 60 * 60 * 1000;
    else if (unit === "h") totalMs += value * 60 * 60 * 1000;
    else if (unit === "m") totalMs += value * 60 * 1000;
    else if (unit === "s") totalMs += value * 1000;
  }
  return foundAny && totalMs > 0 ? totalMs : null;
}

// ── In-memory caches ─────────────────────────────────────────────────────────
// Deliberately process-local. On a single-instance deployment (this bot only
// ever runs one gateway connection — see the multi-instance guard in index.ts)
// that is exactly the right scope: these are ephemeral UX guards, not data.

/** channelId → last time a Secretary embed was posted there. */
const interceptCache = new Map<string, number>();

/** messageId → { ownerId, lockedUntil } for the Dismiss ownership rule. */
const dismissOwners = new Map<string, { ownerId: string; lockedUntil: number }>();

/** userId → pending /afk set draft awaiting a method/duration selection. */
export interface AfkDraft {
  guildId: string;
  reason: string;
  method?: "RETURN" | "STATUS" | "AUTO";
  durationMs?: number;
  expiresAt: number;
}
const drafts = new Map<string, AfkDraft>();

/**
 * Cross-fire intercept guard. Returns true (and arms the cooldown) only if this
 * channel has not shown a Secretary embed within INTERCEPT_COOLDOWN_MS.
 */
export function canPostIntercept(channelId: string): boolean {
  const now = Date.now();
  const last = interceptCache.get(channelId) ?? 0;
  if (now - last < INTERCEPT_COOLDOWN_MS) return false;
  interceptCache.set(channelId, now);
  return true;
}

/** Record the first pinger as the owner of a Secretary embed's Dismiss button. */
export function registerDismissOwner(messageId: string, ownerId: string): void {
  dismissOwners.set(messageId, { ownerId, lockedUntil: Date.now() + DISMISS_LOCK_MS });
}

/**
 * Decide whether `clickerId` may dismiss the embed `messageId`.
 *  - The registered owner (first pinger) always may.
 *  - Anyone else is blocked until the 5-second lock elapses, after which the
 *    embed becomes communal and any member may clear it.
 */
export function canDismiss(messageId: string, clickerId: string): boolean {
  const rec = dismissOwners.get(messageId);
  if (!rec) return true; // Unknown embed (e.g. after a restart) → don't trap it.
  if (rec.ownerId === clickerId) return true;
  return Date.now() >= rec.lockedUntil;
}

export function forgetDismissOwner(messageId: string): void {
  dismissOwners.delete(messageId);
}

// ── Draft store (for the multi-step /afk set dashboard) ──────────────────────
export function putDraft(userId: string, draft: Omit<AfkDraft, "expiresAt">): void {
  drafts.set(userId, { ...draft, expiresAt: Date.now() + DRAFT_TTL_MS });
}

export function getDraft(userId: string): AfkDraft | null {
  const d = drafts.get(userId);
  if (!d) return null;
  if (Date.now() > d.expiresAt) { drafts.delete(userId); return null; }
  return d;
}

export function patchDraft(userId: string, patch: Partial<AfkDraft>): AfkDraft | null {
  const d = getDraft(userId);
  if (!d) return null;
  const next = { ...d, ...patch, expiresAt: Date.now() + DRAFT_TTL_MS };
  drafts.set(userId, next);
  return next;
}

export function clearDraft(userId: string): void {
  drafts.delete(userId);
}

// ── Access wall (whitelist + staff/bypass) ─────────────────────────────
/**
 * The permission gate for /afk. Bypass is granted to:
 *   1. The server owner.
 *   2. Anyone with Administrator or Manage Server (ManageGuild).
 *   3. Members whitelisted directly (type USER).
 *   4. Members holding any whitelisted role (type ROLE) — these double as the
 *      "predefined Staff roles".
 * Everyone else is denied and shown the polished request-access notice.
 */
export async function hasAfkAccess(member: GuildMember): Promise<boolean> {
  if (member.guild.ownerId === member.id) return true;
  if (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  ) {
    return true;
  }

  const whitelist = await getWhitelist(member.guild.id);
  for (const entry of whitelist) {
    if (entry.type === "USER" && entry.targetId === member.id) return true;
    if (entry.type === "ROLE" && member.roles.cache.has(entry.targetId)) return true;
  }
  return false;
}

// ── Soft hierarchy shield (nickname mutations) ───────────────────────────────
/**
 * Can the bot actually edit this member's nickname? False for the server owner
 * and for anyone whose top role sits at or above the bot's — Discord would throw
 * otherwise. Callers use this to skip silently rather than crash.
 */
export function botCanEditNickname(member: GuildMember): boolean {
  const guild = member.guild;
  if (member.id === guild.ownerId) return false;
  const me = guild.members.me;
  if (!me) return false;
  if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) return false;
  // comparePositionTo > 0 means the bot's highest role outranks the target's.
  return me.roles.highest.comparePositionTo(member.roles.highest) > 0;
}

/**
 * Prefix "[AFK] " onto the member's nickname, honouring the hierarchy shield and
 * the guild's nicknameChanges toggle. Returns the ORIGINAL nickname (or null) so
 * the caller can persist it for exact restoration. Never throws.
 */
export async function applyAfkNickname(
  member: GuildMember,
  settings: AfkGuildSettingsRow,
): Promise<{ ok: boolean; originalNickname: string | null }> {
  const original = member.nickname; // null when they use their plain username.
  if (!settings.nicknameChanges) return { ok: false, originalNickname: original };
  if (!botCanEditNickname(member)) return { ok: false, originalNickname: original };

  const base = member.nickname ?? member.user.username;
  if (base.startsWith("[AFK]")) return { ok: true, originalNickname: original };

  // Discord caps nicknames at 32 chars — trim the base to keep the tag intact.
  const tagged = `[AFK] ${base}`.slice(0, 32);
  try {
    await member.setNickname(tagged, "AFK Secretary — member marked away");
    return { ok: true, originalNickname: original };
  } catch (err) {
    logger.debug({ err, userId: member.id }, "AFK nickname apply skipped");
    return { ok: false, originalNickname: original };
  }
}

/**
 * Restore the member's pre-AFK nickname. `original === null` clears the nickname
 * entirely (back to the plain username). Honours the hierarchy shield; never
 * throws.
 */
export async function restoreNickname(
  member: GuildMember,
  original: string | null,
): Promise<void> {
  if (!botCanEditNickname(member)) return;
  // If their current nickname isn't ours, don't stomp a change they made.
  if (member.nickname && !member.nickname.startsWith("[AFK]")) return;
  try {
    await member.setNickname(original, "AFK Secretary — member returned");
  } catch (err) {
    logger.debug({ err, userId: member.id }, "AFK nickname restore skipped");
  }
}

// ── Bot client handle (for the sweeper + return DMs) ─────────────────────────
// The AFK layer occasionally needs the client outside an interaction (timed
// sweeper, DM fan-out). We reuse the existing client-holder singleton.
export async function safeFetchMember(
  client: Client,
  guildId: string,
  userId: string,
): Promise<GuildMember | null> {
  try {
    const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId));
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

export function resolveGuild(client: Client, guildId: string): Guild | null {
  return client.guilds.cache.get(guildId) ?? null;
}

// ── AFK lifecycle: clear + notify ────────────────────────────────────────────
export type AfkClearTrigger = "RETURN" | "STATUS" | "AUTO" | "MANUAL";

/**
 * The single canonical "welcome back" path. Every clear route — a returning
 * message, a presence flip, the timed sweeper, or a manual toggle — funnels
 * through here so nickname restoration and the Notify-Me DM fan-out always fire
 * exactly once.
 *
 * Returns the cleared row (null if the member wasn't actually AFK) so callers
 * can decide whether to post their own confirmation.
 */
export async function clearAfkForUser(
  client: Client,
  guildId: string,
  userId: string,
  trigger: AfkClearTrigger,
): Promise<AfkStateRow | null> {
  const row = await deleteAfk(guildId, userId);
  if (!row) return null;

  // 1) Restore nickname (hierarchy-shielded, never throws).
  const member = await safeFetchMember(client, guildId, userId);
  if (member) await restoreNickname(member, row.originalNickname);

  // 2) Fan out "they're back" DMs to Notify-Me subscribers, then clear the list.
  const subscribers = await getSubscribers(guildId, userId).catch(() => []);
  if (subscribers.length > 0) {
    const guild = resolveGuild(client, guildId);
    const displayName = member?.displayName ?? member?.user.username ?? `<@${userId}>`;
    const dm = new EmbedBuilder()
      .setColor(AFK_BRAND.COLOR_SUCCESS)
      .setTitle(`${AFK_EMOJI.RETURN} They're back`)
      .setDescription(
        `**${displayName}** has returned${guild ? ` in **${guild.name}**` : ""} and is no longer AFK.\n` +
        `You asked to be notified — consider this your tap on the shoulder.`,
      )
      .setFooter({ text: AFK_BRAND.FOOTER })
      .setTimestamp();

    await Promise.allSettled(subscribers.map(async (sub) => {
      try {
        const user = await client.users.fetch(sub.subscriberId);
        await user.send({ embeds: [dm] });
      } catch (err) {
        logger.debug({ err, subscriberId: sub.subscriberId }, "AFK return DM skipped");
      }
    }));
    await clearSubscribers(guildId, userId).catch(() => { /* best effort */ });
  }

  logger.info({ guildId, userId, trigger }, "AFK state cleared");
  return row;
}
