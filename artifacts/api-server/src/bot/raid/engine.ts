// Raid engine — builds player/boss combatants and resolves co-op rounds by
// REUSING the existing combat engine (deriveStats, resolveMove, startOfTurn) so
// raid combat behaves exactly like a normal battle, just N players vs 1 boss
// with a shared, party-scaled health pool.

import type { BattleSettings, RaidBoss } from "@workspace/db";
import type { Combatant, BattleEvent, BattleStats, MoveType, Rarity } from "../battle/types.js";
import { deriveStats, applyStatOverrides } from "../battle/stat-engine.js";
import { resolveMove, startOfTurn } from "../battle/combat-engine.js";
import { rarityRank } from "../battle/config-engine.js";
import type { OwnedBattleCard } from "../battle/db.js";
import { toAbsoluteImageUrl } from "../image-url.js";

export const BOSS_USER_ID = "BOSS";

export interface PartyMemberSpec {
  userId: string;
  displayName: string;
  card: OwnedBattleCard;
  cardLevel: number;   // for scaling + display
  cardStars: number;
}

// ── Party power (drives boss scaling) ────────────────────────────────────────
function memberPower(rarity: Rarity, level: number): number {
  return (rarityRank(rarity) + 1) * (1 + level * 0.03);
}

// ── Boss combatant, scaled to the party that showed up ───────────────────────
export function buildBossCombatant(
  boss: RaidBoss, settings: BattleSettings, party: PartyMemberSpec[],
): Combatant {
  const size = Math.max(1, party.length);
  const avgRank = party.reduce((s, m) => s + rarityRank(m.card.rarity as Rarity), 0) / size;
  const avgLevel = party.reduce((s, m) => s + m.cardLevel, 0) / size;

  // Party-scaled health: base per-player HP × party size × a power factor,
  // then the admin's healthScalingPct knob. Bigger/stronger parties face a
  // bigger boss so the fight stays a real challenge.
  const powerFactor = 0.8 + avgRank * 0.04 + avgLevel * 0.008;
  const maxHealth = Math.max(
    boss.baseHealth,
    Math.round(boss.baseHealth * size * powerFactor * (boss.healthScalingPct / 100)),
  );
  const attack = Math.round(boss.baseAttack * (1 + avgRank * 0.05));

  const stats: BattleStats = {
    maxHealth,
    attack,
    defense: boss.baseDefense,
    speed: 60,
    luck: 25,
    critChance: 16,
    accuracy: 96,
    dodge: 4,
    energyMax: 100,
    ultimateMax: settings.ultimateThreshold,
  };

  return {
    userId: BOSS_USER_ID, displayName: boss.name, isAi: true, side: 1,
    cardId: -boss.id, cardName: boss.name, cardRarity: (boss.rarity as Rarity),
    cardType: boss.archetype, cardImageUrl: toAbsoluteImageUrl(boss.imageUrl),
    stats, hp: maxHealth, shield: 0, energy: 40, ultimate: 0, status: [],
    specialCardId: null, specialCardName: null, specialEffect: null,
    specialCooldownMax: 3, specialCooldownRemaining: 0,
    defending: false, nextAttackBoostPct: 0, doubleNextAttack: false,
    frozenTurns: 0, lastStandUsed: false,
  };
}

// ── Player combatant (mirrors battle-manager.buildCombatant, no support card) ─
export function buildPlayerCombatant(
  member: PartyMemberSpec, settings: BattleSettings,
): Combatant {
  const battleRarity = (member.card.config?.rarity as Rarity) || (member.card.rarity as Rarity);
  const cardish = {
    id: member.card.id, name: member.card.name, rarity: member.card.rarity,
    worthValue: member.card.worthValue, cardType: member.card.cardType,
  };
  const stats = applyStatOverrides(deriveStats(cardish, settings, battleRarity), member.card.config);
  return {
    userId: member.userId, displayName: member.displayName, isAi: false, side: 0,
    cardId: member.card.id, cardName: member.card.name, cardRarity: battleRarity,
    cardType: member.card.cardType, cardImageUrl: member.card.imageUrl,
    stats, hp: stats.maxHealth, shield: 0, energy: 40, ultimate: 0, status: [],
    specialCardId: null, specialCardName: null, specialEffect: null,
    specialCooldownMax: 3, specialCooldownRemaining: 0,
    defending: false, nextAttackBoostPct: 0, doubleNextAttack: false,
    frozenTurns: 0, lastStandUsed: false,
  };
}

// ── Round resolution ─────────────────────────────────────────────────────────
export interface RoundResult {
  events: BattleEvent[];
  bossKoed: boolean;
  wiped: boolean;              // all players down
  downedThisRound: string[];  // userIds KO'd during the round
}

export interface RaidRoundInput {
  settings: BattleSettings;
  boss: Combatant;
  players: Combatant[];              // includes downed; filter by hp>0
  actions: Map<string, MoveType>;    // userId → chosen move (missing = defend)
  roundNumber: number;
  enrageTurn: number;
}

export function resolveRaidRound(input: RaidRoundInput): RoundResult {
  const { settings, boss, players, actions, roundNumber, enrageTurn } = input;
  const events: BattleEvent[] = [];
  const downedThisRound: string[] = [];
  const living = () => players.filter(p => p.hp > 0);

  // 1) Start-of-round status ticks (players then boss).
  for (const p of living()) {
    const st = startOfTurn(p, settings);
    events.push(...st.events);
    if (p.hp <= 0) downedThisRound.push(p.userId);
  }
  {
    const st = startOfTurn(boss, settings);
    events.push(...st.events);
  }
  if (boss.hp <= 0) return { events, bossKoed: true, wiped: false, downedThisRound };

  // 2) Players act (in speed order for a little tactical flavour).
  const order = living().sort((a, b) => b.stats.speed - a.stats.speed);
  for (const p of order) {
    if (p.hp <= 0 || boss.hp <= 0) continue;
    const move = actions.get(p.userId) ?? "defend"; // no input → brace
    const r = resolveMove(settings, p, boss, move);
    events.push(...r.events);
    if (boss.hp <= 0) return { events, bossKoed: true, wiped: false, downedThisRound };
  }

  // 3) Boss acts. Enrage ramps attack; periodic sweeps hit the whole party.
  const enraged = enrageTurn > 0 && roundNumber >= enrageTurn;
  const savedAttack = boss.stats.attack;
  if (enraged) {
    const ramp = 1 + 0.15 * (roundNumber - enrageTurn + 1);
    boss.stats.attack = Math.round(savedAttack * Math.min(2.5, ramp));
    events.push({ text: `🔥 **${boss.cardName}** is **ENRAGED** — its blows hit harder!`, flash: "burn" });
  }

  const sweep = enraged || roundNumber % 4 === 0;
  if (sweep) {
    events.push({ text: `💥 **${boss.cardName}** unleashes a devastating **sweep** across the party!`, flash: "ultimate" });
    for (const p of living()) {
      const r = resolveMove(settings, boss, p, "attack");
      events.push(...r.events);
      if (p.hp <= 0) downedThisRound.push(p.userId);
    }
  } else {
    // Focus the lowest-HP living player (try to secure a KO).
    const target = living().sort((a, b) => a.hp - b.hp)[0];
    if (target) {
      const r = resolveMove(settings, boss, target, "attack");
      events.push(...r.events);
      if (target.hp <= 0) downedThisRound.push(target.userId);
    }
  }
  boss.stats.attack = savedAttack;

  const wiped = living().length === 0;
  return { events, bossKoed: boss.hp <= 0, wiped, downedThisRound };
}
