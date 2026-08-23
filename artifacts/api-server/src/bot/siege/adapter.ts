// ─────────────────────────────────────────────────────────────────────────────
// Siege Adapter + Render Bridge.
//
// Two one-way translations, kept together because they are the seams between
// the engine and everything around it:
//
//   Card Data → Siege     `toSiegeRoster` turns the Combatants a caller already
//                         built (from /battle prep, a raid, an HQ garrison) into
//                         a siege army. No card data is redefined here.
//
//   Siege → Renderer      `toFieldInput` / `toClashInput` project battle STATE
//                         onto the two screens. They read state and produce
//                         drawing input; they never compute an outcome, so a
//                         renderer can never disagree with the resolver.
// ─────────────────────────────────────────────────────────────────────────────

import type { Combatant } from "../battle/types.js";
import type {
  SiegeFieldInput, SiegeFieldFighter, SiegeFieldLineupCard,
} from "../animations/siege-field.js";
import type { CardClashInput, ClashFighter, ClashHandCard } from "../animations/card-clash.js";
import { getSiegeCard, schoolColor, type SiegeCard } from "./siege-cards.js";
import { livingSlots, otherSide, teamOf } from "./state.js";
import { getBattleItem } from "../battle/items.js";
import { getMoveset } from "../battle/movesets.js";
import type { SiegeAction } from "./types.js";
import { checkAction } from "./resolver.js";
import type { SideIdx, SiegeBattleState, SiegeTeam, SiegeTurnResult } from "./types.js";

// ── Card Data → Siege ────────────────────────────────────────────────────────

/**
 * Order a roster for the board. Strongest first, so the first four take the
 * squares and the rest wait in reserve — the same "strongest first" convention
 * the existing siege column used.
 */
export function toSiegeRoster(cards: Combatant[]): Combatant[] {
  return [...cards].sort((a, b) => {
    const pa = a.stats.attack + a.stats.defense + a.stats.maxHealth / 10;
    const pb = b.stats.attack + b.stats.defense + b.stats.maxHealth / 10;
    return pb - pa;
  });
}

// ── Siege → Formation battlefield ────────────────────────────────────────────

/** One board square as the battlefield renderer wants it. */
function lineupCard(
  team: SiegeTeam, slotIdx: number, opts: { activeSlot?: number; struck?: { slot: number; before: number; aoe: boolean } },
): SiegeFieldLineupCard | null {
  const unit = team.slots[slotIdx]?.unit;
  if (!unit) return null;
  const struck = opts.struck;
  return {
    name: unit.cardName,
    artUrl: unit.cardImageUrl,
    rarity: unit.cardRarity,
    rarityColor: unit.cardRarityDisplay?.color ?? null,
    hp: Math.max(0, unit.hp),
    maxHp: unit.stats.maxHealth,
    hpBefore: struck && struck.slot === slotIdx ? struck.before : undefined,
    energy: unit.energy,
    fallen: unit.hp <= 0,
    active: opts.activeSlot === slotIdx,
    struck: struck ? struck.aoe || struck.slot === slotIdx : false,
  };
}

function fieldFighter(unit: Combatant, hpBefore?: number): SiegeFieldFighter {
  return {
    name: unit.cardName,
    artUrl: unit.cardImageUrl,
    rarity: unit.cardRarity,
    rarityColor: unit.cardRarityDisplay?.color ?? null,
    hp: Math.max(0, unit.hp),
    maxHp: unit.stats.maxHealth,
    hpBefore,
    energy: unit.energy,
    ultimate: unit.ultimate,
  };
}

export interface FieldProjection {
  actingSide: SideIdx;
  actorSlot: number;
  targetSlot?: number;
  moveName: string;
  damage: number;
  isHit: boolean;
  isCrit: boolean;
  ko: boolean;
  aoe?: boolean;
  /** Pre-hit HP of the struck card, so its plaque animates the drain. */
  struckBefore?: number;
  accent: number;
  backdropKey?: string | null;
  floorKey?: string | null;
  /** Override phase chip; defaults from battle state. */
  phase?: "draw" | "main" | "battle" | "reinforce" | "end";
  /** Cards revealed during DRAW cinematic. */
  drawnCards?: { name: string; emoji: string }[];
}

/**
 * Project the battle onto the FORMATION battlefield — the board with four cards
 * a side. The renderer draws every square; the single attacker/defender pair
 * still drives the HUD life-plates.
 */
export function toFieldInput(state: SiegeBattleState, p: FieldProjection): SiegeFieldInput {
  const actingTeam = teamOf(state, p.actingSide);
  const foeSide = otherSide(p.actingSide);
  const foeTeam = teamOf(state, foeSide);

  const actor = actingTeam.slots[p.actorSlot]?.unit;
  const target = p.targetSlot != null ? foeTeam.slots[p.targetSlot]?.unit : null;

  const struck = p.targetSlot != null && p.struckBefore != null
    ? { slot: p.targetSlot, before: p.struckBefore, aoe: !!p.aoe }
    : undefined;

  const lineupFor = (team: SiegeTeam, activeSlot: number | undefined, withStruck: boolean) =>
    team.slots
      .map((_, i) => lineupCard(team, i, { activeSlot, struck: withStruck ? struck : undefined }))
      .filter((c): c is SiegeFieldLineupCard => !!c);

  // Side 0 is always drawn on the left, regardless of who is acting.
  const t0 = teamOf(state, 0), t1 = teamOf(state, 1);
  const attackerLineup = lineupFor(t0, p.actingSide === 0 ? p.actorSlot : (foeSide === 0 ? p.targetSlot : undefined), foeSide === 0);
  const defenderLineup = lineupFor(t1, p.actingSide === 1 ? p.actorSlot : (foeSide === 1 ? p.targetSlot : undefined), foeSide === 1);

  // HUD fighters: whoever is acting on each side, falling back to the front card.
  const front = (team: SiegeTeam) => livingSlots(team)[0]?.unit ?? team.slots.find(s => s.unit)?.unit ?? null;
  const hud0 = (p.actingSide === 0 ? actor : foeSide === 0 ? target : null) ?? front(t0);
  const hud1 = (p.actingSide === 1 ? actor : foeSide === 1 ? target : null) ?? front(t1);

  const blank: SiegeFieldFighter = {
    name: "—", artUrl: null, rarity: "common", rarityColor: null, hp: 0, maxHp: 1,
  };
  const phaseChip: SiegeFieldInput["phase"] = p.phase
    ?? (state.phase === "draw" ? "draw"
      : state.phase === "main" ? "main"
      : state.phase === "reinforce" ? "reinforce"
      : state.phase === "ended" ? "end"
      : "battle");
  return {
    attacker: hud0 ? fieldFighter(hud0, foeSide === 0 ? p.struckBefore : undefined) : blank,
    defender: hud1 ? fieldFighter(hud1, foeSide === 1 ? p.struckBefore : undefined) : blank,
    actingSide: p.actingSide,
    moveName: p.moveName,
    damage: p.damage,
    isHit: p.isHit,
    isCrit: p.isCrit,
    ko: p.ko,
    accent: p.accent,
    turnLabel: `Turn ${state.turn}`,
    phase: phaseChip,
    drawnCards: p.drawnCards,
    backdropKey: p.backdropKey ?? null,
    floorKey: p.floorKey ?? null,
    attackerLineup,
    defenderLineup,
    aoe: p.aoe,
  };
}

// ── Siege → Card Clash ───────────────────────────────────────────────────────

function clashFighter(unit: Combatant, hpBefore?: number): ClashFighter {
  return {
    name: unit.cardName,
    artUrl: unit.cardImageUrl,
    rarity: unit.cardRarity,
    rarityColor: unit.cardRarityDisplay?.color ?? null,
    hp: Math.max(0, unit.hp),
    maxHp: unit.stats.maxHealth,
    hpBefore,
    energy: Math.round((unit.energy / Math.max(1, unit.stats.energyMax)) * 100),
    ultimate: Math.round((unit.ultimate / Math.max(1, unit.stats.ultimateMax)) * 100),
    power: Math.round(unit.stats.attack),
    stars: rarityStars(unit.cardRarity),
  };
}

function rarityStars(rarity: string): number {
  return ({ common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 5 } as Record<string, number>)[rarity] ?? 1;
}

/**
 * The acting commander's hand, with each card marked playable or not. The
 * disabled flag comes from `checkAction` — the SAME gate the resolver enforces
 * — so a card can never look playable in the render but be refused on click.
 */
export function toHandCards(
  state: SiegeBattleState, actorSlot: number, playingId?: string,
): ClashHandCard[] {
  const team = teamOf(state, state.activeSide);
  return team.hand.map((card: SiegeCard) => ({
    name: card.name,
    emoji: card.emoji,
    description: card.description,
    energyCost: card.energyCost,
    color: schoolColor(card.school),
    disabled: !checkAction(state, { kind: "siege_card", actorSlot, cardId: card.id }).ok,
    playing: playingId === card.id,
  }));
}

export interface ClashProjection extends FieldProjection {
  /** The Siege Battle Card being played this beat, if any. */
  playingCardId?: string;
  arenaName?: string | null;
  attackerCommanderRole?: string;
  defenderCommanderRole?: string;
  /** Override the phase chip; defaults from battle state. */
  phase?: "draw" | "main" | "battle" | "end";
}

/**
 * Project the battle onto the CARD CLASH screen — the close-up duel between the
 * chosen fighter and its target. This is a cinematic presentation of a resolved
 * beat, not a separate battle mode.
 */
export function toClashInput(state: SiegeBattleState, p: ClashProjection): CardClashInput | null {
  const actingTeam = teamOf(state, p.actingSide);
  const foeSide = otherSide(p.actingSide);
  const foeTeam = teamOf(state, foeSide);
  const actor = actingTeam.slots[p.actorSlot]?.unit;
  const target = p.targetSlot != null ? foeTeam.slots[p.targetSlot]?.unit : null;
  if (!actor) return null;

  // Side 0 is drawn on the left. Whichever of the pair belongs to side 0 goes
  // there, so the clash keeps the same left/right ownership as the battlefield.
  const left = p.actingSide === 0 ? actor : target;
  const right = p.actingSide === 0 ? target : actor;
  const struckIsLeft = foeSide === 0;

  const t0 = teamOf(state, 0), t1 = teamOf(state, 1);
  const blank: ClashFighter = {
    name: "—", artUrl: null, rarity: "common", rarityColor: null, hp: 0, maxHp: 1,
  };

  const phaseChip: CardClashInput["phase"] = p.phase
    ?? (state.phase === "draw" ? "draw"
      : state.phase === "main" ? "main"
      : state.phase === "ended" ? "end"
      : "battle");

  return {
    attacker: left ? clashFighter(left, struckIsLeft ? p.struckBefore : undefined) : blank,
    defender: right ? clashFighter(right, struckIsLeft ? undefined : p.struckBefore) : blank,
    actingSide: p.actingSide,
    attackerCommander: {
      name: t0.name, role: p.attackerCommanderRole ?? "Commander", lp: t0.lp, lpMax: t0.lpMax,
    },
    defenderCommander: {
      name: t1.name, role: p.defenderCommanderRole ?? "Garrison", lp: t1.lp, lpMax: t1.lpMax,
    },
    // The field's banner prepends the actor; the clash shows the pair in full.
    moveName: `${actor.cardName} · ${p.moveName}`,
    damage: p.damage,
    isHit: p.isHit,
    isCrit: p.isCrit,
    ko: p.ko,
    accent: p.accent,
    turnLabel: `Turn ${state.turn}`,
    phase: phaseChip,
    log: state.log.slice(-9).map(e => e.text),
    hand: toHandCards(state, p.actorSlot, p.playingCardId),
    energy: {
      current: Math.round(actor.energy / 20),
      max: Math.round(actor.stats.energyMax / 20),
    },
    arenaName: p.arenaName ?? null,
  };
}

// ── Result → projection ──────────────────────────────────────────────────────

/**
 * Turn a resolved action into the numbers the two screens draw. Damage comes
 * from the resolver's MEASURED before/after deltas, never from parsing log
 * text, so a render can never disagree with what the engine applied.
 */
export function summariseResult(
  result: SiegeTurnResult, foeSide: SideIdx,
): { damage: number; lpDamage: number; isHit: boolean; isCrit: boolean; ko: boolean; struckBefore?: number; struckSlot?: number; aoe: boolean } {
  const enemyHits = result.struck.filter(h => h.side === foeSide && h.damage > 0);
  // The focus card is whichever enemy took the most — that is the one the
  // camera follows and whose plaque animates the drain.
  const focus = enemyHits.reduce<typeof enemyHits[number] | undefined>(
    (best, h) => (!best || h.damage > best.damage ? h : best), undefined);
  const isCrit = result.events.some(e => e.flash === "crit");
  return {
    damage: result.damageDealt,
    lpDamage: result.lpDamage,
    isHit: result.damageDealt > 0 || result.lpDamage > 0,
    isCrit,
    ko: result.destroyed.length > 0,
    struckBefore: focus?.before,
    struckSlot: focus?.slot,
    aoe: enemyHits.length > 1,
  };
}

// ── Action → label ───────────────────────────────────────────────────────────

/**
 * A human label for an action, e.g. "Ronin Vega - Final Barrage". Callers use
 * this for the move banner and the log so a raw card id or move key can never
 * leak into the UI. Signature moves resolve through the existing moveset
 * registry, so a card's Special is named by the card, not by this module.
 */
export function describeAction(state: SiegeBattleState, action: SiegeAction): string {
  if (action.kind === "reinforce") return "Reinforcements deploy";
  const actor = teamOf(state, state.activeSide).slots[action.actorSlot]?.unit;
  return `${actor?.cardName ?? "Card"} - ${describeMove(state, action)}`;
}

/**
 * Just the move/card/item name, WITHOUT the acting card's name. The formation
 * battlefield's banner prepends the actor itself, so it takes this; the Card
 * Clash shows the full "Actor - Move" from describeAction.
 */
export function describeMove(state: SiegeBattleState, action: SiegeAction): string {
  if (action.kind === "reinforce") return "Reinforce";
  const actor = teamOf(state, state.activeSide).slots[action.actorSlot]?.unit;
  switch (action.kind) {
    case "siege_card":
      return getSiegeCard(action.cardId)?.name ?? action.cardId;
    case "item":
      return getBattleItem(action.itemId, state.settings.guildId)?.name ?? action.itemId;
    case "direct_lp":
      return "Direct Attack";
    case "move": {
      if (action.move === "special" && actor) {
        const ms = actor.movesetDef ?? getMoveset(actor.moveset);
        if (ms) return ms.name;
      }
      return ({
        attack: "Attack", special: "Special", ultimate: "Ultimate",
        defend: "Defend", charge: "Charge", special_card: "Support Card",
        item: "Battle Item", skip: "Hold",
      } as Record<string, string>)[action.move] ?? action.move;
    }
  }
}
