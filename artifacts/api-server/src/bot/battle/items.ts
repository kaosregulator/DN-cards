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

// Future admin/DB items can be merged in here without touching combat code.
export function listBattleItems(): BattleItem[] {
  return [...REGISTRY.values()].filter(i => i.enabled && i.usableInBattle);
}
export function getBattleItem(id: string | null | undefined): BattleItem | null {
  return id ? REGISTRY.get(id) ?? null : null;
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
