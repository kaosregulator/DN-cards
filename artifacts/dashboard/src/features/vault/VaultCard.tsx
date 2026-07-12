import { motion } from "framer-motion";
import { Zap, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SmartImage } from "@/features/media/SmartImage";
import { useCardViewer } from "@/features/viewer/viewer-context";
import { RARITY_BADGE, RARITY_BORDER, rarityKeyOf, rarityLabelOf } from "./rarity";
import { cn } from "@/lib/utils";
import type { Card } from "@/hooks/queries";

interface VaultCardProps {
  card: Card;
  /** The pool passed to the viewer so it can show related cards. */
  pool: Card[];
  /** Ownership state for the logged-in user. `undefined` = unknown (no overlay);
   *  `false` grayscales the tile as an "unowned" card. */
  owned?: boolean;
  count?: number;
  shinyCount?: number;
}

/** A single card tile in the vault grid. Click opens the full-screen viewer. */
export function VaultCard({ card, pool, owned, count, shinyCount = 0 }: VaultCardProps) {
  const { open } = useCardViewer();
  const rk = rarityKeyOf(card);
  const label = rarityLabelOf(card);
  const unowned = owned === false;

  return (
    <motion.button
      type="button"
      layout
      onClick={() => open(card, pool)}
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card text-left text-card-foreground transition-all duration-300 hover:-translate-y-1 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        RARITY_BORDER[rk],
        unowned && "opacity-70",
      )}
      data-testid={`vault-card-${card.id}`}
      aria-label={`${card.name} — ${label}${unowned ? " (unowned)" : ""}`}
    >
      {count !== undefined && count + shinyCount > 1 && (
        <div className="absolute -right-2 -top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow-lg">
          x{count + shinyCount}
        </div>
      )}
      {shinyCount > 0 && (
        <div className="absolute -left-2 -top-2 z-10 flex items-center gap-1 rounded-full bg-gradient-to-r from-pink-500 to-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg">
          <Sparkles className="h-3 w-3" />×{shinyCount}
        </div>
      )}
      {unowned && (
        <div className="absolute right-2 top-2 z-10 rounded bg-background/80 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground backdrop-blur">
          Unowned
        </div>
      )}

      <div className={cn("relative aspect-[3/4] w-full overflow-hidden bg-muted/50", unowned && "grayscale")}>
        <div className="h-full w-full transition-transform duration-500 group-hover:scale-110">
          <SmartImage src={card.imageUrl} alt={card.name} fit="cover" />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent opacity-80" />
        <div className="absolute left-2 top-2 flex flex-col gap-1">
          {card.isLimitedEdition && (
            <Badge variant="outline" className="border-primary/50 bg-background/80 font-mono text-[10px] uppercase tracking-wider text-primary backdrop-blur-sm">
              LTD {card.totalMinted}{card.maxCopies ? `/${card.maxCopies}` : ""}
            </Badge>
          )}
          {card.isEventExclusive && (
            <Badge variant="outline" className="border-destructive/50 bg-background/80 font-mono text-[10px] uppercase tracking-wider text-destructive backdrop-blur-sm">
              Event
            </Badge>
          )}
        </div>
      </div>

      <div className="relative z-10 -mt-12 flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-center justify-between">
          <Badge variant="outline" className={cn("font-mono text-[10px] uppercase tracking-widest", RARITY_BADGE[rk])}>{label}</Badge>
          <span className="font-mono text-xs uppercase text-muted-foreground">{card.cardType}</span>
        </div>
        <h3 className="mb-1 line-clamp-2 font-bold leading-tight tracking-wide">{card.name}</h3>
        <div className="mt-auto flex items-center justify-between pt-4 font-mono text-xs text-muted-foreground">
          <span className="flex items-center gap-1" title="Worth Value"><Zap className="h-3 w-3 text-primary" />{card.worthValue}</span>
          {card.dropChancePercent != null && card.droppable && card.inActiveSet && (
            <span className="opacity-80">{card.dropChancePercent.toFixed(2)}%</span>
          )}
        </div>
      </div>
    </motion.button>
  );
}
