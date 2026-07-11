import { useMemo, useState } from "react";
import { useCards } from "@/hooks/queries";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, ArrowUpDown, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { VaultCard } from "@/features/vault/VaultCard";
import { useVaultFilters, SORT_LABELS, type SortMode } from "@/features/vault/useVaultFilters";
import { useDiscordAuth, useOwnedCards } from "@/features/auth/useDiscordAuth";
import { cn } from "@/lib/utils";

const SORT_MODES: SortMode[] = ["newest", "oldest", "rarity", "name"];
type OwnFilter = "all" | "owned" | "missing";
const OWN_FILTERS: { key: OwnFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "owned", label: "Owned" },
  { key: "missing", label: "Missing" },
];

export default function Vault() {
  const { data, isLoading, error } = useCards();
  const f = useVaultFilters(data?.cards, data?.rarityOrder);
  const { isLoggedIn } = useDiscordAuth();
  const { ownedSet, holdings } = useOwnedCards(isLoggedIn);
  const [ownFilter, setOwnFilter] = useState<OwnFilter>("all");

  // Layer ownership on top of the base filtered/sorted result (only meaningful
  // when logged in — otherwise ownership is unknown and we show everything).
  const shown = useMemo(() => {
    if (!isLoggedIn || ownFilter === "all") return f.result;
    return f.result.filter((c) => (ownFilter === "owned" ? ownedSet.has(c.id) : !ownedSet.has(c.id)));
  }, [f.result, isLoggedIn, ownFilter, ownedSet]);

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
        <p className="mb-2 font-mono uppercase tracking-widest text-destructive">Error loading the Card Vault</p>
        <p className="text-sm text-muted-foreground">Please check your connection or try again later.</p>
      </div>
    );
  }

  const total = data?.cards.length ?? 0;

  return (
    <div className="bg-tactical-pattern min-h-screen">
      <div className="container max-w-screen-2xl px-4 py-8 md:px-8">
        <header className="mb-8">
          <h1 className="mb-2 text-4xl font-bold uppercase tracking-tight">Card Vault</h1>
          <p className="font-mono text-sm uppercase tracking-widest text-muted-foreground">
            The complete Dex · {total} cards catalogued
          </p>
        </header>

        {/* Controls */}
        <div className="mb-6 space-y-4 rounded-xl border border-border/50 bg-card/50 p-4 backdrop-blur-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by name, set, or type…"
                value={f.search}
                onChange={(e) => f.setSearch(e.target.value)}
                className="bg-background/50 pl-9 font-mono text-sm"
                data-testid="vault-search"
              />
            </div>

            <div className="flex items-center gap-2 md:ml-auto">
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Sort</span>
              <div className="flex flex-wrap gap-1">
                {SORT_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => f.setSort(mode)}
                    aria-pressed={f.sort === mode}
                    className={cn(
                      "rounded-md border px-3 py-1 font-mono text-xs uppercase tracking-widest transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      f.sort === mode ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
                    )}
                    data-testid={`vault-sort-${mode}`}
                  >
                    {SORT_LABELS[mode]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Ownership filter — only when logged in via Discord */}
          {isLoggedIn && (
            <FilterRow label="Show">
              {OWN_FILTERS.map((o) => (
                <FilterChip key={o.key} active={ownFilter === o.key} onClick={() => setOwnFilter(o.key)} testId={`vault-own-${o.key}`}>
                  {o.label}
                  {o.key === "owned" && <span className="opacity-50"> {ownedSet.size}</span>}
                </FilterChip>
              ))}
            </FilterRow>
          )}

          {/* Rarity filters */}
          {f.rarityOptions.length > 0 && (
            <FilterRow label="Rarity">
              {f.rarityOptions.map((opt) => (
                <FilterChip
                  key={opt.key}
                  active={f.selectedRarities.has(opt.key)}
                  onClick={() => f.toggleRarity(opt.key)}
                  testId={`vault-filter-rarity-${opt.key}`}
                >
                  {opt.label} <span className="opacity-50">{opt.count}</span>
                </FilterChip>
              ))}
            </FilterRow>
          )}

          {/* Set filters */}
          {f.setOptions.length > 0 && (
            <FilterRow label="Set">
              {f.setOptions.map((opt) => (
                <FilterChip
                  key={opt.key}
                  active={f.selectedSets.has(Number(opt.key))}
                  onClick={() => f.toggleSet(Number(opt.key))}
                  testId={`vault-filter-set-${opt.key}`}
                >
                  {opt.label} <span className="opacity-50">{opt.count}</span>
                </FilterChip>
              ))}
            </FilterRow>
          )}

          {f.hasFilters && (
            <button
              type="button"
              onClick={f.clearAll}
              className="flex items-center gap-1 font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Clear all filters
            </button>
          )}
        </div>

        {/* Results */}
        <div className="mb-4 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {shown.length} {shown.length === 1 ? "card" : "cards"} shown
          {isLoggedIn && <span className="ml-2 opacity-60">· {ownedSet.size}/{data?.cards.length ?? 0} owned</span>}
        </div>

        {shown.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-20 text-center">
            <p className="font-mono uppercase tracking-widest text-muted-foreground">No cards match your filters</p>
          </div>
        ) : (
          <motion.div layout className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            <AnimatePresence mode="popLayout">
              {shown.map((card) => {
                const h = holdings.get(card.id);
                return (
                  <VaultCard
                    key={card.id}
                    card={card}
                    pool={data?.cards ?? []}
                    owned={isLoggedIn ? ownedSet.has(card.id) : undefined}
                    count={h?.count}
                    shinyCount={h?.shinyCount}
                  />
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function FilterChip({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "rounded-md border px-3 py-1 font-mono text-xs uppercase tracking-widest transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
