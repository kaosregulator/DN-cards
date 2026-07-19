// Raid engine — builds player/boss combatants and resolves co-op rounds by
// REUSING the existing combat engine (deriveStats, resolveMove, startOfTurn) so
// raid combat behaves exactly like a normal battle, just N players vs 1 boss
// with a shared, party-scaled health pool.

import type { BattleSettings, RaidBoss } from "@workspace/db";
import type { Combatant, BattleEvent, BattleStats, MoveType, Rarity } from "../battle/types.js";
import type { RenderCard } from "../battle/image/render.js";
import { getScaledStats } from "../battle/stat-engine.js";
import { inferMoveset } from "../battle/movesets.js";
import { resolveMove, startOfTurn } from "../battle/combat-engine.js";
import { computeMoveVisual, combatantToRenderCard, type MoveVisual } from "../battle/turn-visual.js";
import { rarityRank } from "../battle/config-engine.js";
import type { OwnedBattleCard } from "../battle/db.js";
import { toAbsoluteImageUrl } from "../image-url.js";

export const BOSS_USER_ID = "BOSS";

export interface PartyMemberSpec {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;   // Discord avatar (shown on a solo raid clear)
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
  const stats = getScaledStats(cardish, member.card.config, settings, member.card.level ?? 1, battleRarity);
  return {
    userId: member.userId, displayName: member.displayName, isAi: false, side: 0,
    cardId: member.card.id, cardName: member.card.name, cardRarity: battleRarity,
    cardType: member.card.cardType, cardImageUrl: toAbsoluteImageUrl(member.card.imageUrl),
    moveset: member.card.config?.moveset ?? inferMoveset(member.card.cardType, battleRarity),
    stats, hp: stats.maxHealth, shield: 0, energy: 40, ultimate: 0, status: [],
    specialCardId: null, specialCardName: null, specialEffect: null,
    specialCooldownMax: 3, specialCooldownRemaining: 0,
    defending: false, nextAttackBoostPct: 0, doubleNextAttack: false,
    frozenTurns: 0, lastStandUsed: false,
  };
}

// ── Round resolution ─────────────────────────────────────────────────────────

// One step of the round, ready to REPLAY through the shared battle animation
// pipeline (the same renderAttackFrame battles use). A beat with a `visual` +
// `attacker` is an on-screen hit; a beat with neither is a text-only tick
// (start-of-turn DoT, enrage/sweep announcements). Each beat snapshots HP so the
// manager can redraw the board at that exact moment while replaying.
export interface RaidBeat {
  texts: string[];
  attacker?: RenderCard;
  defender?: RenderCard;  // the card being attacked (boss or player)
  moveName?: string;
  visual?: MoveVisual;
  bossHp: number;
  partyHp: Record<string, number>; // userId → hp after this beat
}

export interface RoundResult {
  events: BattleEvent[];
  beats: RaidBeat[];
  bossKoed: boolean;
  wiped: boolean;              // all players down
  downedThisRound: string[];  // userIds KO'd during the round
}

const RAID_MOVE_LABEL: Record<string, string> = {
  attack: "Attack", special: "Special", defend: "Defend", charge: "Charge",
};

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
  const beats: RaidBeat[] = [];
  const downedThisRound: string[] = [];
  const living = () => players.filter(p => p.hp > 0);
  const snap = (): Record<string, number> =>
    Object.fromEntries(players.map(p => [p.userId, Math.max(0, p.hp)]));

  // Record one on-screen hit: resolve `move` and capture its shared MoveVisual.
  const hitBeat = (actor: Combatant, foe: Combatant, move: MoveType, moveName: string): void => {
    const foePool = foe.hp + foe.shield;
    const selfPool = actor.hp + actor.shield;
    const r = resolveMove(settings, actor, foe, move);
    events.push(...r.events);
    beats.push({
      texts: r.events.map(e => e.text),
      attacker: combatantToRenderCard(actor),
      defender: combatantToRenderCard(foe),
      moveName,
      visual: computeMoveVisual(move, r, actor, foe, foePool, selfPool),
      bossHp: Math.max(0, boss.hp),
      partyHp: snap(),
    });
  };

  // 1) Start-of-round status ticks (players then boss) → one text-only beat.
  const tickTexts: string[] = [];
  for (const p of living()) {
    const st = startOfTurn(p, settings);
    events.push(...st.events); tickTexts.push(...st.events.map(e => e.text));
    if (p.hp <= 0) downedThisRound.push(p.userId);
  }
  {
    const st = startOfTurn(boss, settings);
    events.push(...st.events); tickTexts.push(...st.events.map(e => e.text));
  }
  if (tickTexts.length) beats.push({ texts: tickTexts, bossHp: Math.max(0, boss.hp), partyHp: snap() });
  if (boss.hp <= 0) return { events, beats, bossKoed: true, wiped: false, downedThisRound };

  // 2) Players act (in speed order for a little tactical flavour).
  const order = living().sort((a, b) => b.stats.speed - a.stats.speed);
  for (const p of order) {
    if (p.hp <= 0 || boss.hp <= 0) continue;
    const move = actions.get(p.userId) ?? "defend"; // no input → brace
    hitBeat(p, boss, move, RAID_MOVE_LABEL[move] ?? move);
    if (boss.hp <= 0) return { events, beats, bossKoed: true, wiped: false, downedThisRound };
  }

  // 3) Boss acts. Enrage ramps attack; periodic sweeps hit the whole party.
  const enraged = enrageTurn > 0 && roundNumber >= enrageTurn;
  const savedAttack = boss.stats.attack;
  if (enraged) {
    const ramp = 1 + 0.15 * (roundNumber - enrageTurn + 1);
    boss.stats.attack = Math.round(savedAttack * Math.min(2.5, ramp));
    const t = `🔥 **${boss.cardName}** is **ENRAGED** — its blows hit harder!`;
    events.push({ text: t, flash: "burn" });
    beats.push({ texts: [t], bossHp: Math.max(0, boss.hp), partyHp: snap() });
  }

  const sweep = enraged || roundNumber % 4 === 0;
  if (sweep) {
    const t = `💥 **${boss.cardName}** unleashes a devastating **sweep** across the party!`;
    events.push({ text: t, flash: "ultimate" });
    beats.push({ texts: [t], bossHp: Math.max(0, boss.hp), partyHp: snap() });
    for (const p of living()) {
      hitBeat(boss, p, "attack", "Sweep");
      if (p.hp <= 0) downedThisRound.push(p.userId);
    }
  } else {
    // Focus the lowest-HP living player (try to secure a KO).
    const target = living().sort((a, b) => a.hp - b.hp)[0];
    if (target) {
      hitBeat(boss, target, "attack", "Strike");
      if (target.hp <= 0) downedThisRound.push(target.userId);
    }
  }
  boss.stats.attack = savedAttack;

  const wiped = living().length === 0;
  return { events, beats, bossKoed: boss.hp <= 0, wiped, downedThisRound };
}
