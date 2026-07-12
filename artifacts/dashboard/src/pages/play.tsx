import { useEffect, useMemo, useReducer } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Swords, Eye, Shield, Timer, Trophy, Zap, Play as PlayIcon, RotateCcw, ArrowRight } from "lucide-react";
import { useSiteConfig } from "@/hooks/queries";
import { resolvePresentation, type PresentationConfig } from "@/features/site/defaults";
import {
  newGame, playCard, nextClash, tick, outcome,
  CLASS_LABEL, MAX_CLASHES,
  type GameState, type DemoCard, type DemoClass,
} from "@/features/minigame/engine";
import { cn } from "@/lib/utils";

type Action =
  | { t: "start" }
  | { t: "play"; card: DemoCard }
  | { t: "next" }
  | { t: "tick" }
  | { t: "reset" };

const initial: GameState = { ...newGame(), phase: "idle" };

function reducer(state: GameState, action: Action): GameState {
  switch (action.t) {
    case "start": return newGame();
    case "play": return playCard(state, action.card);
    case "next": return nextClash(state);
    case "tick": return tick(state);
    case "reset": return { ...newGame(), phase: "idle" };
  }
}

const CLASS_ICON: Record<DemoClass, React.ReactNode> = {
  assault: <Swords className="h-4 w-4" />,
  recon: <Eye className="h-4 w-4" />,
  armor: <Shield className="h-4 w-4" />,
};

const CLASS_TINT: Record<DemoClass, string> = {
  assault: "from-red-500/20 to-orange-500/10 border-red-500/40 text-red-300",
  recon: "from-emerald-500/20 to-teal-500/10 border-emerald-500/40 text-emerald-300",
  armor: "from-sky-500/20 to-indigo-500/10 border-sky-500/40 text-sky-300",
};

export default function Play() {
  const [state, dispatch] = useReducer(reducer, initial);
  const { data: siteConfig } = useSiteConfig();
  const presentation = useMemo<PresentationConfig>(
    () => resolvePresentation(siteConfig?.presentation as Partial<PresentationConfig> | null),
    [siteConfig],
  );

  // 1s match clock — only while actively playing.
  useEffect(() => {
    if (state.phase !== "choose" && state.phase !== "reveal") return;
    const id = setInterval(() => dispatch({ t: "tick" }), 1000);
    return () => clearInterval(id);
  }, [state.phase]);

  return (
    <div className="bg-tactical-pattern min-h-screen">
      <div className="container max-w-4xl px-4 py-10 md:px-8">
        <header className="mb-8 text-center">
          <span className="inline-block rounded-md border border-primary/40 px-3 py-1 font-mono text-xs uppercase tracking-[0.3em] text-primary">
            Demo Mode · No login
          </span>
          <h1 className="mt-4 text-4xl font-bold uppercase tracking-tight">Skirmish</h1>
          <p className="mt-2 font-mono text-sm uppercase tracking-widest text-muted-foreground">
            Best of {MAX_CLASHES} clashes · 60 seconds · you vs the AI
          </p>
        </header>

        <AnimatePresence mode="wait">
          {state.phase === "idle" && <Intro key="intro" onStart={() => dispatch({ t: "start" })} />}
          {(state.phase === "choose" || state.phase === "reveal") && (
            <Board
              key="board"
              state={state}
              onPlay={(c) => dispatch({ t: "play", card: c })}
              onNext={() => dispatch({ t: "next" })}
            />
          )}
          {state.phase === "over" && (
            <GameOver
              key="over"
              state={state}
              inviteUrl={presentation.discordInviteUrl}
              onReplay={() => dispatch({ t: "start" })}
              onReset={() => dispatch({ t: "reset" })}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-border/50 bg-card/50 p-8 text-center">
      <p className="mx-auto mb-6 max-w-md leading-relaxed text-muted-foreground">
        Play a card each clash. Higher power wins — but class beats class:
        <span className="mt-4 flex items-center justify-center gap-3 font-mono text-sm uppercase tracking-widest text-foreground">
          <span className="text-red-300">Assault</span> ▸ <span className="text-emerald-300">Recon</span> ▸ <span className="text-sky-300">Armor</span> ▸ <span className="text-red-300">Assault</span>
        </span>
        <span className="mt-3 block text-xs">Countering your opponent's class adds +3 power.</span>
      </p>
      <button
        onClick={onStart}
        className="mx-auto flex items-center gap-2 rounded-lg bg-primary px-8 py-4 font-mono text-sm font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:scale-105"
        data-testid="play-start"
      >
        <PlayIcon className="h-5 w-5" /> Start Skirmish
      </button>
    </motion.div>
  );
}

function Board({ state, onPlay, onNext }: { state: GameState; onPlay: (c: DemoCard) => void; onNext: () => void }) {
  const low = state.timeLeft <= 10;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {/* Status bar */}
      <div className="mb-6 flex items-center justify-between rounded-xl border border-border/50 bg-card/50 p-4">
        <Score label="You" value={state.playerScore} highlight />
        <div className="flex flex-col items-center">
          <div className={cn("flex items-center gap-2 font-mono text-2xl font-bold", low ? "text-destructive" : "text-foreground")}>
            <Timer className="h-5 w-5" /> {state.timeLeft}s
          </div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Clash {Math.min(state.clash + 1, MAX_CLASHES)} / {MAX_CLASHES}
          </div>
        </div>
        <Score label="AI" value={state.aiScore} />
      </div>

      {/* Reveal area */}
      <div className="mb-6 min-h-[13rem]">
        <AnimatePresence mode="wait">
          {state.phase === "reveal" && state.last ? (
            <motion.div key={state.clash} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-xl border border-border/50 bg-card/40 p-5">
              <div className="flex items-center justify-center gap-4 sm:gap-8">
                <GameCard card={state.last.player} total={state.last.playerTotal} won={state.last.winner === "player"} />
                <div className="font-mono text-2xl font-bold text-muted-foreground">VS</div>
                <GameCard card={state.last.ai} total={state.last.aiTotal} won={state.last.winner === "ai"} />
              </div>
              <div className="mt-5 text-center">
                <p className={cn("font-mono text-lg font-bold uppercase tracking-widest", state.last.winner === "player" ? "text-primary" : state.last.winner === "ai" ? "text-destructive" : "text-muted-foreground")}>
                  {state.last.winner === "player" ? "Clash won" : state.last.winner === "ai" ? "Clash lost" : "Stalemate"}
                </p>
                <button onClick={onNext} className="mx-auto mt-3 flex items-center gap-2 rounded-lg border border-border bg-background/50 px-6 py-2.5 font-mono text-xs font-bold uppercase tracking-widest hover:bg-muted" data-testid="play-next">
                  {state.clash + 1 >= MAX_CLASHES ? "See result" : "Next clash"} <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="prompt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-[13rem] items-center justify-center font-mono text-sm uppercase tracking-widest text-muted-foreground">
              Choose a card to deploy
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Hand */}
      <div className="flex flex-wrap justify-center gap-3">
        {state.hand.map((card) => (
          <button
            key={card.id}
            onClick={() => onPlay(card)}
            disabled={state.phase !== "choose"}
            className="disabled:cursor-not-allowed disabled:opacity-40"
            data-testid={`play-hand-${card.id}`}
          >
            <GameCard card={card} interactive />
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function GameCard({ card, total, won, interactive }: { card: DemoCard; total?: number; won?: boolean; interactive?: boolean }) {
  return (
    <motion.div
      whileHover={interactive ? { y: -6 } : undefined}
      className={cn(
        "flex w-28 flex-col justify-between rounded-xl border bg-gradient-to-br p-3 text-left shadow-lg transition-all",
        CLASS_TINT[card.cls],
        won && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider">{CLASS_ICON[card.cls]}{CLASS_LABEL[card.cls]}</span>
      </div>
      <div className="my-3 text-sm font-bold uppercase leading-tight text-foreground">{card.name}</div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 font-mono text-lg font-bold text-foreground"><Zap className="h-4 w-4 text-primary" />{card.power}</span>
        {total !== undefined && total !== card.power && (
          <span className="font-mono text-xs font-bold text-primary">→{total}</span>
        )}
      </div>
    </motion.div>
  );
}

function Score({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="text-center">
      <div className={cn("font-mono text-3xl font-bold", highlight ? "text-primary" : "text-foreground")}>{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function GameOver({ state, inviteUrl, onReplay, onReset }: { state: GameState; inviteUrl: string; onReplay: () => void; onReset: () => void }) {
  const result = outcome(state);
  const headline = result === "win" ? "Victory" : result === "lose" ? "Defeated" : "Draw";
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="rounded-2xl border border-border/50 bg-card/60 p-8 text-center">
      <Trophy className={cn("mx-auto mb-4 h-14 w-14", result === "win" ? "text-[hsl(var(--rarity-legendary))]" : "text-muted-foreground")} />
      <h2 className="text-4xl font-bold uppercase tracking-wide">{headline}</h2>
      <p className="mt-2 font-mono text-sm uppercase tracking-widest text-muted-foreground">
        You {state.playerScore} · {state.aiScore} AI
      </p>

      {/* The funnel — the whole point of Demo Mode. */}
      <div className="mx-auto mt-8 max-w-md rounded-xl border border-primary/40 bg-gradient-to-br from-primary/10 to-transparent p-6">
        <p className="mb-4 text-lg font-bold uppercase leading-snug">Claim your starter deck inside our official Discord Server!</p>
        <a
          href={inviteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-auto flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-8 py-4 font-mono text-sm font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:scale-[1.03]"
          data-testid="play-cta-discord"
        >
          Join the Discord <ArrowRight className="h-4 w-4" />
        </a>
      </div>

      <div className="mt-6 flex justify-center gap-3">
        <button onClick={onReplay} className="flex items-center gap-2 rounded-lg border border-border bg-background/50 px-6 py-2.5 font-mono text-xs font-bold uppercase tracking-widest hover:bg-muted" data-testid="play-replay">
          <RotateCcw className="h-4 w-4" /> Play again
        </button>
        <button onClick={onReset} className="rounded-lg px-6 py-2.5 font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">
          Back
        </button>
      </div>
    </motion.div>
  );
}
