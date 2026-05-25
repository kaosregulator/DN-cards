import { useMemo, useState } from "react";
import { useCards, Card } from "@/hooks/queries";
import { resolveImageUrl } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Loader2, Sparkles, Trophy, Shield, Star } from "lucide-react";
import { motion } from "framer-motion";

const RARITY_GLOW: Record<string, string> = {
  legendary: "shadow-[0_0_32px_4px_rgba(234,179,8,0.35)] border-yellow-500/60",
  epic:      "shadow-[0_0_24px_2px_rgba(168,85,247,0.35)] border-purple-500/60",
  rare:      "shadow-[0_0_16px_2px_rgba(59,130,246,0.30)] border-blue-500/60",
  uncommon:  "shadow-[0_0_8px_1px_rgba(34,197,94,0.20)] border-green-500/40",
  common:    "border-border/50",
};

const RARITY_BADGE: Record<string, string> = {
  legendary: "border-yellow-500/50 text-yellow-400 bg-yellow-500/10",
  epic:      "border-purple-500/50 text-purple-400 bg-purple-500/10",
  rare:      "border-blue-500/50 text-blue-400 bg-blue-500/10",
  uncommon:  "border-green-500/50 text-green-400 bg-green-500/10",
  common:    "border-border text-muted-foreground",
};

const PLACE_STYLES: Record<number, { border: string; glow: string; label: string; icon: React.ReactNode }> = {
  1: {
    border: "border-yellow-400/80 shadow-[0_0_40px_8px_rgba(234,179,8,0.40)]",
    glow: "from-yellow-500/20 via-transparent",
    label: "1st Place",
    icon: <Trophy className="h-5 w-5 text-yellow-400" />,
  },
  2: {
    border: "border-slate-300/70 shadow-[0_0_30px_4px_rgba(148,163,184,0.30)]",
    glow: "from-slate-400/15 via-transparent",
    label: "2nd Place",
    icon: <Shield className="h-5 w-5 text-slate-300" />,
  },
  3: {
    border: "border-amber-700/70 shadow-[0_0_24px_2px_rgba(180,83,9,0.30)]",
    glow: "from-amber-700/15 via-transparent",
    label: "3rd Place",
    icon: <Star className="h-5 w-5 text-amber-600" />,
  },
};


function EventCardDetail({ card, open, onClose }: {
  card: { id: number; name: string; description: string; rarity: string; cardType: string; imageUrl: string | null; flavor: string | null; worthValue: number; isLimitedEdition: boolean; totalMinted: number; maxCopies: number | null; podiumPlace: 1 | 2 | 3 | null } | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!card) return null;
  const img = resolveImageUrl(card.imageUrl);
  const podium = card.podiumPlace ? PLACE_STYLES[card.podiumPlace] : null;
  // Mini podium colors per place — the small stage shown under the card in the dialog.
  const podiumStage: Record<number, { tier: string; base: string; height: string }> = {
    1: { tier: "bg-gradient-to-b from-yellow-400 to-yellow-600", base: "bg-yellow-700", height: "h-12" },
    2: { tier: "bg-gradient-to-b from-slate-300 to-slate-500", base: "bg-slate-600", height: "h-9" },
    3: { tier: "bg-gradient-to-b from-amber-600 to-amber-800", base: "bg-amber-900", height: "h-7" },
  };
  const stage = card.podiumPlace ? podiumStage[card.podiumPlace] : null;
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden bg-card/95 backdrop-blur-md border-border/50">
        <div className="flex flex-col">
          {img && (
            <div className="relative w-full bg-gradient-to-b from-muted/50 to-muted overflow-hidden flex flex-col items-center justify-end pt-8 pb-0 [perspective:1000px]">
              {/* Spinning card on a mini podium. y-axis flip then settle. */}
              <motion.div
                key={card.id /* re-trigger on card change */}
                initial={{ rotateY: -180, opacity: 0, y: -10 }}
                animate={{ rotateY: 0, opacity: 1, y: 0 }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                className="relative w-44 aspect-[3/4] rounded-lg overflow-hidden shadow-2xl border border-border/40 [transform-style:preserve-3d]"
              >
                <img src={img} alt={card.name} className="h-full w-full object-cover" />
                {podium && (
                  <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-background/85 backdrop-blur px-2 py-0.5 border border-border/40">
                    {podium.icon}
                    <span className="text-[10px] font-bold font-mono uppercase tracking-wider">{podium.label}</span>
                  </div>
                )}
                {card.isLimitedEdition && (
                  <div className="absolute bottom-2 left-2">
                    <Badge className="bg-background/90 text-primary border-primary font-mono text-[10px]">
                      LE · {card.totalMinted}{card.maxCopies ? `/${card.maxCopies}` : ""}
                    </Badge>
                  </div>
                )}
              </motion.div>
              {/* Mini podium stage */}
              {stage ? (
                <motion.div
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  transition={{ delay: 0.6, duration: 0.4, ease: "easeOut" }}
                  style={{ transformOrigin: "bottom" }}
                  className="relative w-56 flex flex-col items-center mt-2"
                >
                  <div className={`w-48 ${stage.height} ${stage.tier} rounded-t-md flex items-center justify-center shadow-lg border-x border-t border-white/20`}>
                    <span className="text-2xl font-black text-white/90 drop-shadow">{card.podiumPlace}</span>
                  </div>
                  <div className={`w-56 h-3 ${stage.base} rounded-b-sm shadow-inner`} />
                </motion.div>
              ) : (
                <div className="h-6 w-full bg-gradient-to-b from-transparent to-background/40" />
              )}
            </div>
          )}
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={`text-xs font-mono uppercase tracking-widest ${RARITY_BADGE[card.rarity]}`}>
                {card.rarity}
              </Badge>
              <Badge variant="outline" className="text-xs font-mono uppercase tracking-widest">
                {card.cardType}
              </Badge>
              <Badge variant="outline" className="text-xs font-mono uppercase tracking-widest border-destructive/50 text-destructive">
                Event
              </Badge>
            </div>
            <h2 className="text-2xl font-bold tracking-wider">{card.name}</h2>
            {card.flavor ? (
              <div className="border-l-2 border-primary/50 pl-4 py-1">
                <p className="text-sm italic text-foreground/80 leading-relaxed">"{card.flavor}"</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed">{card.description}</p>
            )}
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
              Worth: {card.worthValue.toLocaleString()} 💠
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Events() {
  const { data, isLoading, error } = useCards();
  const [selected, setSelected] = useState<(typeof eventCards)[0] | null>(null);

  const eventCards = useMemo(
    () => (data?.cards ?? []).filter(c => c.isEventExclusive && !c.isArchived),
    [data],
  );

  // Split into podium cards (admin-picked 1st/2nd/3rd via card.podiumPlace)
  // and general event cards (shown in the grid below).
  const podiumMap = useMemo(() => {
    const map: Record<number, typeof eventCards[0]> = {};
    for (const c of eventCards) {
      if (c.podiumPlace && !map[c.podiumPlace]) map[c.podiumPlace] = c;
    }
    return map;
  }, [eventCards]);

  const hasPodium = Object.keys(podiumMap).length > 0;
  const nonPodiumCards = useMemo(
    () => eventCards.filter(c => !c.podiumPlace),
    [eventCards],
  );

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-center">
        <p className="text-destructive font-mono uppercase tracking-widest mb-2">Error loading event cards</p>
      </div>
    );
  }

  if (eventCards.length === 0) {
    return (
      <div className="container max-w-screen-2xl py-20 px-4 text-center">
        <Sparkles className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-40" />
        <h1 className="text-3xl font-bold uppercase tracking-tight mb-2">No Event Cards Yet</h1>
        <p className="text-muted-foreground font-mono text-sm">Event cards are awarded by admins during special events. Check back soon.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-border/40 bg-gradient-to-br from-background via-background to-purple-950/20">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(168,85,247,0.08),transparent_60%)]" />
        <div className="container max-w-screen-2xl px-4 py-16 relative">
          <div className="flex items-center gap-3 mb-3">
            <Sparkles className="h-7 w-7 text-purple-400" />
            <span className="text-xs font-mono uppercase tracking-[0.3em] text-purple-400">Exclusive Collection</span>
          </div>
          <h1 className="text-5xl md:text-6xl font-black uppercase tracking-tight text-foreground mb-3">
            Event Cards
          </h1>
          <p className="text-muted-foreground font-mono text-sm max-w-xl">
            Awarded to members during special events and milestones. These cards never spawn randomly — they're earned.
          </p>
          <div className="mt-6 flex items-center gap-3">
            <Badge variant="outline" className="border-purple-500/40 text-purple-300 font-mono text-sm px-4 py-1">
              {eventCards.length} {eventCards.length === 1 ? "card" : "cards"}
            </Badge>
          </div>
        </div>
      </div>

      <div className="container max-w-screen-2xl px-4 py-12 space-y-16">

        {/* Podium section */}
        {hasPodium && (
          <section>
            <div className="flex items-center gap-3 mb-8 border-b border-border/40 pb-3">
              <Trophy className="h-5 w-5 text-yellow-400" />
              <h2 className="text-xl font-bold uppercase tracking-wider">Event Leaderboard Cards</h2>
            </div>
            <div className="flex flex-col md:flex-row items-end justify-center gap-6">
              {/* 2nd place — left, slightly shorter */}
              {podiumMap[2] && (
                <PodiumCard card={podiumMap[2]} place={2} onClick={() => setSelected(podiumMap[2])} />
              )}
              {/* 1st place — center, tallest */}
              {podiumMap[1] && (
                <PodiumCard card={podiumMap[1]} place={1} onClick={() => setSelected(podiumMap[1])} featured />
              )}
              {/* 3rd place — right, shortest */}
              {podiumMap[3] && (
                <PodiumCard card={podiumMap[3]} place={3} onClick={() => setSelected(podiumMap[3])} />
              )}
            </div>
          </section>
        )}

        {/* General event cards */}
        {nonPodiumCards.length > 0 && (
          <section>
            {hasPodium && (
              <div className="flex items-center gap-3 mb-8 border-b border-border/40 pb-3">
                <Sparkles className="h-5 w-5 text-purple-400" />
                <h2 className="text-xl font-bold uppercase tracking-wider">Special Event Cards</h2>
              </div>
            )}
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {nonPodiumCards.map((card, idx) => (
                <ShowcaseCard key={card.id} card={card} idx={idx} onClick={() => setSelected(card)} />
              ))}
            </div>
          </section>
        )}
      </div>

      <EventCardDetail
        card={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function PodiumCard({
  card, place, onClick, featured = false,
}: {
  card: Card;
  place: number;
  onClick: () => void;
  featured?: boolean;
}) {
  const style = PLACE_STYLES[place] ?? PLACE_STYLES[3];
  const img = resolveImageUrl(card.imageUrl);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: place === 1 ? 0 : place === 2 ? 0.1 : 0.2 }}
      onClick={onClick}
      className={`relative cursor-pointer rounded-2xl border-2 bg-card overflow-hidden transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl ${style.border} ${featured ? "w-full md:w-72 md:-mb-0" : "w-full md:w-60 md:mb-8"}`}
    >
      <div className={`absolute inset-0 bg-gradient-to-b ${style.glow} to-transparent opacity-60 pointer-events-none`} />

      {/* Place badge */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-full bg-background/80 backdrop-blur px-3 py-1 border border-border/40">
        {style.icon}
        <span className="text-xs font-bold font-mono uppercase tracking-wider">{style.label}</span>
      </div>

      {/* Card image */}
      <div className={`relative ${featured ? "aspect-[3/4]" : "aspect-[3/4]"} w-full bg-muted overflow-hidden`}>
        {img ? (
          <img src={img} alt={card.name} className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground font-mono uppercase text-sm">
            {card.name}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/10 to-transparent" />
      </div>

      {/* Info overlay */}
      <div className="relative p-4 -mt-10 z-10">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Badge variant="outline" className={`text-[10px] font-mono uppercase tracking-widest ${RARITY_BADGE[card.rarity]}`}>
            {card.rarity}
          </Badge>
          <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-widest border-destructive/40 text-destructive">
            Event
          </Badge>
        </div>
        <h3 className="font-bold tracking-wide text-foreground leading-tight">{card.name}</h3>
        {(card.flavor || card.description) && (
          <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">
            {card.flavor ? `"${card.flavor}"` : card.description}
          </p>
        )}
        <div className="mt-3 text-xs font-mono text-muted-foreground">
          {card.worthValue.toLocaleString()} 💠
        </div>
      </div>
    </motion.div>
  );
}

function ShowcaseCard({
  card, idx, onClick,
}: {
  card: Card;
  idx: number;
  onClick: () => void;
}) {
  const img = resolveImageUrl(card.imageUrl);
  const glow = RARITY_GLOW[card.rarity] ?? RARITY_GLOW.common;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.08 }}
      onClick={onClick}
      className={`group relative cursor-pointer rounded-2xl border-2 bg-card overflow-hidden transition-all duration-300 hover:-translate-y-2 ${glow}`}
    >
      {/* Card image — portrait fill */}
      <div className="relative aspect-[3/4] w-full bg-muted overflow-hidden">
        {img ? (
          <img
            src={img}
            alt={card.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-6 text-center text-muted-foreground font-mono uppercase text-sm">
            {card.name}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/20 to-transparent" />

        {/* Badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-1">
          {card.isLimitedEdition && (
            <Badge variant="outline" className="bg-background/80 text-[10px] uppercase border-primary/50 text-primary font-mono backdrop-blur-sm">
              LE {card.totalMinted}{card.maxCopies ? `/${card.maxCopies}` : ""}
            </Badge>
          )}
          <Badge variant="outline" className="bg-background/80 text-[10px] uppercase border-destructive/50 text-destructive font-mono backdrop-blur-sm">
            Event
          </Badge>
        </div>
      </div>

      {/* Info */}
      <div className="relative p-5 -mt-14 z-10">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <Badge variant="outline" className={`text-[10px] font-mono uppercase tracking-widest ${RARITY_BADGE[card.rarity]}`}>
            {card.rarity}
          </Badge>
        </div>
        <h3 className="text-base font-bold tracking-wide text-foreground leading-tight mb-2">{card.name}</h3>
        {(card.flavor || card.description) && (
          <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
            {card.flavor ? <span className="italic">"{card.flavor}"</span> : card.description}
          </p>
        )}
        <div className="mt-4 text-xs font-mono text-muted-foreground">
          {card.worthValue.toLocaleString()} 💠
        </div>
      </div>
    </motion.div>
  );
}
