// Combat Engine — turn-based resolution.
//
// Pure(ish) logic: given two Combatants, the guild's settings, and a chosen
// move, it mutates combatant state and returns the log events that happened.
// The battle-manager owns turn order, timers, and rendering; this module owns
// the maths and the random events (crit / miss / dodge / counter / perfect
// block / shield break / combo / last stand). All rates come from settings so
// every formula is admin-configurable.

import type { BattleSettings } from "@workspace/db";
import type { Combatant, BattleEvent, MoveType, TurnResult } from "./types.js";
import { getEffectDef } from "./special-cards.js";

const chance = (pct: number) => Math.random() * 100 < pct;
const vary = (n: number, spread: number) => n * (1 + (Math.random() - 0.5) * 2 * spread);

// Apply start-of-turn effects for the combatant about to act: DoT ticks,
// regen, status decay, energy regain. Returns log events + whether they were
// knocked out by DoT and whether their turn is skipped (frozen).
export function startOfTurn(
  actor: Combatant, settings: BattleSettings,
): { events: BattleEvent[]; koed: boolean; skipped: boolean } {
  const events: BattleEvent[] = [];
  actor.defending = false;

  for (const st of actor.status) {
    if (st.kind === "poison" || st.kind === "burn") {
      const dmg = Math.max(1, Math.round(st.magnitude));
      actor.hp -= dmg;
      events.push({
        text: `${st.emoji} **${actor.cardName}** takes **${dmg}** ${st.label.toLowerCase()} damage.`,
        flash: st.kind,
      });
    } else if (st.kind === "regen") {
      const heal = Math.max(1, Math.round(st.magnitude));
      actor.hp = Math.min(actor.stats.maxHealth, actor.hp + heal);
      events.push({ text: `${st.emoji} **${actor.cardName}** regenerates **${heal}** HP.`, flash: "heal" });
    }
  }
  // Decay statuses (freeze is consumed via frozenTurns below).
  actor.status = actor.status
    .map(s => ({ ...s, turns: s.turns - 1 }))
    .filter(s => s.turns > 0);

  // Energy regen each of the combatant's turns.
  actor.energy = Math.min(actor.stats.energyMax, actor.energy + settings.energyGainPerTurn);
  actor.ultimate = Math.min(actor.stats.ultimateMax, actor.ultimate + settings.ultimateChargePerTurn);
  if (actor.specialCooldownRemaining > 0) actor.specialCooldownRemaining--;

  if (actor.hp <= 0) return { events, koed: true, skipped: false };

  if (actor.frozenTurns > 0) {
    actor.frozenTurns--;
    events.push({ text: `❄️ **${actor.cardName}** is frozen and cannot move!`, flash: "freeze" });
    return { events, koed: false, skipped: true };
  }
  return { events, koed: false, skipped: false };
}

function buffMultiplier(c: Combatant): number {
  let m = 1;
  for (const s of c.status) if (s.kind === "buff") m += s.magnitude / 100;
  for (const s of c.status) if (s.kind === "weaken") m -= s.magnitude / 100;
  return Math.max(0.3, m);
}

// Core attack resolution shared by Attack / Special / Ultimate.
function strike(
  attacker: Combatant, defender: Combatant, settings: BattleSettings,
  opts: { powerPct: number; guaranteedHit?: boolean; label: string; ultimate?: boolean },
): { events: BattleEvent[]; koed: boolean } {
  const events: BattleEvent[] = [];

  // Miss / dodge (skipped for guaranteed-hit ultimates).
  if (!opts.guaranteedHit) {
    const missPct = Math.max(0, settings.missChancePct - attacker.stats.accuracy + 90);
    if (chance(missPct)) {
      events.push({ text: `💨 **${attacker.cardName}**'s ${opts.label} misses!`, flash: "miss" });
      return { events, koed: false };
    }
    const dodgePct = Math.min(70, defender.stats.dodge + defender.stats.luck / 4);
    if (chance(dodgePct)) {
      events.push({ text: `🌀 **${defender.cardName}** dodges the ${opts.label}!`, flash: "dodge" });
      maybeCounter(defender, attacker, settings, events);
      return { events, koed: defender.hp > 0 && attacker.hp <= 0 };
    }
  }

  // Perfect block when defending.
  if (defender.defending && chance(25)) {
    events.push({ text: `🧱 **${defender.cardName}** perfectly blocks the ${opts.label}!`, flash: "shield" });
    maybeCounter(defender, attacker, settings, events);
    return { events, koed: false };
  }

  // Base damage with diminishing returns vs defense.
  const boost = 1 + attacker.nextAttackBoostPct / 100;
  const rawAtk = attacker.stats.attack * (opts.powerPct / 100) * boost * buffMultiplier(attacker);
  const effDef = defender.stats.defense * (defender.defending ? 2 : 1);
  let dmg = rawAtk * (rawAtk / (rawAtk + effDef * 0.9));

  // Critical hit.
  const critPct = Math.min(80, attacker.stats.critChance + attacker.stats.luck / 3);
  let crit = false;
  if (!opts.ultimate && chance(critPct)) {
    crit = true;
    dmg *= settings.critMultiplierPct / 100;
  }
  dmg = Math.max(1, Math.round(vary(dmg, 0.12)));

  // Reflect: part of the damage bounces back before mitigation of shield.
  const reflect = defender.status.find(s => s.kind === "reflect");
  if (reflect) {
    const back = Math.max(1, Math.round(dmg * reflect.magnitude / 100));
    attacker.hp -= back;
    events.push({ text: `🪞 **${defender.cardName}** reflects **${back}** damage back!`, flash: "counter" });
  }

  // Shield soak → HP.
  let text = "";
  if (defender.shield > 0) {
    const absorbed = Math.min(defender.shield, dmg);
    defender.shield -= absorbed;
    const overflow = dmg - absorbed;
    defender.hp -= overflow;
    if (defender.shield <= 0 && overflow >= 0) {
      text = `🛡️💥 **${attacker.cardName}**'s ${opts.label} shatters the shield and deals **${overflow}**!`;
      events.push({ text, flash: "shield_break" });
    } else {
      text = `🛡️ Shield absorbs **${absorbed}** of **${attacker.cardName}**'s ${opts.label}.`;
      events.push({ text, flash: "shield" });
    }
  } else {
    defender.hp -= dmg;
    const icon = crit ? "💥" : opts.ultimate ? "☄️" : "⚔️";
    text = `${icon} **${attacker.cardName}**'s ${opts.label} hits for **${dmg}**${crit ? " — CRITICAL!" : ""}`;
    events.push({ text, flash: crit ? "crit" : opts.ultimate ? "ultimate" : undefined });
  }

  attacker.nextAttackBoostPct = 0;

  // Last stand — survive a lethal blow once.
  if (defender.hp <= 0 && !defender.lastStandUsed && chance(Math.min(35, 8 + defender.stats.luck))) {
    defender.hp = 1;
    defender.lastStandUsed = true;
    events.push({ text: `🔆 **${defender.cardName}** refuses to fall — **LAST STAND** at 1 HP!`, flash: "laststand" });
    return { events, koed: false };
  }

  if (defender.hp > 0) maybeCounter(defender, attacker, settings, events);
  return { events, koed: defender.hp <= 0 };
}

function maybeCounter(defender: Combatant, attacker: Combatant, settings: BattleSettings, events: BattleEvent[]) {
  if (defender.hp <= 0 || attacker.hp <= 0) return;
  if (!chance(settings.counterChancePct + defender.stats.luck / 5)) return;
  const dmg = Math.max(1, Math.round(defender.stats.attack * 0.5 * buffMultiplier(defender)));
  const absorbed = Math.min(attacker.shield, dmg);
  attacker.shield -= absorbed;
  attacker.hp -= (dmg - absorbed);
  events.push({ text: `↩️ **${defender.cardName}** counters for **${dmg}**!`, flash: "counter" });
}

export function resolveMove(
  settings: BattleSettings, actor: Combatant, foe: Combatant, move: MoveType,
): TurnResult {
  const events: BattleEvent[] = [];
  let koed = false;

  switch (move) {
    case "attack": {
      const r = strike(actor, foe, settings, { powerPct: 100, label: "attack" });
      events.push(...r.events); koed = r.koed;
      if (!koed && actor.doubleNextAttack) {
        actor.doubleNextAttack = false;
        events.push({ text: `⚡ Double strike!`, flash: "combo" });
        const r2 = strike(actor, foe, settings, { powerPct: 65, label: "follow-up" });
        events.push(...r2.events); koed = r2.koed;
      } else if (!koed && chance(10 + actor.stats.luck / 4)) {
        events.push({ text: `🔗 **${actor.cardName}** chains a **combo**!`, flash: "combo" });
        const r2 = strike(actor, foe, settings, { powerPct: 45, label: "combo hit" });
        events.push(...r2.events); koed = r2.koed;
      }
      break;
    }
    case "special": {
      if (actor.energy < settings.specialCost) {
        events.push({ text: `⚠️ **${actor.cardName}** lacks energy for a Special Attack and staggers.` });
        break;
      }
      actor.energy -= settings.specialCost;
      const r = strike(actor, foe, settings, { powerPct: 160, label: "Special Attack" });
      events.push(...r.events); koed = r.koed;
      break;
    }
    case "ultimate": {
      if (actor.ultimate < actor.stats.ultimateMax) {
        events.push({ text: `⚠️ **${actor.cardName}**'s ultimate isn't charged yet.` });
        break;
      }
      actor.ultimate = 0;
      events.push({ text: `💀 **${actor.cardName}** unleashes its **ULTIMATE**!`, flash: "ultimate" });
      const r = strike(actor, foe, settings, { powerPct: settings.ultimateDamagePct, label: "ultimate", guaranteedHit: true, ultimate: true });
      events.push(...r.events); koed = r.koed;
      break;
    }
    case "defend": {
      actor.defending = true;
      const shield = Math.round(actor.stats.maxHealth * settings.shieldStrengthPct / 100);
      actor.shield += shield;
      events.push({ text: `🛡️ **${actor.cardName}** braces and gains a **${shield}** HP shield.`, flash: "shield" });
      break;
    }
    case "charge": {
      actor.energy = Math.min(actor.stats.energyMax, actor.energy + settings.chargeEnergyGain);
      actor.ultimate = Math.min(actor.stats.ultimateMax, actor.ultimate + settings.ultimateChargePerTurn);
      actor.nextAttackBoostPct += 30;
      events.push({ text: `⚡ **${actor.cardName}** charges — energy up, next attack empowered.`, flash: "combo" });
      break;
    }
    case "special_card": {
      const def = getEffectDef(actor.specialEffect);
      if (!def || !actor.specialCardId) {
        events.push({ text: `⚠️ **${actor.cardName}** has no special support card equipped.` });
        break;
      }
      if (actor.specialCooldownRemaining > 0) {
        events.push({ text: `⏳ Special card on cooldown (${actor.specialCooldownRemaining} more turn(s)).` });
        break;
      }
      actor.specialCooldownRemaining = actor.specialCooldownMax;
      events.push(...def.apply(actor, foe, settings));
      koed = foe.hp <= 0;
      break;
    }
    case "skip": {
      actor.energy = Math.min(actor.stats.energyMax, actor.energy + Math.round(settings.energyGainPerTurn / 2));
      events.push({ text: `⏭️ **${actor.cardName}** waits and watches.` });
      break;
    }
    default:
      break;
  }

  if (actor.hp < 0) actor.hp = 0;
  if (foe.hp < 0) foe.hp = 0;
  return { events, koed };
}

// Which moves are legal right now (for button enable/disable + AI).
export function availableMoves(actor: Combatant, settings: BattleSettings): Record<MoveType, boolean> {
  return {
    attack: true,
    special: actor.energy >= settings.specialCost,
    defend: true,
    special_card: !!actor.specialEffect && !!actor.specialCardId && actor.specialCooldownRemaining === 0,
    charge: true,
    skip: true,
    ultimate: actor.ultimate >= actor.stats.ultimateMax,
  };
}
