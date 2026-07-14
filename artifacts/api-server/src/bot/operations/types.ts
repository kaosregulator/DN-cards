// Operations Center — shared types and constants.
// Backend op keys NEVER change. Only display names are customisable.

import type { OpKey } from "@workspace/db";

export { type OpKey, type OpStatus } from "@workspace/db";

// ── Default display metadata ──────────────────────────────────────────────────

export interface OpDefault {
  key: OpKey;
  label: string;
  emoji: string;
  color: number;       // Discord embed colour (decimal)
  colorHex: string;    // Hex string for DB storage
  description: string;
}

export const OP_DEFAULTS: Record<OpKey, OpDefault> = {
  staff_request: {
    key: "staff_request",
    label: "Staff Request",
    emoji: "🛡️",
    color: 0x4CAF50,
    colorHex: "#4CAF50",
    description: "Request staff assistance for your server.",
  },
  combat_support: {
    key: "combat_support",
    label: "Combat Support",
    emoji: "⚔️",
    color: 0xFF5722,
    colorHex: "#FF5722",
    description: "Call for combat support — assemble your team.",
  },
  base_defense: {
    key: "base_defense",
    label: "Base Defense",
    emoji: "🏰",
    color: 0x2196F3,
    colorHex: "#2196F3",
    description: "Defend the base — responders needed immediately.",
  },
  convoy_escort: {
    key: "convoy_escort",
    label: "Convoy Escort",
    emoji: "🚛",
    color: 0xFF9800,
    colorHex: "#FF9800",
    description: "Escort the convoy safely to its destination.",
  },
  event_support: {
    key: "event_support",
    label: "Event Support",
    emoji: "🎯",
    color: 0x9C27B0,
    colorHex: "#9C27B0",
    description: "Support an active event — all hands on deck.",
  },
  custom: {
    key: "custom",
    label: "Custom",
    emoji: "📋",
    color: 0x607D8B,
    colorHex: "#607D8B",
    description: "Custom operation — details inside.",
  },
};

export const ALL_OP_KEYS: OpKey[] = [
  "staff_request",
  "combat_support",
  "base_defense",
  "convoy_escort",
  "event_support",
  "custom",
];

// ── CustomId prefix ───────────────────────────────────────────────────────────

export const OPS_PREFIX = "ops";

export function isOpsComponent(customId: string): boolean {
  return customId.startsWith(`${OPS_PREFIX}:`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a progress bar string. e.g.  ████████░░  8/10 (80%) */
export function buildProgressBar(current: number, total: number, len = 10): string {
  if (total <= 0) return "░".repeat(len);
  const pct = Math.min(1, current / total);
  const filled = Math.round(pct * len);
  return "█".repeat(filled) + "░".repeat(len - filled);
}

/** Format elapsed time from a Date. e.g. "1h 23m" or "45m 10s" */
export function formatElapsed(startedAt: Date | null): string {
  if (!startedAt) return "—";
  const ms = Date.now() - startedAt.getTime();
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Parse a hex colour string to a Discord embed colour number. */
export function hexToColor(hex: string | null | undefined, fallback: number): number {
  if (!hex) return fallback;
  const cleaned = hex.replace("#", "");
  const parsed = parseInt(cleaned, 16);
  return isNaN(parsed) ? fallback : parsed;
}
