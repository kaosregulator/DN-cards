import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Zap, AlertCircle, Target, Sparkles, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SmartImage } from "@/features/media/SmartImage";
import { usePrefersReducedMotion } from "@/features/media/hooks";
import { RARITY_BADGE, RARITY_STAGE_BG, rarityKeyOf, rarityLabelOf } from "@/features/vault/rarity";
import { useCardViewer } from "./viewer-context";
import type { Card } from "@/hooks/queries";

const SHINY_MULTIPLIER = 2;

/**
 * Immersive full-screen card viewer. Mounted once at the app root; opens
 * whenever `useCardViewer().open(card, pool)` is called. Closes on the exit
 * button, the Esc key, or a backdrop click. Surfaces related cards in the
 * same set so users can hop between them without leaving the overlay.
 */
export function CardViewer() {
  const { card, pool, open, close } = useCardViewer();
  const reduced = usePrefersReducedMotion();

  // Esc-to-close + lock body scroll while open.
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [card, close]);

  return (
    <AnimatePresence>
      {card && (
        <ViewerContent
          key={card.id}
          card={card}
          pool={pool}
          reduced={reduced}
          onClose={close}
          onPick={(next) => open(next, pool)}
        />
      )}
    </AnimatePresence>
  );
}

function ViewerContent({
  card,
  pool,
  reduced,
  onClose,
  onPick,
}: {
  card: Card;
  pool: Card[];
  reduced: boolean;
  onClose: () => void;
  onPick: (c: Card) => void;
}) {
  const rk = rarityKeyOf(card);
  const label = rarityLabelOf(card);
  const setIds = new Set((card.sets ?? []).map((s) => s.id));
  const related = pool
    .filter((c) => c.id !== card.id && (c.sets ?? []).some((s) => setIds.has(s.id)))
    .slice(0, 12);

  const anim = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, scale: 0.94, y: 24 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.96, y: 24 },
        transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const },
      };

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
      aria-label={`${card.name} — ${label}`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/85 backdrop-blur-xl" onClick={onClose} />

      {/* Exit button */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close card viewer"
        className="absolute right-4 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-background/70 text-foreground/80 backdrop-blur transition-colors hover:bg-background hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="viewer-close"
      >
        <X className="h-5 w-5" />
      </button>

      <motion.div
        {...anim}
        className="relative z-10 flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/90 shadow-2xl md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: hero stage with rarity holo effect */}
        <div
          className="relative flex w-full items-center justify-center overflow-hidden p-6 md:w-1/2 md:p-10"
          style={{ backgroundImage: card.previewBgColor ? undefined : RARITY_STAGE_BG[rk], background: card.previewBgColor ?? undefined }}
        >
          {!reduced && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{ backgroundImage: RARITY_STAGE_BG[rk] }}
            />
          )}
          <motion.div
            className={`relative w-full max-w-[22rem] overflow-hidden rounded-xl border-2 ${rk === "legendary" || rk === "mythic" ? "rarity-glow-legendary" : ""}`}
            style={{ aspectRatio: card.displayOrientation === "landscape" ? "4 / 3" : "3 / 4" }}
            initial={reduced ? undefined : { rotateY: -12, opacity: 0 }}
            animate={reduced ? undefined : { rotateY: 0, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <SmartImage src={card.imageUrl} alt={card.name} fit="contain" priority />
          </motion.div>
        </div>

        {/* Right: details (scrollable) */}
        <div className="flex w-full flex-col overflow-y-auto p-6 md:w-1/2 md:p-8">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge className={`font-mono text-xs uppercase tracking-widest ${RARITY_BADGE[rk]}`}>{label}</Badge>
            <Badge variant="outline" className="font-mono text-xs uppercase tracking-widest">{card.cardType}</Badge>
            {card.isLimitedEdition && (
              <Badge variant="outline" className="border-primary/50 font-mono text-xs uppercase tracking-widest text-primary">
                LE {card.totalMinted}{card.maxCopies ? `/${card.maxCopies}` : ""}
              </Badge>
            )}
            {card.isEventExclusive && (
              <Badge variant="outline" className="border-destructive/50 font-mono text-xs uppercase tracking-widest text-destructive">Event</Badge>
            )}
          </div>

          <h2 className="mb-1 text-3xl font-bold uppercase tracking-wide">{card.name}</h2>
          {card.sets && card.sets.length > 0 && (
            <p className="mb-4 font-mono text-sm uppercase tracking-widest text-primary">{card.sets.map((s) => s.name).join(" · ")}</p>
          )}

          {card.description && <p className="mb-4 leading-relaxed text-muted-foreground">{card.description}</p>}
          {card.flavor && (
            <div className="mb-6 border-l-2 border-primary/50 py-1 pl-4">
              <p className="font-serif italic leading-relaxed text-foreground/80">"{card.flavor}"</p>
            </div>
          )}

          <div className="mb-6 grid grid-cols-2 gap-3 rounded-xl border border-border/40 bg-background/50 p-4">
            <Stat icon={<Zap className="h-4 w-4 text-primary" />} label="Worth" value={card.worthValue.toLocaleString()} />
            <Stat icon={<AlertCircle className="h-4 w-4 text-destructive" />} label="Burn" value={card.burnValue.toLocaleString()} />
            {card.dropChancePercent != null && card.droppable && (
              <Stat icon={<Target className="h-4 w-4 text-muted-foreground" />} label="Drop Chance" value={`~${card.dropChancePercent.toFixed(2)}%`} />
            )}
            <Stat
              icon={<Sparkles className="h-4 w-4 text-pink-300" />}
              label="Shiny Worth"
              value={(card.worthValue * SHINY_MULTIPLIER).toLocaleString()}
            />
          </div>

          {related.length > 0 && (
            <div className="mt-auto">
              <div className="mb-3 flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                <Layers className="h-4 w-4" /> Related in set
              </div>
              <div className="flex flex-wrap gap-2">
                {related.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onPick(c)}
                    title={c.name}
                    className="h-16 w-12 shrink-0 overflow-hidden rounded-md border border-border/50 transition-transform hover:-translate-y-0.5 hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid={`viewer-related-${c.id}`}
                  >
                    <SmartImage src={c.imageUrl} alt={c.name} fit="cover" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-between border-t border-border/30 pt-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>ID {card.id.toString().padStart(4, "0")}</span>
            <span>Updated {new Date(card.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 font-mono text-lg font-medium">{icon}{value}</span>
    </div>
  );
}
