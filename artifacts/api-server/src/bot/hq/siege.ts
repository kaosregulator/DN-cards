// ─────────────────────────────────────────────────────────────────────────────
// HQ base siege — the capture/defend mini-game's combat resolution.
//
// A raid-/gym-style attack: the attacker's squad fights the base's stationed
// DEFENDERS. Outcome is DERIVED from card power on the guild strength ladder —
// the same source of truth battles and raids use (rarityLadderRank) — so no new
// balance surface. Resolution is a sequence of 1-v-1 duels (attacker[i] vs
// defender[i]); the side that wins the most duels takes the field. Pure and
// side-effect free; the hub applies capture/shield/cooldown and renders it.
//
// A fuller turn-by-turn simulation (resolveRaidRound) can slot in later behind
// this same interface without touching callers.
// ─────────────────────────────────────────────────────────────────────────────

export interface SiegeCombatant {
  cardId: number;
  name: string;
  rarity: string;
  rarityLabel: string;
  rarityColor: number;
  artUrl: string | null;
  power: number; // guild-ladder strength (+ level/worth), computed by the hub
}

export interface SiegeDuel {
  attacker: SiegeCombatant;
  defender: SiegeCombatant;
  attackerRoll: number;
  defenderRoll: number;
  attackerWon: boolean;
}

export interface SiegeResult {
  attackerWon: boolean;
  duels: SiegeDuel[];
  attackerWins: number;
  defenderWins: number;
  attackerPower: number;   // total squad power
  defenderPower: number;
  championWinner: SiegeCombatant | null; // strongest card on the winning side
  championLoser: SiegeCombatant | null;  // strongest card on the losing side
}

// A little variance so a slightly weaker squad can still pull off an upset, but
// power still dominates. `rand` is injectable for deterministic tests.
const VARIANCE = 0.3; // ±30%

export function resolveSiege(
  attackers: SiegeCombatant[],
  defenders: SiegeCombatant[],
  rand: () => number = Math.random,
  // Fortification: the defender's built defences + base tier, as a % that hardens
  // every defender's roll (hq/fortify.ts). 0 for an unfortified base / territory.
  defenderBonusPct = 0,
): SiegeResult {
  const fortify = 1 + Math.max(0, defenderBonusPct) / 100;
  const n = Math.max(attackers.length, defenders.length);
  const duels: SiegeDuel[] = [];
  let attackerWins = 0, defenderWins = 0;

  for (let i = 0; i < n; i++) {
    const a = attackers[i % Math.max(1, attackers.length)];
    const d = defenders[i % Math.max(1, defenders.length)];
    if (!a && !d) continue;
    // A side with no card at this post auto-loses the post.
    const attackerRoll = a ? a.power * (1 + (rand() * 2 - 1) * VARIANCE) : 0;
    const defenderRoll = d ? d.power * fortify * (1 + (rand() * 2 - 1) * VARIANCE) : 0;
    const attackerWon = attackerRoll >= defenderRoll;
    if (a && d) duels.push({ attacker: a, defender: d, attackerRoll, defenderRoll, attackerWon });
    if (attackerWon) attackerWins++; else defenderWins++;
  }

  // Ties favour the defender (holding the base is an advantage).
  const attackerWon = attackerWins > defenderWins;
  const strongest = (list: SiegeCombatant[]): SiegeCombatant | null =>
    list.length ? list.reduce((b, c) => (c.power > b.power ? c : b)) : null;

  return {
    attackerWon,
    duels,
    attackerWins,
    defenderWins,
    attackerPower: attackers.reduce((s, c) => s + c.power, 0),
    defenderPower: defenders.reduce((s, c) => s + c.power, 0),
    championWinner: attackerWon ? strongest(attackers) : strongest(defenders),
    championLoser: attackerWon ? strongest(defenders) : strongest(attackers),
  };
}

// Anti-farm knobs (hub reads these).
export const SIEGE_SHIELD_MS = 60 * 60 * 1000;   // 1h shield after a base is taken
export const SIEGE_COOLDOWN_MS = 15 * 60 * 1000; // per-target attacker cooldown
export const SIEGE_MAX_PER_WINDOW = 3;           // attacks per target per cooldown window

// Hold-tribute: a captured base pays its current holder a passive shard stipend
// the whole time they hold it — "shards while you hold". Minted, never drained
// from anyone; collected pull-based when the holder views the World map. Accrual
// is capped so a base left unvisited for weeks doesn't dump a jackpot.
export const TRIBUTE_PER_HOUR = 5;               // shards minted per hour held, per base
export const TRIBUTE_CAP_HOURS = 48;             // max uncollected accrual (2 days)

// Compute a holder's tribute owed for one held base, given when they last
// collected (or took it) and the moment of collection. Pure and cap-bounded.
export function tributeOwed(since: Date, now: Date = new Date()): number {
  const hours = Math.max(0, (now.getTime() - since.getTime()) / 3_600_000);
  return Math.floor(Math.min(hours, TRIBUTE_CAP_HOURS) * TRIBUTE_PER_HOUR);
}
