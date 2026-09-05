// ─────────────────────────────────────────────────────────────────────────────
// /animate edit sessions.
//
// Re-rendering after the user tweaks intensity, swaps a piece or asks for more
// takes needs the target bytes again, and re-downloading every time would hammer
// the CDN. So the normalised bytes (and their content hash, for the render
// cache) are held in memory, keyed by an opaque token carried in the customIds.
//
// Bounded on age and count because it holds image buffers — an unbounded map
// keyed by user interaction is a memory leak with a friendly face.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";
import type { Candidate, Features, Intensity, Region } from "../types.js";

const TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 200;

export type AnimateView = "target" | "compose" | "gallery" | "finish" | "pieces";

type WarpRegion = Exclude<Region, "effect">;

export interface AnimateSession {
  /** Normalised PNG bytes of the target, or null before one is chosen. */
  image: Buffer | null;
  /** SHA-256 of `image`, computed once so every render reuses it. */
  imageHash: string | null;
  /** Detected target geometry, computed once per target and reused per render. */
  features: Features | null;
  ownerId: string;
  /** What the target is, for the header ("😀 :pepe:", "your avatar"). */
  sourceLabel: string | null;
  /** The last prompt the user typed ("yawning", "yelling"). */
  prompt: string;
  intensity: Intensity;
  /** slow/normal/fast → a duration factor the planner reads. */
  speed: "slow" | "normal" | "fast";
  /** Output edge length in px. */
  size: number;
  /** Manual piece-picker choices, region → track id (empty until used). */
  picks: Partial<Record<WarpRegion, string>>;
  /** Manual effect-overlay ids. */
  effectPicks: string[];
  /** The candidates currently shown, in display order. */
  candidates: Candidate[];
  /** Which candidate the user chose (index into `candidates`). */
  selected: number | null;
  view: AnimateView;
  expiresAt: number;
}

const sessions = new Map<string, AnimateSession>();

function sweep(): void {
  const now = Date.now();
  for (const [token, s] of sessions) if (s.expiresAt <= now) sessions.delete(token);
}

type Init = Omit<AnimateSession, "expiresAt" | "picks" | "effectPicks" | "candidates" | "selected" | "view">
  & Partial<Pick<AnimateSession, "picks" | "effectPicks" | "candidates" | "selected" | "view">>;

export function createSession(init: Init): { token: string; session: AnimateSession } {
  sweep();
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next();
    if (oldest.done) break;
    sessions.delete(oldest.value);
  }
  const token = randomBytes(9).toString("base64url");
  const session: AnimateSession = {
    picks: {},
    effectPicks: [],
    candidates: [],
    selected: null,
    view: "target",
    ...init,
    expiresAt: Date.now() + TTL_MS,
  };
  sessions.set(token, session);
  return { token, session };
}

export function getSession(token: string): AnimateSession | undefined {
  const s = sessions.get(token);
  if (!s) return undefined;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(token);
    return undefined;
  }
  return s;
}

export function touchSession(token: string, patch: Partial<AnimateSession>): AnimateSession | undefined {
  const s = getSession(token);
  if (!s) return undefined;
  Object.assign(s, patch);
  s.expiresAt = Date.now() + TTL_MS;
  return s;
}

export function endSession(token: string): void {
  sessions.delete(token);
}

export function sessionCount(): number {
  sweep();
  return sessions.size;
}
