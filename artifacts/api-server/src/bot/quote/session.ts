// ─────────────────────────────────────────────────────────────────────────────
// In-memory quote builder sessions (TTL + cap), same pattern as /emoji.
// Supports single quotes and dual “fuse 2 msgs” sessions.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";
import type { QuoteTheme } from "./styles.js";
import { CUSTOM_STYLE_ID, customFrom, getStyle } from "./styles.js";
import { DUAL_QUOTE_STYLES } from "./dual-styles.js";

const TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 250;

export type QuoteView =
  | "pick"
  | "builder"
  | "custom"
  | "dual-pick-a"
  | "dual-pick-b"
  | "dual-builder";

export type QuoteMode = "single" | "dual";

export interface QuotePayload {
  text: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  messageId?: string;
  channelId?: string;
  authorId?: string;
  createdAt?: Date;
}

export interface QuoteSession {
  ownerId: string;
  guildId: string;
  mode: QuoteMode;
  payload: QuotePayload | null;
  /** Second line when mode === "dual". */
  payloadB: QuotePayload | null;
  styleId: string;
  dualStyleId: string;
  customTheme: QuoteTheme;
  view: QuoteView;
  lastPng?: Buffer;
  /** Extra Discord-chat screenshot when dual style isn't already duo-chat. */
  lastDiscordShot?: Buffer;
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
  mode?: QuoteMode;
}): { token: string; session: QuoteSession } {
  sweep();
  const token = randomBytes(6).toString("hex");
  const styleId = init.styleId ?? "classic";
  const session: QuoteSession = {
    ownerId: init.ownerId,
    guildId: init.guildId,
    mode: init.mode ?? "single",
    payload: init.payload ?? null,
    payloadB: null,
    styleId,
    dualStyleId: DUAL_QUOTE_STYLES[0]!.id,
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
