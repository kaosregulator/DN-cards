// ─────────────────────────────────────────────────────────────────────────────
// Edit sessions.
//
// Re-rendering after a control change needs the source image again, and
// re-downloading it every time would be slow and would hammer the CDN. So the
// normalised bytes are held in memory, keyed by an opaque token carried in the
// component customIds.
//
// The store is deliberately bounded on BOTH axes — age and count — because it
// holds image buffers: an unbounded map keyed by user interaction is a memory
// leak with a friendly face. Eviction is oldest-first once the cap is hit.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";
import type { EmojiFormat } from "../types.js";

/** How long an untouched session stays editable. */
const TTL_MS = 10 * 60 * 1000;

/** Hard cap on live sessions, to bound worst-case memory. */
const MAX_SESSIONS = 200;

/** Which panel the interaction message is currently showing. */
/**
 * Which screen the interaction message is showing.
 *
 * `target` is the opening screen — pick what to animate before anything else.
 * The session exists before an image does, so `image` is null until then.
 */
export type EmojiView = "target" | "controls" | "styles" | "post";

/** Last successful generation — lets "Back" restore the panel without re-rendering. */
export interface EmojiLastResult {
  buffer: Buffer;
  format: EmojiFormat;
  bytes: number;
  providerId: string;
  cached: boolean;
}

export interface EmojiSession {
  /** Normalised PNG bytes of the source image, or null before a target is chosen. */
  image: Buffer | null;
  /** Discord user id allowed to drive these controls. */
  ownerId: string;
  /** Where the image came from, or null before a target is chosen. */
  sourceLabel: string | null;
  /** MakeEmoji settings. Values are whatever the manifest offers. */
  animation: string;
  speed?: string;
  direction?: string;
  size?: string;
  color?: string;
  quality?: string;
  platform?: string;
  format: EmojiFormat;
  /** Control panel vs visual style browser. */
  view: EmojiView;
  /** Style browser page (0-based). */
  stylePage: number;
  /** Style browser name search (empty = no filter). */
  styleQuery: string;
  /** Style browser list filter. */
  styleFilter: "all" | "favorites";
  /** Style value currently previewed in the browser (`gen_btn_…`). */
  styleFocus: string | null;
  /** Cached output of the last successful generate for this session. */
  lastResult?: EmojiLastResult;
  expiresAt: number;
}

const sessions = new Map<string, EmojiSession>();

/** Drop everything past its TTL. Cheap: called on each store touch. */
function sweep(): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

type SessionInit = Omit<
  EmojiSession,
  "expiresAt" | "view" | "stylePage" | "styleQuery" | "styleFilter" | "styleFocus" | "lastResult"
> & Partial<Pick<EmojiSession, "view" | "stylePage" | "styleQuery" | "styleFilter" | "styleFocus" | "lastResult">>;

/** Store a session, returning its token and the stored record. */
export function createSession(
  init: SessionInit,
): { token: string; session: EmojiSession } {
  sweep();

  // Map iteration is insertion-ordered, so the first key is the oldest.
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next();
    if (oldest.done) break;
    sessions.delete(oldest.value);
  }

  const token = randomBytes(9).toString("base64url");
  const session: EmojiSession = {
    view: "controls",
    stylePage: 0,
    styleQuery: "",
    styleFilter: "all",
    styleFocus: null,
    ...init,
    expiresAt: Date.now() + TTL_MS,
  };
  sessions.set(token, session);
  return { token, session };
}

/** Fetch a live session, or undefined when it is unknown or expired. */
export function getSession(token: string): EmojiSession | undefined {
  const session = sessions.get(token);
  if (!session) return undefined;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return undefined;
  }
  return session;
}

/** Apply changes and extend the session's life. */
export function touchSession(token: string, patch: Partial<EmojiSession>): EmojiSession | undefined {
  const session = getSession(token);
  if (!session) return undefined;
  Object.assign(session, patch);
  session.expiresAt = Date.now() + TTL_MS;
  return session;
}

/** Discard a session — used when the user is finished with it. */
export function endSession(token: string): void {
  sessions.delete(token);
}

/** Live session count. Exposed for tests and health checks. */
export function sessionCount(): number {
  sweep();
  return sessions.size;
}
