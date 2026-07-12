import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, SkipForward } from "lucide-react";
import { SmartImage } from "@/features/media/SmartImage";
import { usePrefersReducedMotion } from "@/features/media/hooks";
import { RARITY_ACCENT, RARITY_BADGE, rarityKeyOf, categoryKeyOf } from "@/features/vault/rarity";
import type { Card, Rarity } from "@/hooks/queries";

const DEFAULT_RARITY_ORDER: Rarity[] = ["mythic", "legendary", "epic", "rare", "uncommon", "common"];

interface Tier {
  key: string;
  label: string;
  card: Card;
}

/** Pick a hero card to represent each rarity tier, cycling LOW → HIGH so the
 *  splash climbs the ladder (Common → … → Mythical). Prefers featured cards,
 *  then the highest-worth card with real art. */
function buildTiers(cards: Card[], rarityOrder: Rarity[] | null | undefined): Tier[] {
  const order = rarityOrder ?? DEFAULT_RARITY_ORDER;
  // rank: higher = rarer. We iterate ascending (low rank first).
  const rank = new Map<string, number>();
  order.forEach((k, i) => rank.set(k, order.length - i));

  const byTier = new Map<string, { label: string; cards: Card[] }>();
  for (const c of cards) {
    if (c.isArchived) continue;
    const key = categoryKeyOf(c);
    const label = c.websiteCategoryLabel ?? c.effectiveRarityLabel ?? c.rarity;
    if (!byTier.has(key)) byTier.set(key, { label, cards: [] });
    byTier.get(key)!.cards.push(c);
  }

  const tiers: Tier[] = [];
  for (const [key, group] of byTier) {
    const withArt = group.cards.filter((c) => c.imageUrl);
    const candidates = withArt.length ? withArt : group.cards;
    const hero =
      candidates.find((c) => c.featured) ??
      [...candidates].sort((a, b) => b.worthValue - a.worthValue)[0];
    if (hero) tiers.push({ key, label: group.label, card: hero });
  }
  // Ascending by rarity rank; unknown/custom tiers (rank undefined) sort first.
  return tiers.sort((a, b) => (rank.get(a.key) ?? -1) - (rank.get(b.key) ?? -1));
}

interface SplashScreenProps {
  cards: Card[];
  rarityOrder: Rarity[] | null | undefined;
  tierDurationMs?: number;
  onDone: () => void;
}

/**
 * Cinematic intro: cards animate in tier by tier, climbing the rarity ladder.
 * Auto-advances on a timer; any click/tap/swipe or the Skip button ends it.
 */
export function SplashScreen({ cards, rarityOrder, tierDurationMs = 2600, onDone }: SplashScreenProps) {
  const reduced = usePrefersReducedMotion();
  const tiers = useMemo(() => buildTiers(cards, rarityOrder), [cards, rarityOrder]);
  const [index, setIndex] = useState(0);
  const doneRef = useRef(false);
  const touchStartX = useRef<number | null>(null);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  // Auto-advance through tiers, then finish. Reduced motion shortens dwell.
  useEffect(() => {
    if (tiers.length === 0) {
      finish();
      return;
    }
    const dwell = reduced ? 900 : tierDurationMs;
    const t = setTimeout(() => {
      if (index >= tiers.length - 1) finish();
      else setIndex((i) => i + 1);
    }, dwell);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, tiers.length, reduced, tierDurationMs]);

  if (tiers.length === 0) return null;
  const tier = tiers[Math.min(index, tiers.length - 1)];
  const rk = rarityKeyOf(tier.card);
  const accent = RARITY_ACCENT[rk];

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex select-none flex-col items-center justify-center overflow-hidden bg-background"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={finish}
      onTouchStart={(e) => (touchStartX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const start = touchStartX.current;
        const end = e.changedTouches[0]?.clientX ?? null;
        if (start != null && end != null && Math.abs(end - start) > 40) finish();
      }}
      role="dialog"
      aria-label="Intro"
      data-testid="splash-screen"
    >
      {/* Ambient rarity glow */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        animate={{ background: `radial-gradient(ellipse at center, ${accent}22, rgba(0,0,0,0) 65%)` }}
        transition={{ duration: 0.8 }}
      />
      <div className="bg-tactical-pattern pointer-events-none absolute inset-0 opacity-40" />

      <AnimatePresence mode="wait">
        <motion.div
          key={tier.key}
          className="relative flex flex-col items-center gap-6 px-6"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 60, scale: 0.92 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -60, scale: 0.96 }}
          transition={{ duration: reduced ? 0.2 : 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div
            className="relative w-56 overflow-hidden rounded-2xl border-2 shadow-2xl sm:w-64"
            style={{ aspectRatio: tier.card.displayOrientation === "landscape" ? "4 / 3" : "3 / 4", borderColor: accent, boxShadow: `0 0 40px -8px ${accent}` }}
          >
            <SmartImage src={tier.card.imageUrl} alt={tier.card.name} fit="cover" priority />
          </div>

          <div className="text-center">
            <span
              className={`inline-block rounded-md border px-3 py-1 font-mono text-xs uppercase tracking-[0.3em] ${RARITY_BADGE[rk]}`}
            >
              {tier.label}
            </span>
            <h2 className="mt-4 text-3xl font-bold uppercase tracking-wide sm:text-4xl">{tier.card.name}</h2>
            {tier.card.sets && tier.card.sets.length > 0 && (
              <p className="mt-1 font-mono text-sm uppercase tracking-widest text-primary">
                {tier.card.sets.map((s) => s.name).join(" · ")}
              </p>
            )}
            <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Updated {new Date(tier.card.createdAt).toLocaleDateString()}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Progress ladder */}
      <div className="absolute bottom-24 flex items-center gap-2">
        {tiers.map((t, i) => (
          <span
            key={t.key}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{
              width: i === index ? 28 : 10,
              background: i <= index ? RARITY_ACCENT[rarityKeyOf(t.card)] : "hsl(var(--muted))",
            }}
          />
        ))}
      </div>

      {/* Skip */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          finish();
        }}
        className="absolute bottom-8 right-8 flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-5 py-2.5 font-mono text-xs uppercase tracking-widest text-foreground/80 backdrop-blur transition-colors hover:bg-background hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="splash-skip"
      >
        <SkipForward className="h-4 w-4" /> Skip Intro
      </button>
      <div className="absolute bottom-8 left-8 hidden items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground sm:flex">
        Click anywhere to continue <ChevronRight className="h-3 w-3" />
      </div>
    </motion.div>
  );
}
