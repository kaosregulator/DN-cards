// ─────────────────────────────────────────────────────────────────────────────
// Passives — data-driven passive abilities that trigger automatically in battle.
//
// A passive is an always-on ability a card carries (assigned per-card in the
// battle editor via battle_card_config.passive). Unlike a Special (an active
// move the player chooses), a passive fires on its own at a trigger point:
//   • battle_start — applied once when the combatant is built.
//   • turn_start   — applied at the start of each of the combatant's turns.
//
// Like Battle Items and Movesets, passives are a per-guild data-driven registry
// (battle_content kind "passive") merged over the code defaults, so admins can
// author custom passives without code. Effects reuse the existing status system.
// ─────────────────────────────────────────────────────────────────────────────

import type { Combatant, BattleEvent, StatusEffect } from "./types.js";

export type PassiveTrigger = "battle_start" | "turn_start";
// Effect kinds map onto the existing combat status/stat mechanics.
export type PassiveEffect = "regen" | "shield" | "buff" | "energy" | "reflect" | "stealth";

export interface Passive {
  id: string;
  name: string;
  emoji: string;
  description: string;
  trigger: PassiveTrigger;
  effect: PassiveEffect;
  magnitude: number;   // % of max HP (regen/shield), % attack (buff/reflect), or flat (energy)
  enabled: boolean;
}

// ── Default registry ──────────────────────────────────────────────────────────
export const DEFAULT_PASSIVES: Passive[] = [
  { id: "regenerator", name: "Regenerator",  emoji: "💚", description: "Recover a little HP at the start of every turn.", trigger: "turn_start",   effect: "regen",   magnitude: 5,  enabled: true },
  { id: "fortified",   name: "Fortified",     emoji: "🧱", description: "Begin the battle with a protective shield.",       trigger: "battle_start", effect: "shield",  magnitude: 20, enabled: true },
  { id: "berserker",   name: "Berserker",     emoji: "😤", description: "Start empowered — increased attack for the fight.", trigger: "battle_start", effect: "buff",    magnitude: 15, enabled: true },
  { id: "overclocked", name: "Overclocked",   emoji: "🔋", description: "Generate extra energy each turn.",                 trigger: "turn_start",   effect: "energy",  magnitude: 8,  enabled: true },
  { id: "spiked_armor", name: "Spiked Armor", emoji: "🪞", description: "Reflect part of incoming damage all battle.",       trigger: "battle_start", effect: "reflect", magnitude: 20, enabled: true },
  { id: "phantom",     name: "Phantom",       emoji: "🫥", description: "Slip into stealth as the battle begins.",           trigger: "battle_start", effect: "stealth", magnitude: 0,  enabled: true },
];

const REGISTRY = new Map<string, Passive>(DEFAULT_PASSIVES.map(p => [p.id, p]));

// ── Per-guild overlay (admin-authored / overridden passives) ─────────────────
const _guildPassives = new Map<string, { map: Map<string, Passive>; expiresAt: number }>();
const GUILD_PASSIVES_TTL_MS = 60_000;

export function coercePassive(id: string, data: Record<string, unknown>, base?: Passive): Passive {
  const d = data as Partial<Passive>;
  const b = base ?? REGISTRY.get(id);
  const num = (v: unknown, f: number) => (typeof v === "number" && Number.isFinite(v) ? v : f);
  const str = (v: unknown, f: string) => (typeof v === "string" && v ? v : f);
  const bool = (v: unknown, f: boolean) => (typeof v === "boolean" ? v : f);
  return {
    id,
    name: str(d.name, b?.name ?? id),
    emoji: str(d.emoji, b?.emoji ?? "✨"),
    description: str(d.description, b?.description ?? ""),
    trigger: str(d.trigger, b?.trigger ?? "battle_start") as PassiveTrigger,
    effect: str(d.effect, b?.effect ?? "buff") as PassiveEffect,
    magnitude: num(d.magnitude, b?.magnitude ?? 0),
    enabled: bool(d.enabled, b?.enabled ?? true),
  };
}

export async function loadGuildPassives(guildId: string): Promise<void> {
  const cached = _guildPassives.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return;
  try {
    const { listBattleContent } = await import("./db.js");
    const rows = await listBattleContent(guildId, "passive");
    const map = new Map<string, Passive>(REGISTRY);
    for (const row of rows) {
      map.set(row.contentId, coercePassive(row.contentId, { ...row.data, enabled: row.enabled }, REGISTRY.get(row.contentId)));
    }
    _guildPassives.set(guildId, { map, expiresAt: Date.now() + GUILD_PASSIVES_TTL_MS });
  } catch {
    _guildPassives.set(guildId, { map: new Map(REGISTRY), expiresAt: Date.now() + GUILD_PASSIVES_TTL_MS });
  }
}

export function invalidateGuildPassives(guildId: string): void {
  _guildPassives.delete(guildId);
}

function registryFor(guildId?: string | null): Map<string, Passive> {
  if (guildId) {
    const c = _guildPassives.get(guildId);
    if (c) return c.map;
  }
  return REGISTRY;
}

export function getPassive(id: string | null | undefined, guildId?: string | null): Passive | null {
  return id ? registryFor(guildId).get(id) ?? null : null;
}
export function listPassives(guildId?: string | null): Passive[] {
  return [...registryFor(guildId).values()].filter(p => p.enabled);
}
export function listAllPassives(guildId?: string | null): Passive[] {
  return [...registryFor(guildId).values()];
}
export function listDefaultPassives(): Passive[] {
  return [...REGISTRY.values()];
}

// ── Runtime application ───────────────────────────────────────────────────────
const pct = (base: number, percent: number) => Math.max(1, Math.round(base * percent / 100));
const LONG = 999; // "whole battle" duration for persistent passive statuses.

function ensureStatus(c: Combatant, st: StatusEffect) {
  // Don't stack the same persistent passive status twice.
  if (!c.status.some(s => s.kind === st.kind && s.label === st.label)) c.status.push(st);
}

// Apply a battle-start passive once (called when the combatant enters combat).
export function applyBattleStartPassive(c: Combatant): BattleEvent | null {
  const p = c.passive;
  if (!p || p.trigger !== "battle_start") return null;
  const tag = `${p.emoji} **${c.cardName}**`;
  switch (p.effect) {
    case "shield": {
      const s = pct(c.stats.maxHealth, p.magnitude);
      c.shield += s;
      return { text: `${tag} — **${p.name}**: begins with a **${s}** HP shield.`, flash: "shield" };
    }
    case "buff":
      ensureStatus(c, { kind: "buff", turns: LONG, magnitude: p.magnitude, label: p.name, emoji: p.emoji });
      return { text: `${tag} — **${p.name}**: enters the fight empowered (**+${p.magnitude}%** attack).`, flash: "combo" };
    case "regen":
      ensureStatus(c, { kind: "regen", turns: LONG, magnitude: pct(c.stats.maxHealth, p.magnitude), label: p.name, emoji: p.emoji });
      return { text: `${tag} — **${p.name}**: regenerating each turn.`, flash: "heal" };
    case "reflect":
      ensureStatus(c, { kind: "reflect", turns: LONG, magnitude: p.magnitude, label: p.name, emoji: p.emoji });
      return { text: `${tag} — **${p.name}**: reflecting **${p.magnitude}%** of incoming damage.`, flash: "counter" };
    case "stealth":
      ensureStatus(c, { kind: "stealth", turns: 2, magnitude: 0, label: p.name, emoji: p.emoji });
      return { text: `${tag} — **${p.name}**: slips into stealth.`, flash: "dodge" };
    case "energy":
      c.energy = Math.min(c.stats.energyMax, c.energy + p.magnitude);
      return { text: `${tag} — **${p.name}**: starts with a charge of energy.`, flash: "combo" };
  }
  return null;
}

// Apply a turn-start passive (called each of the combatant's turns).
export function applyTurnStartPassive(c: Combatant): BattleEvent | null {
  const p = c.passive;
  if (!p || p.trigger !== "turn_start") return null;
  const tag = `${p.emoji} **${c.cardName}**`;
  switch (p.effect) {
    case "regen": {
      const heal = pct(c.stats.maxHealth, p.magnitude);
      const before = c.hp;
      c.hp = Math.min(c.stats.maxHealth, c.hp + heal);
      if (c.hp === before) return null;
      return { text: `${tag} — **${p.name}**: recovers **${c.hp - before}** HP.`, flash: "heal" };
    }
    case "energy": {
      const before = c.energy;
      c.energy = Math.min(c.stats.energyMax, c.energy + p.magnitude);
      if (c.energy === before) return null;
      return { text: `${tag} — **${p.name}**: +**${c.energy - before}** energy.`, flash: "combo" };
    }
    case "shield": {
      const s = pct(c.stats.maxHealth, p.magnitude);
      c.shield += s;
      return { text: `${tag} — **${p.name}**: +**${s}** shield.`, flash: "shield" };
    }
    default:
      return null;
  }
}
