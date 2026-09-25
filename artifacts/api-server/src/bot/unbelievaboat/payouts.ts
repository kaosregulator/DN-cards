// Guild-configurable payouts for UnbelievaBoat income commands (webhook floor).
// Defaults match the previous hardcoded ranges in games.ts / casino daily.
// Admins edit via `/unbelievaboat` → Casino station.

import type { UbSettings } from "@workspace/db";
import { getOrCreateUbSettings } from "../../lib/unbelievaboat/db.js";

/** Factory defaults — keep these stable; admin station resets to them. */
export const DEFAULT_PAYOUTS = {
  // Cash Check-In (/daily_ub) — also mirrored on ub_settings.daily_min/max
  dailyMin: 100,
  dailyMax: 250,
  // Work
  workMin: 20,
  workMax: 250,
  // Crime
  crimeWinMin: 250,
  crimeWinMax: 700,
  crimeFailChancePct: 55,
  crimeFineMin: 10,
  /** Fine = max(fineMin, floor(wallet × random% in [pctMin, pctMax])). */
  crimeFineWalletPctMin: 1,
  crimeFineWalletPctMax: 2,
  // Beg
  begChancePct: 55,
  begMin: 15,
  begMax: 104,
  // Rob
  robSuccessChancePct: 40,
  robStealMin: 25,
  robStealCap: 500,
  /** Steal amount capped by this % of target cash (plus min/cap). */
  robStealCashPct: 10,
  robFailFineMin: 50,
  robFailFineMax: 199,
} as const;

export type PayoutConfig = {
  [K in keyof typeof DEFAULT_PAYOUTS]: number;
};

function n(v: unknown, d: number): number {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? Math.floor(x) : d;
}

function clampPct(v: number): number {
  return Math.min(100, Math.max(0, v));
}

export function readPayouts(settings: UbSettings): PayoutConfig {
  const raw = (settings as UbSettings & { payouts?: Partial<PayoutConfig> | null }).payouts;
  const src = raw && typeof raw === "object" ? raw : {};
  const d = DEFAULT_PAYOUTS;
  // dailyMin/Max columns remain canonical when set (older admin / schema).
  const dailyMin = n(
    src.dailyMin ?? (settings as { dailyMin?: number }).dailyMin,
    d.dailyMin,
  );
  const dailyMax = n(
    src.dailyMax ?? (settings as { dailyMax?: number }).dailyMax,
    d.dailyMax,
  );
  return {
    dailyMin,
    dailyMax: Math.max(dailyMin, dailyMax),
    workMin: n(src.workMin, d.workMin),
    workMax: Math.max(n(src.workMin, d.workMin), n(src.workMax, d.workMax)),
    crimeWinMin: n(src.crimeWinMin, d.crimeWinMin),
    crimeWinMax: Math.max(n(src.crimeWinMin, d.crimeWinMin), n(src.crimeWinMax, d.crimeWinMax)),
    crimeFailChancePct: clampPct(n(src.crimeFailChancePct, d.crimeFailChancePct)),
    crimeFineMin: n(src.crimeFineMin, d.crimeFineMin),
    crimeFineWalletPctMin: Math.max(0, n(src.crimeFineWalletPctMin, d.crimeFineWalletPctMin)),
    crimeFineWalletPctMax: Math.max(
      n(src.crimeFineWalletPctMin, d.crimeFineWalletPctMin),
      n(src.crimeFineWalletPctMax, d.crimeFineWalletPctMax),
    ),
    begChancePct: clampPct(n(src.begChancePct, d.begChancePct)),
    begMin: n(src.begMin, d.begMin),
    begMax: Math.max(n(src.begMin, d.begMin), n(src.begMax, d.begMax)),
    robSuccessChancePct: clampPct(n(src.robSuccessChancePct, d.robSuccessChancePct)),
    robStealMin: n(src.robStealMin, d.robStealMin),
    robStealCap: Math.max(n(src.robStealMin, d.robStealMin), n(src.robStealCap, d.robStealCap)),
    robStealCashPct: clampPct(n(src.robStealCashPct, d.robStealCashPct)),
    robFailFineMin: n(src.robFailFineMin, d.robFailFineMin),
    robFailFineMax: Math.max(n(src.robFailFineMin, d.robFailFineMin), n(src.robFailFineMax, d.robFailFineMax)),
  };
}

export async function getGuildPayouts(guildId: string): Promise<PayoutConfig> {
  const s = await getOrCreateUbSettings(guildId);
  return readPayouts(s);
}

/** Inclusive random integer in [lo, hi]. */
export function rollRange(lo: number, hi: number): number {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return a + Math.floor(Math.random() * (b - a + 1));
}

export function rollChance(pct: number): boolean {
  return Math.random() * 100 < clampPct(pct);
}

export function rollCrimeFine(walletTotal: number, p: PayoutConfig): number {
  const pct = rollRange(p.crimeFineWalletPctMin, p.crimeFineWalletPctMax);
  const fromWallet = Math.floor(walletTotal * (pct / 100));
  return Math.max(p.crimeFineMin, fromWallet);
}

export function rollRobSteal(targetCash: number, p: PayoutConfig): number {
  const fromPct = Math.max(p.robStealMin, Math.floor(targetCash * (p.robStealCashPct / 100)));
  const cap = Math.min(p.robStealCap, Math.max(p.robStealMin, fromPct));
  return rollRange(p.robStealMin, cap);
}
