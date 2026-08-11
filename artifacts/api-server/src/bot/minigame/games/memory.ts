// 🃏 Memory Match (mockup mg8) — a TRUE memory game with real card flips. A grid
// of facedown cards hides pairs made from your actual card art (the caught card
// + decoys from the guild pool). Flip two at a time; match every pair to claim.
import { ButtonStyle } from "discord.js";
import type { MiniGameDefinition, MiniGameSession, MiniGameOutcome, MiniGameRender } from "../types.js";
import { buildRows, winScreen, loseScreen, type ButtonSpec } from "./shared.js";
import { renderMemoryBoard, MG_MEMORY_FILE, type MemoryCell } from "../canvas.js";

const THEME = 0x8b5cf6;

interface Cell { pairId: number; artUrl: string | null; color: number; state: "down" | "up" | "matched"; }
interface MemState { cells: Cell[]; revealed: number[]; matchedPairs: number; totalPairs: number; moves: number; maxMoves: number; cols: number; }

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function setup(session: MiniGameSession): MemState {
  // Pair cards: the caught card + decoys that have art. Up to 3 pairs (6 cells).
  const decoys = session.decoyArt.filter(d => d.url);
  const pairCards: { url: string | null; color: number }[] = [
    { url: session.cardArtUrl, color: session.rarityColor },
  ];
  for (const d of shuffle([...decoys]).slice(0, 2)) pairCards.push({ url: d.url, color: THEME });
  const totalPairs = pairCards.length;

  const cells: Cell[] = [];
  pairCards.forEach((c, pairId) => {
    cells.push({ pairId, artUrl: c.url, color: c.color, state: "down" });
    cells.push({ pairId, artUrl: c.url, color: c.color, state: "down" });
  });
  shuffle(cells);
  return {
    cells, revealed: [], matchedPairs: 0, totalPairs,
    moves: 0, maxMoves: totalPairs + 3,
    cols: cells.length <= 4 ? cells.length : 3,
  };
}

async function renderBoard(session: MiniGameSession, st: MemState, note: string): Promise<MiniGameRender> {
  const memCells: MemoryCell[] = st.cells.map(c => ({ state: c.state, artUrl: c.artUrl, rarityColor: c.color }));
  const image = await renderMemoryBoard({
    theme: THEME,
    title: "CARD FIELD ACTIVE",
    subtitle: `Match the pairs to claim · Moves left: ${st.maxMoves - st.moves}`,
    cols: st.cols,
    cells: memCells,
  });
  const buttons: ButtonSpec[] = st.cells.map((c, i) => ({
    action: `flip:${i}`,
    label: String(i + 1),
    style: c.state === "matched" ? ButtonStyle.Success : ButtonStyle.Secondary,
    disabled: c.state === "matched",
  }));
  return {
    title: "🃏 CARD FIELD ACTIVE",
    description:
      `Select two cards to flip them. **Match the card pair to claim.**\n` +
      `Pairs matched: **${st.matchedPairs}/${st.totalPairs}** · Moves left: **${st.maxMoves - st.moves}**` +
      (note ? `\n${note}` : ""),
    color: THEME,
    image,
    imageName: MG_MEMORY_FILE,
    components: buildRows(session, buttons),
  };
}

export const memoryGame: MiniGameDefinition = {
  key: "memory",
  name: "Memory Match",
  blurb: "Flip real cards two at a time — match every pair to claim.",
  timeoutMs: 30000,

  async start(session: MiniGameSession): Promise<MiniGameRender> {
    const st = setup(session);
    session.state.mem = st;
    return renderBoard(session, st, "");
  },

  async handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> {
    const st = session.state.mem as MemState;
    if (!action.startsWith("flip:")) return { done: false, render: await renderBoard(session, st, "") };
    const i = Number(action.split(":")[1]);
    const cell = st.cells[i];
    if (!cell || cell.state === "matched" || st.revealed.includes(i)) {
      return { done: false, render: await renderBoard(session, st, "") };
    }

    // If a mismatched pair is currently shown, clear it before this new flip.
    if (st.revealed.length === 2) {
      for (const r of st.revealed) if (st.cells[r]!.state === "up") st.cells[r]!.state = "down";
      st.revealed = [];
    }

    cell.state = "up";
    st.revealed.push(i);

    if (st.revealed.length < 2) {
      return { done: false, render: await renderBoard(session, st, "Pick one more card…") };
    }

    // Second flip — resolve the pair.
    st.moves++;
    const [a, b] = st.revealed;
    const ca = st.cells[a!]!, cb = st.cells[b!]!;
    if (ca.pairId === cb.pairId) {
      ca.state = "matched"; cb.state = "matched";
      st.revealed = [];
      st.matchedPairs++;
      if (st.matchedPairs >= st.totalPairs) {
        return { done: true, win: true, render: await winScreen(session, "Every pair matched — the card is secured!") };
      }
      return { done: false, render: await renderBoard(session, st, "✅ Match! Keep going.") };
    }
    // Mismatch — leave both shown so the player sees them.
    if (st.moves >= st.maxMoves) {
      return { done: true, win: false, render: await loseScreen(session, "Out of moves — the card slipped away.") };
    }
    return { done: false, render: await renderBoard(session, st, "❌ No match — pick again to continue.") };
  },

  onTimeout(session: MiniGameSession): Promise<MiniGameRender> {
    return loseScreen(session, "You took too long at the card field — it emptied out.");
  },
};
