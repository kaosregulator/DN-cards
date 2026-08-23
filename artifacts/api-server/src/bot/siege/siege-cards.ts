// ─────────────────────────────────────────────────────────────────────────────
// Siege Battle Cards — the action-card library.
//
// These are NOT fighter cards and they are NOT Battle Items. A Siege Battle Card
// is a COMBAT ACTION the commander draws into a hand and plays during a Card
// Clash: a combo, a tactical order, a finisher, a formation manoeuvre. The
// fighter performs it; the card is the instruction.
//
// Deliberate separation from what already exists:
//   • Battle Items  — consumable inventory (heal / shield / EMP / armour …).
//     Items restore and protect. They are NOT re-implemented here.
//   • Movesets      — a card's own signature Special, one per fighter.
//   • Siege Cards   — multi-hit combos, conditional execution, whole-line orders,
//                     formation manipulation, and LP breakthroughs. Things that
//                     only make sense with FOUR fighters and a board.
//
// Everything is data-driven so a future admin tool (or a DB overlay, exactly
// like `battle_content` does for items) can author cards without touching the
// resolver. The resolver switches on `effect`, and every damaging effect routes
// through the shared combat engine.
// ─────────────────────────────────────────────────────────────────────────────

/** Who a card may be aimed at. */
export type SiegeCardTarget =
  | "enemy_unit"   // one chosen enemy card
  | "enemy_all"    // every living enemy card
  | "ally_unit"    // one chosen friendly card (may be the actor)
  | "ally_all"     // the whole friendly formation
  | "self"         // the acting card only
  | "enemy_lp"     // the enemy commander's life points, bypassing the formation
  | "none";        // no target (board-level effects)

/**
 * What the card actually does. Each maps to one branch of the resolver; none of
 * them duplicates an Item effect type or a Moveset kind.
 */
export type SiegeCardEffect =
  /** N sequential hits from the acting card at `power`% each. */
  | "multi_strike"
  /** One hit that grows the more wounded the target already is (a finisher). */
  | "execute"
  /** Full damage to the chosen card, reduced splash to the rest of the line. */
  | "cleave"
  /** EVERY living friendly card strikes the chosen target once. */
  | "focus_fire"
  /** Damage the target and heal the acting card for a share of it. */
  | "drain"
  /** Damage that ignores the formation entirely and lands on enemy LP. */
  | "breakthrough"
  /** Buff the attack of the whole friendly formation for a few turns. */
  | "rally"
  /** Put a damage-reflecting posture on the acting card. */
  | "counter_order"
  /** Shield a chosen ally from the acting card's own reserves of cover. */
  | "guard_order"
  /** Immediately pull a reserve card onto an empty square, out of sequence. */
  | "redeploy"
  /** Trade the acting card's charge for a devastating single blow. */
  | "overload"
  /** Strip a target's buffs/shield and lock its Special for a turn. */
  | "disrupt";

/** Visual family — drives the frame colour of the card in the hand. */
export type SiegeCardSchool = "assault" | "tactics" | "command" | "finisher" | "support";

export interface SiegeCardCondition {
  /** Playable only when the target is at or below this % of max HP. */
  targetHpBelowPct?: number;
  /** Playable only when at least this many friendly cards have been destroyed. */
  alliesFallenAtLeast?: number;
  /** Playable only when at least this many friendly cards are still standing. */
  livingAlliesAtLeast?: number;
  /** Playable only when the ENEMY formation is completely empty. */
  enemyFormationEmpty?: boolean;
  /** Playable only when a friendly square is empty and a reserve exists. */
  requiresEmptyFriendlySquare?: boolean;
}

export interface SiegeCard {
  id: string;
  name: string;
  emoji: string;
  description: string;
  school: SiegeCardSchool;
  /** Display tier — also how often it seeds into a deck. */
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";

  energyCost: number;
  target: SiegeCardTarget;
  effect: SiegeCardEffect;

  /** % of the actor's attack per hit (damaging effects) or magnitude (utility). */
  power: number;
  /** Hits for multi_strike; ignored elsewhere. */
  hits?: number;
  /** Splash % for cleave, heal share % for drain, buff % for rally… */
  secondary?: number;
  /** Turns a status from this card lasts. */
  duration?: number;
  /** Turns before the same card may be played again. */
  cooldown: number;
  /** Gating rules the resolver enforces. */
  conditions?: SiegeCardCondition;
  /** Copies seeded into a fresh deck. */
  copies: number;
  /** Flash hint the renderer themes the frame around. */
  animation?: "combo" | "crit" | "ultimate" | "shield" | "heal" | "counter" | "freeze" | "ko";
  enabled: boolean;
}

// ── The library ──────────────────────────────────────────────────────────────
// Tuned against the existing stat curve: `power` is a % of the actor's attack,
// so these read as roughly "a basic attack is 100".
export const DEFAULT_SIEGE_CARDS: SiegeCard[] = [
  // ── Assault: raw damage combos ────────────────────────────────────────────
  {
    id: "double_assault", name: "Double Assault", emoji: "⚔️",
    description: "Your fighter strikes the target twice in quick succession.",
    school: "assault", rarity: "common",
    energyCost: 20, target: "enemy_unit", effect: "multi_strike",
    power: 70, hits: 2, cooldown: 0, copies: 3, animation: "combo", enabled: true,
  },
  {
    id: "chain_assault", name: "Chain Assault", emoji: "🔗",
    description: "A relentless four-hit chain, each blow lighter than the last.",
    school: "assault", rarity: "rare",
    energyCost: 45, target: "enemy_unit", effect: "multi_strike",
    power: 55, hits: 4, cooldown: 2, copies: 1, animation: "combo", enabled: true,
  },
  {
    id: "command_strike", name: "Command Strike", emoji: "🎖️",
    description: "A precise ordered blow that cannot be dodged.",
    school: "assault", rarity: "uncommon",
    energyCost: 25, target: "enemy_unit", effect: "multi_strike",
    power: 150, hits: 1, cooldown: 1, copies: 2, animation: "crit", enabled: true,
  },
  {
    id: "final_barrage", name: "Final Barrage", emoji: "💥",
    description: "Saturate the enemy line — full force on one card, shrapnel on the rest.",
    school: "assault", rarity: "epic",
    energyCost: 55, target: "enemy_unit", effect: "cleave",
    power: 130, secondary: 45, cooldown: 3, copies: 1, animation: "ultimate", enabled: true,
  },

  // ── Finishers: conditional pay-offs ───────────────────────────────────────
  {
    id: "execution_order", name: "Execution Order", emoji: "🩸",
    description: "Finish a wounded card. The more hurt it is, the harder this lands.",
    school: "finisher", rarity: "rare",
    energyCost: 30, target: "enemy_unit", effect: "execute",
    power: 90, secondary: 140, cooldown: 2, copies: 2,
    conditions: { targetHpBelowPct: 60 }, animation: "crit", enabled: true,
  },
  {
    id: "blood_hunt", name: "Blood Hunt", emoji: "🦇",
    description: "Tear into the target and drink deep — heal for part of the damage.",
    school: "finisher", rarity: "uncommon",
    energyCost: 30, target: "enemy_unit", effect: "drain",
    power: 110, secondary: 50, cooldown: 1, copies: 2, animation: "heal", enabled: true,
  },
  {
    id: "last_stand", name: "Last Stand", emoji: "🔆",
    description: "With your line broken, the survivors fight like cornered animals.",
    school: "finisher", rarity: "rare",
    energyCost: 25, target: "ally_all", effect: "rally",
    power: 55, duration: 3, cooldown: 3, copies: 1,
    conditions: { alliesFallenAtLeast: 2 }, animation: "combo", enabled: true,
  },
  {
    id: "break_formation", name: "Break Formation", emoji: "🏴",
    description: "Punch clean through a shattered line and strike the commander.",
    school: "finisher", rarity: "legendary",
    energyCost: 50, target: "enemy_lp", effect: "breakthrough",
    power: 200, cooldown: 3, copies: 1,
    conditions: { enemyFormationEmpty: true }, animation: "ultimate", enabled: true,
  },

  // ── Command: whole-formation orders ───────────────────────────────────────
  {
    id: "focus_fire", name: "Focus Fire", emoji: "🎯",
    description: "Every card still standing fires on one target at once.",
    school: "command", rarity: "epic",
    energyCost: 50, target: "enemy_unit", effect: "focus_fire",
    power: 60, cooldown: 3, copies: 1,
    conditions: { livingAlliesAtLeast: 2 }, animation: "ultimate", enabled: true,
  },
  {
    id: "rapid_deployment", name: "Rapid Deployment", emoji: "🚁",
    description: "Rush a reserve card onto an empty square immediately.",
    school: "command", rarity: "uncommon",
    energyCost: 20, target: "none", effect: "redeploy",
    power: 0, cooldown: 2, copies: 2,
    conditions: { requiresEmptyFriendlySquare: true }, animation: "shield", enabled: true,
  },
  {
    id: "rally_the_line", name: "Rally the Line", emoji: "📣",
    description: "Steady the whole formation — every card hits harder for a while.",
    school: "command", rarity: "uncommon",
    energyCost: 30, target: "ally_all", effect: "rally",
    power: 30, duration: 3, cooldown: 2, copies: 2, animation: "combo", enabled: true,
  },

  // ── Tactics / support: control and protection ─────────────────────────────
  {
    id: "counter_order", name: "Counter Order", emoji: "↩️",
    description: "Take a reflective stance — incoming damage bounces back.",
    school: "tactics", rarity: "uncommon",
    energyCost: 25, target: "self", effect: "counter_order",
    power: 45, duration: 2, cooldown: 2, copies: 2, animation: "counter", enabled: true,
  },
  {
    id: "guard_order", name: "Guard Order", emoji: "🛡️",
    description: "Throw cover over an ally — they gain a shield.",
    school: "support", rarity: "common",
    energyCost: 20, target: "ally_unit", effect: "guard_order",
    power: 30, cooldown: 1, copies: 2, animation: "shield", enabled: true,
  },
  {
    id: "disruption_order", name: "Disruption Order", emoji: "📉",
    description: "Shatter a target's shield and suppress it — no Special next turn.",
    school: "tactics", rarity: "rare",
    energyCost: 30, target: "enemy_unit", effect: "disrupt",
    power: 30, duration: 2, cooldown: 2, copies: 1, animation: "freeze", enabled: true,
  },
  {
    id: "overload_core", name: "Overload Core", emoji: "☄️",
    description: "Dump every scrap of charge into one catastrophic blow.",
    school: "tactics", rarity: "epic",
    energyCost: 15, target: "enemy_unit", effect: "overload",
    power: 120, secondary: 2, cooldown: 3, copies: 1, animation: "ultimate", enabled: true,
  },
];

const REGISTRY = new Map<string, SiegeCard>(DEFAULT_SIEGE_CARDS.map(c => [c.id, c]));

export function getSiegeCard(id: string | null | undefined): SiegeCard | null {
  return id ? REGISTRY.get(id) ?? null : null;
}
export function listSiegeCards(): SiegeCard[] {
  return [...REGISTRY.values()].filter(c => c.enabled);
}

/** Frame colour used for this card in the hand render (maps to the frame art). */
export function schoolColor(school: SiegeCardSchool): "red" | "blue" | "green" | "yellow" | "purple" {
  switch (school) {
    case "assault": return "red";
    case "tactics": return "blue";
    case "command": return "yellow";
    case "finisher": return "purple";
    case "support": return "green";
  }
}

/**
 * Build a fresh, shuffled draw pile. Every siege starts from the same seeded
 * library so a commander's hand is a matter of draw luck, not collection.
 */
export function buildSiegeDeck(rng: () => number = Math.random): SiegeCard[] {
  const deck: SiegeCard[] = [];
  for (const card of listSiegeCards()) {
    for (let i = 0; i < card.copies; i++) deck.push(card);
  }
  // Fisher–Yates.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}
