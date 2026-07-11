import { useMemo, useState } from "react";
import type { Card, Rarity } from "@/hooks/queries";
import { categoryKeyOf, rarityLabelOf } from "./rarity";

export type SortMode = "newest" | "oldest" | "rarity" | "name";

export const SORT_LABELS: Record<SortMode, string> = {
  newest: "Newest",
  oldest: "Oldest",
  rarity: "Rarity",
  name: "Name",
};

const DEFAULT_RARITY_ORDER: Rarity[] = ["mythic", "legendary", "epic", "rare", "uncommon", "common"];

export interface FilterOption {
  key: string;
  label: string;
  count: number;
}

/**
 * Pure client-side vault state: instant text search, multi-select rarity and
 * set filters, and four sort modes. No network calls — everything runs over
 * the already-fetched card pool.
 */
export function useVaultFilters(cards: Card[] | undefined, rarityOrder: Rarity[] | null | undefined) {
  const [search, setSearch] = useState("");
  const [selectedRarities, setSelectedRarities] = useState<Set<string>>(new Set());
  const [selectedSets, setSelectedSets] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<SortMode>("newest");

  const pool = cards ?? [];

  // Rank map for "sort by rarity": higher rank = shown first. Custom tiers
  // (not in the built-in ladder) rank above built-ins, alpha within.
  const rarityRank = useMemo(() => {
    const order = rarityOrder ?? DEFAULT_RARITY_ORDER;
    const map = new Map<string, number>();
    order.forEach((key, i) => map.set(key, order.length - i));
    return map;
  }, [rarityOrder]);

  const rarityOptions = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const c of pool) {
      const key = categoryKeyOf(c);
      const label = rarityLabelOf(c);
      const cur = counts.get(key);
      if (cur) cur.count += 1;
      else counts.set(key, { label, count: 1 });
    }
    return [...counts.entries()]
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => (rarityRank.get(b.key) ?? -1) - (rarityRank.get(a.key) ?? -1) || a.label.localeCompare(b.label));
  }, [pool, rarityRank]);

  const setOptions = useMemo<FilterOption[]>(() => {
    const counts = new Map<number, { label: string; count: number }>();
    for (const c of pool) {
      for (const s of c.sets ?? []) {
        const cur = counts.get(s.id);
        if (cur) cur.count += 1;
        else counts.set(s.id, { label: s.name, count: 1 });
      }
    }
    return [...counts.entries()]
      .map(([id, v]) => ({ key: String(id), label: v.label, count: v.count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [pool]);

  const result = useMemo(() => {
    const q = search.trim().toLowerCase();
    let filtered = pool.filter((c) => {
      if (q) {
        const hay = `${c.name} ${(c.sets ?? []).map((s) => s.name).join(" ")} ${c.cardType}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (selectedRarities.size > 0 && !selectedRarities.has(categoryKeyOf(c))) return false;
      if (selectedSets.size > 0 && !(c.sets ?? []).some((s) => selectedSets.has(s.id))) return false;
      return true;
    });

    const byName = (a: Card, b: Card) => a.name.localeCompare(b.name);
    const time = (c: Card) => new Date(c.createdAt).getTime();
    filtered = [...filtered].sort((a, b) => {
      switch (sort) {
        case "newest": return time(b) - time(a) || b.id - a.id;
        case "oldest": return time(a) - time(b) || a.id - b.id;
        case "name": return byName(a, b);
        case "rarity": {
          const ra = rarityRank.get(categoryKeyOf(a)) ?? -1;
          const rb = rarityRank.get(categoryKeyOf(b)) ?? -1;
          return rb - ra || byName(a, b);
        }
      }
    });
    return filtered;
  }, [pool, search, selectedRarities, selectedSets, sort, rarityRank]);

  const toggleRarity = (key: string) =>
    setSelectedRarities((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const toggleSet = (id: number) =>
    setSelectedSets((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const clearAll = () => {
    setSelectedRarities(new Set());
    setSelectedSets(new Set());
    setSearch("");
  };

  return {
    search, setSearch,
    selectedRarities, toggleRarity,
    selectedSets, toggleSet,
    sort, setSort,
    clearAll,
    rarityOptions, setOptions,
    result,
    hasFilters: selectedRarities.size > 0 || selectedSets.size > 0 || search.trim().length > 0,
  };
}
