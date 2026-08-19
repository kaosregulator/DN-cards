import { describe, it, expect, afterEach } from "vitest";
import { createDuel, boardOf } from "../engine";
import { applyAction, isDuelAction, type DuelAction } from "../actions";
import { enrichSetup } from "../cards";
import { setSeed, resetRng } from "../rng";
import { monster } from "./helpers";
import type { DuelCard, DuelSetup, DuelState, PlayerId } from "../types";

afterEach(() => resetRng());

function deck(tag: string): DuelCard[] {
  return Array.from({ length: 22 }, (_, i) => ({ ...monster(`${tag}${i}`, 700 + i * 80), cardId: (tag === "A" ? 1000 : 2000) + i }));
}
function setup(): DuelSetup {
  return { startingLp: 8000, handSize: 5, player: { name: "Alice", deck: deck("A") }, opponent: { name: "Bob", deck: deck("B") } };
}

/** Full serialisable snapshot of a duel — if two clients agree on this, their
 *  boards are identical. */
function snapshot(s: DuelState): string {
  const side = (id: PlayerId) => {
    const b = boardOf(s, id);
    const mon = (m: (typeof b.monsters)[number]) => m ? `${m.card.uid}:${m.position}:${m.faceUp ? "u" : "d"}:${m.card.atk + m.atkMod}` : "-";
    const st = (x: (typeof b.spellTraps)[number]) => x ? `${x.card.uid}:${x.faceUp ? "u" : "d"}` : "-";
    return [
      `lp=${b.lp}`, `hand=${b.hand.map((c) => c.uid).join(",")}`,
      `deck=${b.deck.length}`, `gy=${b.graveyard.map((c) => c.uid).join(",")}`,
      `mon=${b.monsters.map(mon).join(",")}`, `st=${b.spellTraps.map(st).join(",")}`,
    ].join("|");
  };
  return `T${s.turnCount}:${s.turn}:${s.phase}:win=${s.winner ?? "-"}::${side("player")}::${side("opponent")}`;
}

/**
 * Two independent "clients", A and B, built from the SAME setup + seed. Every
 * action is applied on BOTH: A applies it as its local side, then relays it and
 * B applies it as the same absolute side. Their snapshots must match after
 * every single move — that's lockstep.
 */
describe("lockstep replay across two clients", () => {
  it("stays byte-identical while both replay the same action stream", () => {
    const shared = setup();
    setSeed(555); const a = createDuel(enrichSetup(shared), 555);
    setSeed(555); const b = createDuel(enrichSetup(shared), 555);
    expect(snapshot(a)).toBe(snapshot(b));

    // A scripted but varied sequence covering summon, position, phases, attack,
    // set, and passing the turn — driven from "player" then "opponent".
    const relay = (who: PlayerId, action: DuelAction) => {
      expect(isDuelAction(action)).toBe(true);
      applyAction(a, who, action);           // client A performs
      applyAction(b, who, action);           // client B replays the relayed move
      expect(snapshot(a), `desync after ${who} ${action.k}`).toBe(snapshot(b));
    };

    // Player 1's turn.
    relay("player", { k: "summon", handIndex: 0, position: "attack", tributeZones: [] });
    relay("player", { k: "phase" });          // → BATTLE
    relay("player", { k: "attack", fromZone: boardOf(a, "player").monsters.findIndex((m) => m), target: "direct" });
    relay("player", { k: "endTurn" });
    // Player 2's turn.
    relay("opponent", { k: "summon", handIndex: 0, position: "set", tributeZones: [] });
    relay("opponent", { k: "endTurn" });
    // Back to Player 1 — draw already happened identically on both.
    relay("player", { k: "summon", handIndex: 0, position: "attack", tributeZones: [] });
    relay("player", { k: "endTurn" });

    expect(snapshot(a)).toBe(snapshot(b));
    expect(a.turnCount).toBeGreaterThan(3);
  });

  it("a long randomised game never desyncs", () => {
    const shared = setup();
    setSeed(24680); const a = createDuel(enrichSetup(shared), 24680);
    setSeed(24680); const b = createDuel(enrichSetup(shared), 24680);

    // A tiny deterministic "player" that both clients would run identically.
    const step = (s: DuelState): DuelAction => {
      const me = s.turn;
      const bd = boardOf(s, me);
      if (s.phase === "MAIN1") {
        const idx = bd.hand.findIndex((c) => c.kind === "monster" && c.level <= 4);
        if (idx >= 0 && !bd.hasNormalSummoned && bd.monsters.some((m) => m === null)) {
          return { k: "summon", handIndex: idx, position: "attack", tributeZones: [] };
        }
        return { k: "phase" };
      }
      if (s.phase === "BATTLE") {
        const z = bd.monsters.findIndex((m) => m && m.faceUp && m.position === "attack" && m.hasAttacked === 0);
        const foe = boardOf(s, me === "player" ? "opponent" : "player");
        if (z >= 0) return { k: "attack", fromZone: z, target: foe.monsters.some((m) => m) ? foe.monsters.findIndex((m) => m) : "direct" };
        return { k: "endTurn" };
      }
      return { k: "phase" };
    };

    let guard = 0;
    while (!a.winner && guard++ < 400) {
      const action = step(a);            // decided from A's state (== B's state)
      applyAction(a, a.turn, action);
      applyAction(b, b.turn, action);
      expect(snapshot(a), `desync at step ${guard}`).toBe(snapshot(b));
    }
    expect(a.winner).toBe(b.winner);
  });

  it("rejects malformed actions before they reach the engine", () => {
    expect(isDuelAction({ k: "summon", handIndex: 0, position: "attack", tributeZones: [] })).toBe(true);
    expect(isDuelAction({ k: "attack", fromZone: 0, target: "direct" })).toBe(true);
    expect(isDuelAction({ k: "attack", fromZone: 0, target: 3 })).toBe(true);
    expect(isDuelAction({ k: "phase" })).toBe(true);
    expect(isDuelAction({ k: "summon", handIndex: "x", position: "attack", tributeZones: [] })).toBe(false);
    expect(isDuelAction({ k: "summon", handIndex: 0, position: "sideways", tributeZones: [] })).toBe(false);
    expect(isDuelAction({ k: "attack", fromZone: 0, target: "everywhere" })).toBe(false);
    expect(isDuelAction({ k: "unknown" })).toBe(false);
    expect(isDuelAction(null)).toBe(false);
    expect(isDuelAction("nope")).toBe(false);
  });
});
