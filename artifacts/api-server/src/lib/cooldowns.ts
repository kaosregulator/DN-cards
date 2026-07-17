// ─────────────────────────────────────────────────────────────────────────────
// Shared action cooldowns (bottleneck).
//
// Reasonable rate limits so players can't spam back-to-back battles/raids —
// enough spacing that leveling still feels earned, without blocking normal play.
// One shared service; each action has a min gap between attempts plus an hourly
// cap, enforced per (guild, user) via a bottleneck limiter Group.
//
// In-memory (per bot process) and best-effort: a restart clears cooldowns, which
// is harmless (generous to players). Packs keep their OWN per-guild cooldown
// config in pack.ts — this covers battles and raids, which had none.
// ─────────────────────────────────────────────────────────────────────────────

import Bottleneck from "bottleneck";

export type CooldownAction = "battle" | "raid" | "pack";

interface Rule {
  gapMs: number;      // minimum spacing between attempts
  perHour?: number;   // rolling hourly cap (omit for no cap)
  label: string;      // used in user-facing messages
}

// Tuned to still allow steady progression, just not machine-gun spam.
const RULES: Record<CooldownAction, Rule> = {
  battle: { gapMs: 20_000, perHour: 40, label: "battle" },
  raid: { gapMs: 30_000, perHour: 20, label: "raid" },
  pack: { gapMs: 8_000, label: "pack open" },
};

const groups = new Map<CooldownAction, Bottleneck.Group>();
const lastRun = new Map<string, number>();

function groupFor(action: CooldownAction): Bottleneck.Group {
  let g = groups.get(action);
  if (!g) {
    const r = RULES[action];
    const opts: Bottleneck.ConstructorOptions = r.perHour
      ? {
          maxConcurrent: 1, minTime: r.gapMs,
          reservoir: r.perHour, reservoirRefreshAmount: r.perHour,
          reservoirRefreshInterval: 3_600_000, // 1h rolling cap
        }
      : { maxConcurrent: 1, minTime: r.gapMs };
    g = new Bottleneck.Group(opts);
    groups.set(action, g);
  }
  return g;
}

export interface CooldownResult {
  ok: boolean;
  reason?: "gap" | "cap";
  retryMs?: number;
  message?: string;
}

/**
 * Check whether `userId` may perform `action` now, and CONSUME a slot if so.
 * Returns { ok:true } when allowed; otherwise { ok:false } with a friendly
 * message (gap = too soon, cap = hourly limit reached). Fail-open on any
 * limiter error so a cooldown glitch never blocks play.
 */
export async function consumeCooldown(
  action: CooldownAction, guildId: string, userId: string,
): Promise<CooldownResult> {
  const rule = RULES[action];
  const key = `${guildId}:${userId}`;
  const limiter = groupFor(action).key(key);

  let can = true;
  try { can = await limiter.check(); } catch { can = true; }

  if (!can) {
    let reservoir: number | null = null;
    try { reservoir = await limiter.currentReservoir(); } catch { /* ignore */ }
    if (reservoir != null && reservoir <= 0) {
      return {
        ok: false, reason: "cap",
        message: `🚦 You've hit the **${rule.label} limit** for this hour — take a short breather and come back soon.`,
      };
    }
    const since = Date.now() - (lastRun.get(`${action}:${key}`) ?? 0);
    const retryMs = Math.max(1000, rule.gapMs - since);
    return {
      ok: false, reason: "gap", retryMs,
      message: `⏳ Slow down! You can start another **${rule.label}** in **${Math.ceil(retryMs / 1000)}s**.`,
    };
  }

  // Consume a slot (advances minTime spacing + decrements the hourly reservoir).
  // Awaited so the run is registered before we return — otherwise a rapid second
  // call could `check()` true before this job records, defeating the gap. Safe
  // to await: check() already confirmed it runs immediately (no blocking wait).
  lastRun.set(`${action}:${key}`, Date.now());
  try { await limiter.schedule(() => Promise.resolve()); } catch { /* ignore */ }
  return { ok: true };
}
