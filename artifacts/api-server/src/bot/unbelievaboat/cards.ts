// Shared playing-card helpers for blackjack / higher-lower / red-or-black.

export type Suit = "♠" | "♥" | "♦" | "♣";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

export type Card = { rank: Rank; suit: Suit };

const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];

export function freshDeck(): Card[] {
  const d: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) d.push({ rank, suit });
  // Fisher–Yates
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  return d;
}

export function draw(deck: Card[]): Card {
  const c = deck.pop();
  if (!c) throw new Error("Deck empty");
  return c;
}

export function cardLabel(c: Card): string {
  return `${c.rank}${c.suit}`;
}

export function isRed(c: Card): boolean {
  return c.suit === "♥" || c.suit === "♦";
}

export function rankValue(c: Card): number {
  if (c.rank === "A") return 14;
  if (c.rank === "K") return 13;
  if (c.rank === "Q") return 12;
  if (c.rank === "J") return 11;
  return Number(c.rank);
}

/** Blackjack hand total — soft aces. */
export function handTotal(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === "A") { aces++; total += 11; }
    else if (c.rank === "K" || c.rank === "Q" || c.rank === "J") total += 10;
    else total += Number(c.rank);
  }
  let soft = aces > 0;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
    soft = aces > 0 && total <= 21;
  }
  if (total > 21) soft = false;
  return { total, soft };
}

export function isNaturalBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handTotal(cards).total === 21;
}

export function formatHand(cards: Card[], hideSecond = false): string {
  if (hideSecond && cards.length >= 2) {
    return `${cardLabel(cards[0]!)} · 🂠`;
  }
  return cards.map(cardLabel).join(" · ");
}
