// ─────────────────────────────────────────────────────────────────────────────
// Temporary-message helpers — one place to keep channels tidy.
//
// A lot of bot replies are *transient*: leaderboards, search results, roster
// lookups, pack prompts. Leaving them in the channel forever is clutter. These
// helpers schedule best-effort auto-deletion after an appropriate lifetime, so
// every command can opt in with a single call instead of re-implementing timers.
//
// Rules of thumb:
//   • PREFER ephemeral replies for personal data (they never clutter).
//   • For PUBLIC transient messages, wrap the reply with an auto-delete TTL.
//   • NEVER auto-delete meaningful/permanent content (catches, trades, battle
//     results, giveaways) — just call these on throwaway lookups.
//
// Timers are in-process and best-effort: if the bot restarts before a timer
// fires the message simply stays (no correctness impact). dayjs powers the
// human-readable "expires in …" hints; nanoid tags each scheduled deletion for
// logging/traceability.
// ─────────────────────────────────────────────────────────────────────────────

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
import { nanoid } from "nanoid";
import type {
  Message, ChatInputCommandInteraction, ButtonInteraction,
  StringSelectMenuInteraction, MessageComponentInteraction,
} from "discord.js";
import { logger } from "./logger.js";

dayjs.extend(relativeTime);

// Sensible lifetimes for the common transient surfaces.
export const TTL = {
  SHORT: 45_000,     // quick lookups / error nudges
  RESULTS: 90_000,   // search results, small lists
  BOARD: 180_000,    // leaderboards, inventories
  PROMPT: 120_000,   // interactive prompts awaiting a choice
} as const;

export type TtlMs = number;

// Human "auto-deletes in ~2 minutes" hint for a footer, powered by dayjs.
export function autoDeleteHint(ttlMs: TtlMs): string {
  return `🧹 Auto-clears ${dayjs().add(ttlMs, "millisecond").fromNow()}`;
}

// Schedule a fetched Message for deletion after ttl. Best-effort, never throws.
export function scheduleMessageDelete(message: Message | null | undefined, ttlMs: TtlMs): void {
  if (!message) return;
  const id = nanoid(8);
  setTimeout(() => {
    message.delete().catch((err) => logger.debug({ err, id }, "temp-message: delete skipped"));
  }, ttlMs).unref?.();
}

// Schedule an interaction's REPLY for deletion after ttl. Works for public
// replies (deleteReply removes the visible message). No-op for ephemeral ones.
export function scheduleReplyDelete(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | MessageComponentInteraction,
  ttlMs: TtlMs,
): void {
  const id = nanoid(8);
  setTimeout(() => {
    interaction.deleteReply().catch((err) => logger.debug({ err, id }, "temp-message: deleteReply skipped"));
  }, ttlMs).unref?.();
}
