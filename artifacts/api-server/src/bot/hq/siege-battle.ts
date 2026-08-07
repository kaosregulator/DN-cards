// ─────────────────────────────────────────────────────────────────────────────
// HQ base siege — REAL battle-engine resolution.
//
// The auto-resolver in siege.ts decides a siege from raw card power. This module
// instead runs the ACTUAL turn-based combat engine (bot/battle) headlessly, so a
// siege plays out with real stats, movesets, passives, statuses, crits and KOs —
// the same maths as /battle — just without a live, click-through UI.
//
// It's a sequential gauntlet: the attacker's active card fights the defender's
// active card; whoever is knocked out is replaced by their side's next card (the
// survivor keeps its HP), until one side has no cards left. Both sides are driven
// by the battle AI. Pure of Discord/DB — it takes already-loaded cards + settings
// and returns the outcome plus a real blow-by-blow log.
// ─────────────────────────────────────────────────────────────────────────────

import type { BattleSettings } from "@workspace/db";
import type { OwnedBattleCard } from "../battle/db.js";
import type { Combatant, BattleEvent, AiDifficulty } from "../battle/types.js";
import type { Rarity } from "../cards-data.js";
import type { RarityContext } from "../rarity-runtime.js";
import { rarityLadderRank } from "../rarity-runtime.js";
import { getScaledStats, powerRating } from "../battle/stat-engine.js";
import { getMoveset, inferMoveset } from "../battle/movesets.js";
import { getPassive } from "../battle/passives.js";
import { inferSpecialEffect } from "../battle/special-cards.js";
import { startOfTurn, resolveMove } from "../battle/combat-engine.js";
import { chooseAiMove } from "../battle/ai-engine.js";
import { toAbsoluteImageUrl } from "../image-url.js";

// Both sides fight at a competent (not perfect) skill so specials/items/passives
// actually get used and upsets stay possible.
const SIEGE_AI_DIFFICULTY: AiDifficulty = "elite";
// Safety cap: a very tanky standoff can't loop forever. On reaching it we decide
// by cards remaining, then by summed HP% — the attacker must clear the walls, so
// an unresolved siege favours the defender (see below).
const MAX_SIEGE_TURNS = 120;

export interface SiegeFighterView {
  cardId: number;
  name: string;
  artUrl: string | null;
  rarityColor: number;
}

export interface SiegeBattleResult {
  attackerWon: boolean;
  events: BattleEvent[];              // real turn-by-turn log (attacker POV order)
  turns: number;
  attackerPower: number;             // Σ powerRating of the attacking squad
  defenderPower: number;
  attackerCardsLost: number;
  defenderCardsLost: number;
  // Per-defender-slot outcome in fight order — drives the siege animation.
  defenderFalls: { slot: number; defeated: boolean; move: string }[];
  championWinner: SiegeFighterView | null; // strongest card on the winning side
  championLoser: SiegeFighterView | null;
}

// Build a full battle Combatant from an owned card, headlessly — a faithful
// mirror of battle-manager.buildCombatant but parameterised (no BattleRuntime),
// with no equipped item (siege cards don't run the prep/item flow).
function buildSiegeCombatant(
  card: OwnedBattleCard, settings: BattleSettings, guildId: string, ctx: RarityContext,
  side: 0 | 1, ownerId: string, ownerName: string,
): Combatant {
  const battleRarity = (card.config?.rarity as Rarity) || (card.rarity as Rarity);
  const level = card.level;
  // Strength scales by the card's rank on the GUILD rarity ladder (custom tiers
  // included), the same source of truth /battle uses.
  const rankOverride = rarityLadderRank(
    String(card.config?.rarity ?? card.effectiveRarityKey ?? card.rarity), ctx,
  );
  const stats = getScaledStats(
    { id: card.id, name: card.name, rarity: card.rarity, worthValue: card.worthValue, cardType: card.cardType },
    card.config, settings, level, battleRarity, card.starRank, rankOverride,
  );
  const moveset = card.config?.moveset ?? inferMoveset(card.cardType, battleRarity);
  let specialEffect: string | null = null;
  let specialCooldownMax = 3;
  if (settings.specialCardsEnabled) {
    specialEffect = card.config?.specialEffect ?? inferSpecialEffect(card.cardType, battleRarity);
    specialCooldownMax = card.config?.specialCooldown ?? 3;
  }
  return {
    userId: ownerId, displayName: ownerName, isAi: true, aiDifficulty: SIEGE_AI_DIFFICULTY, side,
    cardId: card.id, cardName: card.name, cardRarity: battleRarity,
    cardType: card.cardType, cardImageUrl: toAbsoluteImageUrl(card.imageUrl),
    cardRarityDisplay: card.displayRarity,
    moveset, movesetDef: getMoveset(moveset, guildId),
    passive: getPassive(card.config?.passive ?? null, guildId),
    stats,
    hp: stats.maxHealth, shield: 0, energy: 40, ultimate: 0, status: [],
    specialCardId: card.id, specialCardName: card.name, specialEffect,
    specialCooldownMax, specialCooldownRemaining: 0,
    defending: false, nextAttackBoostPct: 0, doubleNextAttack: false,
    frozenTurns: 0, lastStandUsed: false,
    itemId: null, item: null, itemChargesRemaining: 0, itemCooldownRemaining: 0,
  };
}

const view = (c: Combatant, color: number): SiegeFighterView => ({
  cardId: c.cardId, name: c.cardName, artUrl: c.cardImageUrl, rarityColor: color,
});

// Apply the base's fortification to a defender: harden HP + attack + defence by
// the bonus %, then refill to the new max so the wall enters the fight at full
// strength. This is how built defences translate into real staying power.
function fortifyDefender(c: Combatant, bonusPct: number): void {
  const m = 1 + Math.max(0, bonusPct) / 100;
  c.stats.maxHealth = Math.round(c.stats.maxHealth * m);
  c.stats.attack = Math.round(c.stats.attack * m);
  c.stats.defense = Math.round(c.stats.defense * m);
  c.hp = c.stats.maxHealth;
}

// Run one headless turn for `actor` against `foe`: start-of-turn ticks, then an
// AI-chosen move. Returns whether the actor died (DoT) or KO'd the foe.
function runTurn(actor: Combatant, foe: Combatant, settings: BattleSettings): { events: BattleEvent[]; actorDied: boolean; foeDied: boolean } {
  const events: BattleEvent[] = [];
  const start = startOfTurn(actor, settings);
  events.push(...start.events);
  if (start.koed || actor.hp <= 0) return { events, actorDied: true, foeDied: false };
  if (start.skipped) return { events, actorDied: false, foeDied: false };
  const move = chooseAiMove(actor, foe, settings, SIEGE_AI_DIFFICULTY);
  const res = resolveMove(settings, actor, foe, move);
  events.push(...res.events);
  return { events, actorDied: actor.hp <= 0, foeDied: res.koed || foe.hp <= 0 };
}

// Simulate the whole siege. `attackerCards` / `defenderCards` are already ordered
// strongest-first by the caller. Returns the real outcome + log.
export function simulateSiegeBattle(
  attackerCards: OwnedBattleCard[],
  defenderCards: OwnedBattleCard[],
  settings: BattleSettings,
  guildId: string,
  ctx: RarityContext,
  meta: { attackerId: string; attackerName: string; defenderId: string; defenderName: string },
  // Fortification: the defender's built defences + base tier as a % (hq/fortify).
  // Hardens the garrison's HP/attack/defence, so a well-built base actually fights
  // back. 0 for an unfortified base or an AI territory.
  defenderBonusPct = 0,
): SiegeBattleResult {
  const attackers = attackerCards.map(c => buildSiegeCombatant(c, settings, guildId, ctx, 0, meta.attackerId, meta.attackerName));
  const defenders = defenderCards.map(c => buildSiegeCombatant(c, settings, guildId, ctx, 1, meta.defenderId, meta.defenderName));
  if (defenderBonusPct > 0) for (const d of defenders) fortifyDefender(d, defenderBonusPct);
  const attackerPower = attackers.reduce((s, c) => s + powerRating(c.stats), 0);
  const defenderPower = defenders.reduce((s, c) => s + powerRating(c.stats), 0);

  const events: BattleEvent[] = [];
  const defenderFalls: { slot: number; defeated: boolean; move: string }[] = [];

  // Degenerate inputs — decide on power, no combat to run.
  if (attackers.length === 0 || defenders.length === 0) {
    const attackerWon = attackers.length > 0;
    return {
      attackerWon, events, turns: 0, attackerPower, defenderPower,
      attackerCardsLost: attackerWon ? 0 : attackers.length,
      defenderCardsLost: attackerWon ? defenders.length : 0,
      defenderFalls: defenders.map((_, i) => ({ slot: i, defeated: attackerWon, move: "assault" })),
      championWinner: attackerWon ? (attackers[0] ? view(attackers[0], 0) : null) : (defenders[0] ? view(defenders[0], 0) : null),
      championLoser: attackerWon ? (defenders[0] ? view(defenders[0], 0) : null) : (attackers[0] ? view(attackers[0], 0) : null),
    };
  }

  let ai = 0, di = 0;                  // active-card indices
  let turns = 0;
  let attackerTurn = true;             // the raider strikes first
  let lastMove = "assault";
  while (ai < attackers.length && di < defenders.length && turns < MAX_SIEGE_TURNS) {
    turns++;
    const actor = attackerTurn ? attackers[ai]! : defenders[di]!;
    const foe = attackerTurn ? defenders[di]! : attackers[ai]!;
    const t = runTurn(actor, foe, settings);
    events.push(...t.events);
    // Capture a move caption for the animation from the attacker's exchanges.
    if (attackerTurn && t.events.length) lastMove = "assault";
    if (t.foeDied) {
      if (attackerTurn) {
        // A defender fell — advance the defender line.
        defenderFalls.push({ slot: di, defeated: true, move: lastMove });
        di++;
      } else {
        // An attacker card fell.
        ai++;
      }
    } else if (t.actorDied) {
      // The actor knocked itself out (DoT) — advance that side.
      if (attackerTurn) ai++; else { defenderFalls.push({ slot: di, defeated: true, move: lastMove }); di++; }
    }
    attackerTurn = !attackerTurn;
  }

  // Winner:
  //  • attacker cleared every defender → capture;
  //  • attacker's squad wiped → walls held;
  //  • turn-cap standoff → decide by ATTRITION progress (how far each side broke
  //    into the other's line: foes KO'd + damage on the current foe). A dead-even
  //    standoff favours the defender, since holding the base is the advantage.
  const hpFrac = (c: Combatant | undefined) => c ? Math.max(0, Math.min(1, c.hp / Math.max(1, c.stats.maxHealth))) : 0;
  let attackerWon: boolean;
  if (di >= defenders.length && ai < attackers.length) {
    attackerWon = true;
  } else if (ai >= attackers.length) {
    attackerWon = false;
  } else {
    const attackerProgress = di + (1 - hpFrac(defenders[di]));
    const defenderProgress = ai + (1 - hpFrac(attackers[ai]));
    attackerWon = attackerProgress > defenderProgress;
  }

  // Any defenders the attacker never reached are marked un-fallen for the render.
  for (let i = 0; i < defenders.length; i++) {
    if (!defenderFalls.some(d => d.slot === i)) defenderFalls.push({ slot: i, defeated: false, move: lastMove });
  }
  defenderFalls.sort((a, b) => a.slot - b.slot);

  const champWin = attackerWon
    ? (attackers[Math.min(ai, attackers.length - 1)] ?? attackers[0]!)
    : (defenders[Math.min(di, defenders.length - 1)] ?? defenders[0]!);
  const champLose = attackerWon
    ? (defenders[defenders.length - 1] ?? defenders[0]!)
    : (attackers[attackers.length - 1] ?? attackers[0]!);

  return {
    attackerWon, events, turns, attackerPower, defenderPower,
    attackerCardsLost: attackerWon ? ai : attackers.length,
    defenderCardsLost: attackerWon ? defenders.length : di,
    defenderFalls,
    championWinner: view(champWin, 0),
    championLoser: view(champLose, 0),
  };
}
