// ─────────────────────────────────────────────────────────────────────────────
// Battle Items — data-driven registry + effect resolver
//
// Battle Items replace the old Special-Card support slot (card abilities now live
// on the card itself). This registry is intentionally DATA-DRIVEN: items are
// plain BattleItem records, so a future admin tool (or a DB table) can create
// custom items without touching combat code. `applyItemEffect` reuses the same
// combatant mutations the combat engine already uses (hp/shield/energy/status).
// ─────────────────────────────────────────────────────────────────────────────

import type { Combatant, BattleEvent, StatusEffect, StatusKind } from "./types.js";

export type ItemEffectType =
  | "heal" | "shield" | "damage" | "energy" | "buff" | "debuff" | "status";

export type ItemTarget = "self" | "foe";

export interface BattleItem {
  id: string;
  name: string;
  emoji: string;
  description: string;
  icon?: string | null;       // optional image URL for canvas (falls back to emoji)
  rarity: string;             // display tier of the item itself
  category: string;           // "healing" | "offensive" | "defensive" | "utility"
  effectType: ItemEffectType;
  target: ItemTarget;
  power: number;              // heal/shield/damage = % of max HP; energy = flat; buff/debuff/status = magnitude
  duration: number;           // turns (buffs / debuffs / status)
  cooldown: number;           // turns between uses (0 = none)
  charges: number;            // uses per battle
  stackable: boolean;         // may re-apply while already active
  statusKind?: StatusKind;    // for effectType "status" / "buff" / "debuff"
  animation?: string;         // canvas/flash hint
  usableInBattle: boolean;
  enabled: boolean;
}

// ── Default registry (the 10 launch items) ───────────────────────────────────
// Powers are tuned to be useful but not build-breaking; all consume the user's
// turn (so they respect turn order) and honour charges + cooldown.
export const DEFAULT_BATTLE_ITEMS: BattleItem[] = [
  { id: "med_kit",         name: "Med Kit",           emoji: "🧰", description: "Restore 35% max HP.",                     rarity: "uncommon", category: "healing",   effectType: "heal",   target: "self", power: 35, duration: 0, cooldown: 2, charges: 2, stackable: false, animation: "heal",    usableInBattle: true, enabled: true },
  { id: "first_aid_kit",   name: "First Aid Kit",     emoji: "🩹", description: "Restore 18% max HP.",                     rarity: "common",   category: "healing",   effectType: "heal",   target: "self", power: 18, duration: 0, cooldown: 1, charges: 3, stackable: false, animation: "heal",    usableInBattle: true, enabled: true },
  { id: "energy_cell",     name: "Energy Cell",       emoji: "🔋", description: "Restore 45 energy.",                      rarity: "common",   category: "utility",   effectType: "energy", target: "self", power: 45, duration: 0, cooldown: 1, charges: 2, stackable: false, animation: "buff",    usableInBattle: true, enabled: true },
  { id: "shield_generator",name: "Shield Generator",  emoji: "🛡️", description: "Gain a shield worth 28% max HP.",          rarity: "uncommon", category: "defensive", effectType: "shield", target: "self", power: 28, duration: 0, cooldown: 2, charges: 2, stackable: true,  animation: "shield",  usableInBattle: true, enabled: true },
  { id: "smoke_grenade",   name: "Smoke Grenade",     emoji: "💨", description: "Cloak in smoke — become evasive for 2 turns.", rarity: "uncommon", category: "utility",   effectType: "status", target: "self", power: 0,  duration: 2, cooldown: 3, charges: 1, stackable: false, statusKind: "stealth", animation: "dodge", usableInBattle: true, enabled: true },
  { id: "frag_grenade",    name: "Frag Grenade",      emoji: "💣", description: "Deal 22% max HP damage.",                 rarity: "uncommon", category: "offensive", effectType: "damage", target: "foe",  power: 22, duration: 0, cooldown: 2, charges: 2, stackable: false, animation: "combo",   usableInBattle: true, enabled: true },
  { id: "emp_device",      name: "EMP Device",        emoji: "📡", description: "Drain the enemy's energy and weaken them.", rarity: "rare",     category: "offensive", effectType: "debuff", target: "foe",  power: 40, duration: 2, cooldown: 3, charges: 1, stackable: false, statusKind: "weaken", animation: "freeze", usableInBattle: true, enabled: true },
  { id: "armor_plating",   name: "Armor Plating",     emoji: "🧱", description: "Reinforce — take reduced damage for 3 turns.", rarity: "uncommon", category: "defensive", effectType: "buff",   target: "self", power: 25, duration: 3, cooldown: 3, charges: 1, stackable: false, statusKind: "buff",    animation: "shield", usableInBattle: true, enabled: true },
  { id: "targeting_computer", name: "Targeting Computer", emoji: "🎯", description: "Lock on — boost crit & accuracy for 3 turns.", rarity: "rare", category: "utility", effectType: "buff", target: "self", power: 20, duration: 3, cooldown: 3, charges: 1, stackable: false, statusKind: "buff", animation: "buff", usableInBattle: true, enabled: true },
  { id: "damage_boost",    name: "Damage Boost",      emoji: "🔺", description: "Overcharge — increase damage for 2 turns.", rarity: "rare",    category: "offensive", effectType: "buff",   target: "self", power: 30, duration: 2, cooldown: 3, charges: 1, stackable: false, statusKind: "buff",    animation: "combo",   usableInBattle: true, enabled: true },
];

const REGISTRY = new Map<string, BattleItem>(DEFAULT_BATTLE_ITEMS.map(i => [i.id, i]));

// ── Per-guild overlay (admin-authored custom items) ──────────────────────────
// The Battle Item Manager writes item definitions into the battle_content table.
// We merge those over the code defaults into a per-guild cache; combat + prep
// read that cache synchronously after `loadGuildBattleItems` has populated it
// (called once at prep + battle start, like the arena backgrounds).
const _guildItems = new Map<string, { map: Map<string, BattleItem>; expiresAt: number }>();
const GUILD_ITEMS_TTL_MS = 60_000;

// Coerce an admin-authored record (loose JSON) into a valid BattleItem, filling
// any missing field from the same-id default or a safe fallback.
export function coerceBattleItem(id: string, data: Record<string, unknown>, base?: BattleItem): BattleItem {
  const d = data as Partial<BattleItem>;
  const b = base ?? REGISTRY.get(id);
  const num = (v: unknown, f: number) => (typeof v === "number" && Number.isFinite(v) ? v : f);
  const str = (v: unknown, f: string) => (typeof v === "string" && v ? v : f);
  const bool = (v: unknown, f: boolean) => (typeof v === "boolean" ? v : f);
  return {
    id,
    name: str(d.name, b?.name ?? id),
    emoji: str(d.emoji, b?.emoji ?? "🎒"),
    description: str(d.description, b?.description ?? ""),
    icon: (d.icon as string | null | undefined) ?? b?.icon ?? null,
    rarity: str(d.rarity, b?.rarity ?? "common"),
    category: str(d.category, b?.category ?? "utility"),
    effectType: str(d.effectType, b?.effectType ?? "heal") as ItemEffectType,
    target: str(d.target, b?.target ?? "self") as ItemTarget,
    power: num(d.power, b?.power ?? 0),
    duration: num(d.duration, b?.duration ?? 0),
    cooldown: num(d.cooldown, b?.cooldown ?? 0),
    charges: num(d.charges, b?.charges ?? 1),
    stackable: bool(d.stackable, b?.stackable ?? false),
    statusKind: (d.statusKind as StatusKind | undefined) ?? b?.statusKind,
    animation: str(d.animation, b?.animation ?? ""),
    usableInBattle: bool(d.usableInBattle, b?.usableInBattle ?? true),
    enabled: bool(d.enabled, b?.enabled ?? true),
  };
}

// Populate the per-guild item cache from the DB overlay. Best-effort: on any
// failure the guild simply keeps the code defaults.
export async function loadGuildBattleItems(guildId: string): Promise<void> {
  const cached = _guildItems.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return;
  try {
    const { listBattleContent } = await import("./db.js");
    const rows = await listBattleContent(guildId, "item");
    const map = new Map<string, BattleItem>(REGISTRY);
    for (const row of rows) {
      map.set(row.contentId, coerceBattleItem(row.contentId, { ...row.data, enabled: row.enabled }, REGISTRY.get(row.contentId)));
    }
    _guildItems.set(guildId, { map, expiresAt: Date.now() + GUILD_ITEMS_TTL_MS });
  } catch {
    _guildItems.set(guildId, { map: new Map(REGISTRY), expiresAt: Date.now() + GUILD_ITEMS_TTL_MS });
  }
}

// Drop the cache for a guild after an admin edit so changes apply immediately.
export function invalidateGuildBattleItems(guildId: string): void {
  _guildItems.delete(guildId);
}

function registryFor(guildId?: string | null): Map<string, BattleItem> {
  if (guildId) {
    const c = _guildItems.get(guildId);
    if (c) return c.map;
  }
  return REGISTRY;
}

// The effective items for a guild (defaults + custom), usable in battle. Reads
// the cache; callers load it first via `loadGuildBattleItems`.
export function listBattleItems(guildId?: string | null): BattleItem[] {
  return [...registryFor(guildId).values()].filter(i => i.enabled && i.usableInBattle);
}
export function getBattleItem(id: string | null | undefined, guildId?: string | null): BattleItem | null {
  return id ? registryFor(guildId).get(id) ?? null : null;
}

// The full, admin-facing effective list for a guild (includes disabled items).
export function listAllBattleItems(guildId?: string | null): BattleItem[] {
  return [...registryFor(guildId).values()];
}

// The built-in defaults (used by the manager to show what can be overridden).
export function listDefaultBattleItems(): BattleItem[] {
  return [...REGISTRY.values()];
}

// Percent-of-max-HP helper.
function pct(base: number, percent: number): number {
  return Math.max(1, Math.round(base * percent / 100));
}

// Apply an item's effect to the combatants, mutating them the same way moves do.
// Returns log events (with a flash hint the canvas/embed can theme). `damage` is
// the raw HP removed from the foe (so the caller can drive KO handling + canvas).
export interface ItemOutcome { events: BattleEvent[]; damage: number; koed: boolean }

export function applyItemEffect(item: BattleItem, self: Combatant, foe: Combatant): ItemOutcome {
  const events: BattleEvent[] = [];
  let damage = 0;
  const flash = (item.animation as BattleEvent["flash"]) ?? undefined;
  const tag = `${item.emoji} ${self.cardName} used **${item.name}**`;

  switch (item.effectType) {
    case "heal": {
      const heal = pct(self.stats.maxHealth, item.power);
      const before = self.hp;
      self.hp = Math.min(self.stats.maxHealth, self.hp + heal);
      events.push({ text: `${tag} — restored **${self.hp - before}** HP.`, flash: "heal" });
      break;
    }
    case "shield": {
      const shield = pct(self.stats.maxHealth, item.power);
      self.shield += shield;
      events.push({ text: `${tag} — gained a **${shield}** HP shield.`, flash: "shield" });
      break;
    }
    case "energy": {
      const before = self.energy;
      self.energy = Math.min(self.stats.energyMax, self.energy + item.power);
      events.push({ text: `${tag} — recovered **${self.energy - before}** energy.`, flash });
      break;
    }
    case "damage": {
      const target = item.target === "self" ? self : foe;
      const dmg = pct(target.stats.maxHealth, item.power);
      const absorbed = Math.min(target.shield, dmg);
      target.shield -= absorbed;
      const through = dmg - absorbed;
      target.hp = Math.max(0, target.hp - through);
      damage = through;
      events.push({ text: `${tag} — dealt **${dmg}** damage${absorbed ? ` (${absorbed} absorbed)` : ""}.`, flash: flash ?? "combo" });
      if (target.hp <= 0) return { events, damage, koed: true };
      break;
    }
    case "debuff": {
      // Drain energy + apply a weakening status to the foe.
      if (item.power > 0) {
        const before = foe.energy;
        foe.energy = Math.max(0, foe.energy - item.power);
        if (before !== foe.energy) events.push({ text: `${tag} — drained **${before - foe.energy}** enemy energy.`, flash: flash ?? "freeze" });
      }
      if (item.statusKind) {
        foe.status.push(makeStatus(item.statusKind, item.duration, item.power, item.name));
        events.push({ text: `${tag} — ${foe.cardName} is **${labelFor(item.statusKind)}** for ${item.duration} turn(s).`, flash: flash ?? "freeze" });
      }
      break;
    }
    case "buff": {
      const kind = item.statusKind ?? "buff";
      self.status.push(makeStatus(kind, item.duration, item.power, item.name));
      events.push({ text: `${tag} — **${item.name}** active for ${item.duration} turn(s).`, flash: flash ?? "combo" });
      break;
    }
    case "status": {
      const target = item.target === "self" ? self : foe;
      const kind = item.statusKind ?? "buff";
      target.status.push(makeStatus(kind, item.duration, item.power, item.name));
      events.push({ text: `${tag} — ${target.cardName} gains **${labelFor(kind)}** for ${item.duration} turn(s).`, flash });
      break;
    }
  }
  return { events, damage, koed: false };
}

function makeStatus(kind: StatusKind, turns: number, magnitude: number, label: string): StatusEffect {
  return { kind, turns: Math.max(1, turns), magnitude, label, emoji: emojiFor(kind) };
}
function labelFor(kind: StatusKind): string {
  return ({ poison: "Poisoned", burn: "Burning", freeze: "Frozen", shield: "Shielded", reflect: "Reflecting", buff: "Empowered", regen: "Regenerating", weaken: "Weakened", stealth: "Evasive" } as Record<StatusKind, string>)[kind] ?? kind;
}
function emojiFor(kind: StatusKind): string {
  return ({ poison: "🟢", burn: "🔥", freeze: "❄️", shield: "🛡️", reflect: "🪞", buff: "⬆️", regen: "💚", weaken: "🔻", stealth: "🫥" } as Record<StatusKind, string>)[kind] ?? "✨";
}
