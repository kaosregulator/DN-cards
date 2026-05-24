import { useState, useMemo } from "react";
import { useCards, Rarity } from "@/hooks/queries";
import { CardComponent } from "@/components/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const RARITY_ORDER: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];

export default function Home() {
  const { data, isLoading, error } = useCards();
  const [search, setSearch] = useState("");
  const [selectedRarities, setSelectedRarities] = useState<Set<Rarity>>(new Set());

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
