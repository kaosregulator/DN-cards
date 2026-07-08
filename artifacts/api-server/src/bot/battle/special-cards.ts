// Special Card Engine — support-card effects.
//
// A player may bring a SECOND owned card as a "special support card". Its
// effect fires via the ✨ Use Special Card move, on a cooldown. Effects are a
// registry so new ones can be added without touching the combat engine.
//
// Admins enable a card as a special support card (and pick its effect) in the
// battle admin hub; if a card isn't explicitly configured, a sensible default
// effect is inferred from its type/rarity so the feature works out of the box.

import type { Combatant, BattleEvent, StatusEffect } from "./types.js";
import type { BattleSettings } from "@workspace/db";

export type SpecialEffectKey =
  | "heal" | "damage_boost" | "shield" | "poison" | "burn" | "freeze"
  | "reflect" | "double_attack" | "energy_boost" | "buff" | "nuke";

export interface SpecialEffectDef {
  key: SpecialEffectKey;
  label: string;
  emoji: string;
  description: string;
  // Mutates `self` and/or `foe`, returns log events. `settings` gives tunables.
  apply: (self: Combatant, foe: Combatant, settings: BattleSettings) => BattleEvent[];
}

function status(kind: StatusEffect["kind"], turns: number, magnitude: number, label: string, emoji: string): StatusEffect {
  return { kind, turns, magnitude, label, emoji };
}

export const SPECIAL_EFFECTS: Record<SpecialEffectKey, SpecialEffectDef> = {
  heal: {
    key: "heal", label: "Heal", emoji: "💚",
    description: "Restore a chunk of HP.",
    apply: (self) => {
      const amount = Math.round(self.stats.maxHealth * 0.3);
      self.hp = Math.min(self.stats.maxHealth, self.hp + amount);
      return [{ text: `💚 **${self.cardName}** channels its special and heals **${amount}** HP!`, flash: "heal" }];
    },
  },
  damage_boost: {
    key: "damage_boost", label: "Damage Boost", emoji: "🔺",
    description: "Sharply boosts your next attack.",
    apply: (self) => {
      self.nextAttackBoostPct += 75;
      return [{ text: `🔺 **${self.cardName}** powers up — next attack **+75%** damage!`, flash: "combo" }];
    },
  },
  shield: {
    key: "shield", label: "Shield", emoji: "🛡️",
    description: "Raise a protective shield.",
    apply: (self) => {
      const amount = Math.round(self.stats.maxHealth * 0.35);
      self.shield += amount;
      return [{ text: `🛡️ **${self.cardName}** raises a **${amount}** HP shield!`, flash: "shield" }];
    },
  },
  poison: {
    key: "poison", label: "Poison", emoji: "🧪",
    description: "Poison the enemy for damage over time.",
    apply: (self, foe) => {
      const dmg = Math.round(self.stats.attack * 0.35);
      foe.status.push(status("poison", 3, dmg, "Poison", "🧪"));
      return [{ text: `🧪 **${foe.cardName}** is poisoned — **${dmg}**/turn for 3 turns!`, flash: "poison" }];
    },
  },
  burn: {
    key: "burn", label: "Burn", emoji: "🔥",
    description: "Set the enemy ablaze.",
    apply: (self, foe) => {
      const dmg = Math.round(self.stats.attack * 0.45);
      foe.status.push(status("burn", 2, dmg, "Burn", "🔥"));
      return [{ text: `🔥 **${foe.cardName}** is burning — **${dmg}**/turn for 2 turns!`, flash: "burn" }];
    },
  },
  freeze: {
    key: "freeze", label: "Freeze", emoji: "❄️",
    description: "Freeze the enemy, skipping their next turn.",
    apply: (self, foe) => {
      foe.frozenTurns += 1;
      foe.status.push(status("freeze", 1, 0, "Frozen", "❄️"));
      return [{ text: `❄️ **${foe.cardName}** is frozen solid — they skip their next turn!`, flash: "freeze" }];
    },
  },
  reflect: {
    key: "reflect", label: "Reflect", emoji: "🪞",
    description: "Reflect part of the next hit back.",
    apply: (self) => {
      self.status.push(status("reflect", 2, 40, "Reflect", "🪞"));
      return [{ text: `🪞 **${self.cardName}** readies a reflective barrier (40% for 2 turns)!`, flash: "shield" }];
    },
  },
  double_attack: {
    key: "double_attack", label: "Double Attack", emoji: "⚡",
    description: "Your next attack strikes twice.",
    apply: (self) => {
      self.doubleNextAttack = true;
      return [{ text: `⚡ **${self.cardName}** prepares a **double strike**!`, flash: "combo" }];
    },
  },
  energy_boost: {
    key: "energy_boost", label: "Energy Boost", emoji: "🔋",
    description: "Instantly refill energy and add ultimate charge.",
    apply: (self, _foe, settings) => {
      self.energy = self.stats.energyMax;
      self.ultimate = Math.min(self.stats.ultimateMax, self.ultimate + Math.round(settings.ultimateChargePerTurn * 2));
      return [{ text: `🔋 **${self.cardName}** surges with energy — meters recharged!`, flash: "combo" }];
    },
  },
  buff: {
    key: "buff", label: "Temporary Buff", emoji: "📈",
    description: "Temporarily boost attack for several turns.",
    apply: (self) => {
      self.status.push(status("buff", 3, 25, "Empowered", "📈"));
      return [{ text: `📈 **${self.cardName}** is empowered — **+25%** attack for 3 turns!`, flash: "combo" }];
    },
  },
  nuke: {
    key: "nuke", label: "Nuke", emoji: "☢️",
    description: "Massive unavoidable burst of damage.",
    apply: (self, foe) => {
      const dmg = Math.round(self.stats.attack * 2.2);
      const absorbed = Math.min(foe.shield, dmg);
      foe.shield -= absorbed;
      foe.hp -= (dmg - absorbed);
      return [{ text: `☢️ **${self.cardName}** launches a **NUKE** for **${dmg}** damage!`, flash: "ultimate" }];
    },
  },
};

export function getEffectDef(key: string | null | undefined): SpecialEffectDef | null {
  if (!key) return null;
  return SPECIAL_EFFECTS[key as SpecialEffectKey] ?? null;
}

export const SPECIAL_EFFECT_KEYS = Object.keys(SPECIAL_EFFECTS) as SpecialEffectKey[];

// Infer a default effect for a card that hasn't been explicitly configured, so
// support cards work without admin setup. Deterministic by type/rarity.
export function inferSpecialEffect(cardType: string, rarity: string): SpecialEffectKey {
  const t = (cardType ?? "").toLowerCase();
  if (t === "tank" || t === "ship") return "shield";
  if (t === "aircraft") return "double_attack";
  if (t === "infantry") return "poison";
  if (t === "boss") return rarity === "mythic" || rarity === "legendary" ? "nuke" : "burn";
  if (t === "community" || t === "achievement") return "heal";
  return "damage_boost";
}
