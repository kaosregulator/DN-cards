// ─────────────────────────────────────────────────────────────────────────────
// In-memory quote builder sessions (TTL + cap), same pattern as /emoji.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";
import type { QuoteTheme } from "./styles.js";
import { CUSTOM_STYLE_ID, customFrom, getStyle } from "./styles.js";

const TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 250;

export type QuoteView = "pick" | "builder" | "custom";

export interface QuotePayload {
  text: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  /** Source message id when quoting an existing Discord message. */
  messageId?: string;
  channelId?: string;
  authorId?: string;
  /** Original message timestamp (Discord / 4K overlays). */
  createdAt?: Date;
}

export interface QuoteSession {
  ownerId: string;
  guildId: string;
  payload: QuotePayload | null;
  styleId: string;
  customTheme: QuoteTheme;
  view: QuoteView;
  /** Cached last PNG so Post/Save don't re-render. */
  lastPng?: Buffer;
  expiresAt: number;
}

const sessions = new Map<string, QuoteSession>();

function sweep(): void {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (s.expiresAt <= now) sessions.delete(token);
  }
  if (sessions.size <= MAX_SESSIONS) return;
  const ordered = [...sessions.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const drop = sessions.size - MAX_SESSIONS;
  for (let i = 0; i < drop; i++) sessions.delete(ordered[i]![0]);
}

export function createQuoteSession(init: {
  ownerId: string;
  guildId: string;
  payload?: QuotePayload | null;
  styleId?: string;
  view?: QuoteView;
}): { token: string; session: QuoteSession } {
  sweep();
  const token = randomBytes(6).toString("hex");
  const styleId = init.styleId ?? "classic";
  const session: QuoteSession = {
    ownerId: init.ownerId,
    guildId: init.guildId,
    payload: init.payload ?? null,
    styleId,
    customTheme: customFrom(styleId === CUSTOM_STYLE_ID ? "classic" : styleId),
    view: init.view ?? (init.payload ? "builder" : "pick"),
    expiresAt: Date.now() + TTL_MS,
  };
  sessions.set(token, session);
  return { token, session };
}

export function getQuoteSession(token: string): QuoteSession | null {
  sweep();
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  s.expiresAt = Date.now() + TTL_MS;
  return s;
}

export function touchQuoteSession(token: string): void {
  const s = sessions.get(token);
  if (s) s.expiresAt = Date.now() + TTL_MS;
}

export function deleteQuoteSession(token: string): void {
  sessions.delete(token);
}

export function activeTheme(session: QuoteSession): QuoteTheme {
  if (session.styleId === CUSTOM_STYLE_ID) return session.customTheme;
  return getStyle(session.styleId);
}
