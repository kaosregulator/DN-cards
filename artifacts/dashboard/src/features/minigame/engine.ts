/**
 * engine.ts — a tiny, self-contained card-clash game for Demo Mode.
 *
 * ZERO backend, ZERO login: everything runs client-side over a fixed pool of
 * preset demo cards. Its only job is to show off the vibe of the game and
 * funnel players into Discord. It never touches real cards, inventories, or
 * the API.
 *
 * Rules: best-of-5 clashes under a 60s clock. Each clash you play one card
 * from your hand; the AI plays one blind. Higher (power + type-counter bonus)
 * wins the clash point. Class triangle: Assault ▸ Recon ▸ Armor ▸ Assault.
 */

export type DemoClass = "assault" | "recon" | "armor";

export interface DemoCard {
  id: number;
  name: string;
  cls: DemoClass;
  power: number;
}

export const DEMO_DECK: DemoCard[] = [
  { id: 1, name: "Ash Vanguard", cls: "assault", power: 6 },
  { id: 2, name: "Nightjar Scout", cls: "recon", power: 5 },
  { id: 3, name: "Bulwark MK-II", cls: "armor", power: 7 },
  { id: 4, name: "Ember Raider", cls: "assault", power: 8 },
  { id: 5, name: "Ghost Signal", cls: "recon", power: 7 },
  { id: 6, name: "Iron Redoubt", cls: "armor", power: 5 },
  { id: 7, name: "Cinder Lance", cls: "assault", power: 4 },
  { id: 8, name: "Pale Recon", cls: "recon", power: 6 },
  { id: 9, name: "Aegis Wall", cls: "armor", power: 8 },
  { id: 10, name: "Havoc Trooper", cls: "assault", power: 7 },
  { id: 11, name: "Wisp Tracker", cls: "recon", power: 8 },
  { id: 12, name: "Titan Shell", cls: "armor", power: 6 },
];

export const CLASS_LABEL: Record<DemoClass, string> = {
  assault: "Assault",
  recon: "Recon",
  armor: "Armor",
};

const COUNTER_BONUS = 3;
export const MAX_CLASHES = 5;
export const MATCH_SECONDS = 60;
const HAND_SIZE = 3;

/** true when `a` counters `b` (Assault ▸ Recon ▸ Armor ▸ Assault). */
export function counters(a: DemoClass, b: DemoClass): boolean {
  return (
    (a === "assault" && b === "recon") ||
    (a === "recon" && b === "armor") ||
    (a === "armor" && b === "assault")
  );
}

export type Phase = "idle" | "choose" | "reveal" | "over";
export type ClashWinner = "player" | "ai" | "tie";

export interface ClashResult {
  player: DemoCard;
  ai: DemoCard;
  playerTotal: number;
  aiTotal: number;
  winner: ClashWinner;
}

export interface GameState {
  phase: Phase;
  clash: number; // 0-based clash index played so far
  timeLeft: number;
  drawPile: DemoCard[];
  hand: DemoCard[];
  aiPile: DemoCard[];
  playerScore: number;
  aiScore: number;
  last: ClashResult | null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newGame(): GameState {
  const shuffled = shuffle(DEMO_DECK);
  const hand = shuffled.slice(0, HAND_SIZE);
  const drawPile = shuffled.slice(HAND_SIZE);
  const aiPile = shuffle(DEMO_DECK);
  return {
    phase: "choose",
    clash: 0,
    timeLeft: MATCH_SECONDS,
    drawPile,
    hand,
    aiPile,
    playerScore: 0,
    aiScore: 0,
    last: null,
  };
}

function totalFor(card: DemoCard, vs: DemoCard): number {
  return card.power + (counters(card.cls, vs.cls) ? COUNTER_BONUS : 0);
}

/** AI picks blind: mostly its strongest card, sometimes a random one. */
function aiPick(state: GameState): { card: DemoCard; rest: DemoCard[] } {
  const pile = state.aiPile.length ? state.aiPile : shuffle(DEMO_DECK);
  const idx =
    Math.random() < 0.7
      ? pile.reduce((best, c, i, arr) => (c.power > arr[best].power ? i : best), 0)
      : Math.floor(Math.random() * pile.length);
  const card = pile[idx];
  return { card, rest: pile.filter((_, i) => i !== idx) };
}

/** Resolve the clash where the player committed `card`. */
export function playCard(state: GameState, card: DemoCard): GameState {
  if (state.phase !== "choose") return state;
  const { card: ai, rest: aiPile } = aiPick(state);
  const playerTotal = totalFor(card, ai);
  const aiTotal = totalFor(ai, card);
  const winner: ClashWinner = playerTotal === aiTotal ? "tie" : playerTotal > aiTotal ? "player" : "ai";

  return {
    ...state,
    phase: "reveal",
    aiPile,
    hand: state.hand.filter((c) => c.id !== card.id),
    playerScore: state.playerScore + (winner === "player" ? 1 : 0),
    aiScore: state.aiScore + (winner === "ai" ? 1 : 0),
    last: { player: card, ai, playerTotal, aiTotal, winner },
  };
}

/** Advance from a reveal to the next clash, or end the match. */
export function nextClash(state: GameState): GameState {
  if (state.phase !== "reveal") return state;
  const clash = state.clash + 1;
  if (clash >= MAX_CLASHES || state.timeLeft <= 0) {
    return { ...state, phase: "over", clash };
  }
  // Refill hand from draw pile (reshuffle discards back in if empty).
  let drawPile = state.drawPile;
  let hand = state.hand;
  if (hand.length < HAND_SIZE) {
    if (drawPile.length === 0) drawPile = shuffle(DEMO_DECK);
    hand = [...hand, drawPile[0]];
    drawPile = drawPile.slice(1);
  }
  return { ...state, phase: "choose", clash, drawPile, hand };
}

/** One-second tick. Ends the match if the clock runs out. */
export function tick(state: GameState): GameState {
  if (state.phase === "over" || state.phase === "idle") return state;
  const timeLeft = Math.max(0, state.timeLeft - 1);
  if (timeLeft === 0) return { ...state, timeLeft, phase: "over" };
  return { ...state, timeLeft };
}

export function outcome(state: GameState): "win" | "lose" | "draw" {
  if (state.playerScore > state.aiScore) return "win";
  if (state.playerScore < state.aiScore) return "lose";
  return "draw";
}
