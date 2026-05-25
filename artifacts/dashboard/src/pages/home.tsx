import { useState, useMemo } from "react";
import { useCards, Rarity } from "@/hooks/queries";
import { CardComponent } from "@/components/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, ChevronDown, ChevronUp, Sparkles, Sparkle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const RARITY_ORDER: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];

export default function Home() {
  const { data, isLoading, error } = useCards();
  const [search, setSearch] = useState("");
  const [selectedRarities, setSelectedRarities] = useState<Set<Rarity>>(new Set());
  const [eventsOpen, setEventsOpen] = useState(true);

  // Event-exclusive cards are display-only on the roster: they never spawn,
  // they're admin-awarded during events. We surface them in their own panel
  // above the rarity groups, with `flavor` text as the event explanation
  // (e.g. "Awarded during DN Anniversary, May 2026").
  const eventCards = useMemo(
    () => (data?.cards ?? []).filter(c => c.isEventExclusive && !c.isArchived),
    [data],
  );

  const toggleRarity = (rarity: Rarity) => {
    const next = new Set(selectedRarities);
    if (next.has(rarity)) {
      next.delete(rarity);
    } else {
      next.add(rarity);
    }
    setSelectedRarities(next);
  };

  const processedCards = useMemo(() => {
    if (!data?.cards) return [];

    // Calculate drop chances per rarity
    const weightsByRarity: Record<string, number> = {};
    data.cards.forEach((c) => {
      if (c.droppable) {
        weightsByRarity[c.rarity] = (weightsByRarity[c.rarity] || 0) + c.dropWeight;
      }
    });

    let filtered = data.cards.filter((c) => {
      const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) || 
                           (c.setName?.toLowerCase() || "").includes(search.toLowerCase());
      const matchesRarity = selectedRarities.size === 0 || selectedRarities.has(c.rarity);
      return matchesSearch && matchesRarity;
    });

    // Group by rarity
    const grouped: Record<string, typeof filtered> = {};
    RARITY_ORDER.forEach(r => grouped[r] = []);
    
    filtered.forEach((c) => {
      grouped[c.rarity].push(c);
    });

    return RARITY_ORDER.map(rarity => ({
      rarity,
      totalWeight: weightsByRarity[rarity] || 0,
      cards: grouped[rarity]
    })).filter(g => g.cards.length > 0);

  }, [data, search, selectedRarities]);

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
        <p className="text-destructive font-mono uppercase tracking-widest mb-2">Error loading roster</p>
        <p className="text-muted-foreground text-sm">Please check your connection or try again later.</p>
      </div>
    );
  }

  return (
    <div className="container max-w-screen-2xl py-8 px-4 md:px-8 bg-tactical-pattern min-h-screen">
      <div className="mb-12 space-y-6">
        <div>
          <h1 className="text-4xl font-bold tracking-tight uppercase text-foreground mb-2">Unit Roster</h1>
          <p className="text-muted-foreground font-mono uppercase tracking-widest text-sm">
            Catalog of all deployable assets
          </p>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between bg-card/50 p-4 rounded-xl border border-border/50 backdrop-blur-sm">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by name or set..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-background/50 font-mono text-sm"
              data-testid="input-search"
            />
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono uppercase text-muted-foreground mr-2">Filter Rarity:</span>
            {RARITY_ORDER.map((rarity) => {
              const active = selectedRarities.has(rarity);
              return (
                <button
                  key={rarity}
                  type="button"
                  aria-pressed={active}
                  aria-label={`Filter by ${rarity}`}
                  onClick={() => toggleRarity(rarity)}
                  data-testid={`filter-rarity-${rarity}`}
                  className={`cursor-pointer uppercase font-mono tracking-widest text-xs px-3 py-1 rounded-md border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {rarity}
                </button>
              );
            })}
            {selectedRarities.size > 0 && (
              <button
                type="button"
                aria-label="Clear rarity filters"
                onClick={() => setSelectedRarities(new Set())}
                className="cursor-pointer text-xs uppercase font-mono ml-2 px-3 py-1 rounded-md text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Shiny info banner — explains the 0.5% global roll + 2× value. */}
      <div className="mb-8 rounded-xl border border-pink-500/30 bg-gradient-to-r from-pink-500/5 via-card/40 to-amber-400/5 backdrop-blur-sm p-4 flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-amber-400 text-white shadow-md">
          <Sparkle className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold uppercase tracking-wider text-pink-200">Shiny Variants ✨</h3>
          <p className="text-xs text-muted-foreground font-mono leading-relaxed">
            Every random catch, pack pull, and trade-in has a flat <span className="text-pink-300 font-bold">0.5%</span> chance to mint a shiny.
            Shinies count at <span className="text-pink-300 font-bold">2× worth & burn</span>, are tracked separately, and are not tradeable yet.
          </p>
        </div>
      </div>

      {eventCards.length > 0 && (
        <div className="mb-12 rounded-xl border border-pink-500/30 bg-gradient-to-br from-pink-500/5 via-card/40 to-purple-500/5 backdrop-blur-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setEventsOpen(o => !o)}
            className="w-full flex items-center justify-between gap-4 p-4 hover:bg-pink-500/5 transition-colors"
            data-testid="toggle-event-panel"
            aria-expanded={eventsOpen}
          >
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-pink-400" />
              <div className="text-left">
                <h2 className="text-lg font-bold uppercase tracking-wider text-pink-200">Event Exclusive Cards</h2>
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                  Display only · Awarded during events · Never spawn randomly
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="border-pink-500/40 text-pink-300 font-mono text-xs">
                {eventCards.length} CARDS
              </Badge>
              {eventsOpen
                ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </button>
          <AnimatePresence initial={false}>
            {eventsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {eventCards.map(card => (
                    <div
                      key={card.id}
                      className="flex gap-3 rounded-lg border border-border/50 bg-background/40 p-3"
                      data-testid={`event-card-${card.id}`}
                    >
                      {card.imageUrl && (
                        <img
                          src={card.imageUrl}
                          alt={card.name}
                          className="h-20 w-16 rounded object-cover border border-pink-500/30 flex-shrink-0"
                          loading="lazy"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-bold uppercase tracking-wide truncate">{card.name}</span>
                          <Badge variant="outline" className="text-[10px] font-mono uppercase border-pink-500/40 text-pink-300 flex-shrink-0">
                            {card.rarity}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-3">
                          {card.flavor
                            ? <span className="italic">"{card.flavor}"</span>
                            : (card.description || <span className="opacity-60">No event note yet — set the card's flavor text in admin to describe when/why it was awarded.</span>)
                          }
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="space-y-16">
        {processedCards.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-border rounded-xl">
             <p className="text-muted-foreground font-mono uppercase tracking-widest">No assets found matching criteria</p>
          </div>
        ) : (
          processedCards.map((group) => (
            <div key={group.rarity} className="space-y-6">
              <div className="flex items-center gap-4 border-b border-border/40 pb-2">
                <h2 className="text-2xl font-bold uppercase tracking-wider text-foreground">
                  {group.rarity}
                </h2>
                <Badge variant="secondary" className="font-mono text-xs">
                  {group.cards.length} ASSETS
                </Badge>
              </div>
              
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                <AnimatePresence>
                  {group.cards.map((card, idx) => (
                    <motion.div
                      key={card.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                    >
                      <CardComponent
                        card={card}
                        relativeDropChance={card.droppable && group.totalWeight > 0 ? (card.dropWeight / group.totalWeight) * 100 : undefined}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
