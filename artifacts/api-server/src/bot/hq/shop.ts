// ─────────────────────────────────────────────────────────────────────────────
// HQ — rotating shop.
//
// The shop sells cosmetic furniture for shards and REFRESHES on a schedule. The
// rotation is computed deterministically from the current UTC date, so it needs
// NO storage and NO cron: everyone sees the same catalogue for the day, and it
// rolls over automatically at UTC midnight. Ownership lives in the existing
// hq_unlocks ledger (you can't buy what you already own), and purchases debit
// shards through the existing economy — no parallel currency.
//
// Eligibility is pure data: any decoration with a `price` can appear. Add a
// shop item = give a decoration a price in defs/decorations.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { HQ_DECORATIONS, type HqDecoration } from "./defs/decorations.js";

const SHOP_SIZE = 6;            // items shown per rotation
const DISCOUNT_CHANCE = 0.34;   // per-item chance of a discount this rotation
const DISCOUNT_PCT = 25;        // discount amount when it lands

export interface ShopEntry {
  deco: HqDecoration;
  basePrice: number;
  discountPct: number;  // 0 when not discounted
  price: number;        // effective price after discount
}

export interface ShopRotation {
  period: string;         // stable id for the current rotation (UTC date)
  entries: ShopEntry[];
  refreshesInMs: number;  // ms until the next rotation
}

const PURCHASABLE = HQ_DECORATIONS.filter(d => typeof d.price === "number" && d.price > 0);

// FNV-1a → 32-bit seed from the period string.
function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// mulberry32 — tiny deterministic PRNG so a period always yields the same shop.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function periodKey(now: Date): string {
  return `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}`;
}
function msUntilNextUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next - now.getTime());
}

// The deterministic catalogue for the current period. Pass `now` for testing.
export function shopRotation(now: Date = new Date()): ShopRotation {
  const period = periodKey(now);
  const rand = rng(seedFrom(period));

  // Deterministic Fisher–Yates over a copy, then take the first SHOP_SIZE.
  const pool = [...PURCHASABLE];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const chosen = pool.slice(0, Math.min(SHOP_SIZE, pool.length));

  const entries: ShopEntry[] = chosen.map(deco => {
    const basePrice = deco.price!;
    const discountPct = rand() < DISCOUNT_CHANCE ? DISCOUNT_PCT : 0;
    const price = Math.max(1, Math.floor(basePrice * (1 - discountPct / 100)));
    return { deco, basePrice, discountPct, price };
  });

  return { period, entries, refreshesInMs: msUntilNextUtcMidnight(now) };
}

// Look up one entry in the current rotation (used to validate a purchase against
// the live price — a client can't spoof a cheaper item).
export function shopEntryFor(decoId: string, now: Date = new Date()): ShopEntry | undefined {
  return shopRotation(now).entries.find(e => e.deco.id === decoId);
}

// "2h 14m" style hint for when the shop next refreshes.
export function formatRefreshIn(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
