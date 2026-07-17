// ─────────────────────────────────────────────────────────────────────────────
// Shared fuzzy-search service (Fuse.js).
//
// ONE place for the project's fuzzy matching so every command searches with the
// same config and — for cards — the same cached per-guild index. Typo tolerant,
// acronym-friendly ("M1" → "M1 Abrams"), case-insensitive.
//
// Two tiers:
//   • Generic one-shot helpers (fuzzyRank / fuzzyBest) for small ad-hoc lists —
//     bosses, arenas, packs, admin lookups. Cheap; no caching needed.
//   • Cached card index (fuzzyFindCard / fuzzySearchCards) keyed per guild and
//     rebuilt ONLY when the card data changes (bumpCardsSearchVersion, called
//     from the card cache invalidation) — never on every query.
// ─────────────────────────────────────────────────────────────────────────────

import Fuse from "fuse.js";
import type { IFuseOptions } from "fuse.js";

// Tuned for short name-like queries: tolerate typos, ignore position, allow
// single-char matches, and enable extended search operators.
export const NAME_FUSE_OPTIONS: IFuseOptions<unknown> = {
  threshold: 0.35,
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 1,
  useExtendedSearch: true,
};

/** Acronym for a name, e.g. "M1 Abrams" → "MA" (drives acronym-first matching). */
export function acronym(name: string): string {
  return name
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase())
    .join("");
}

// Rank a list by relevance to `query`: exact → substring → acronym literal
// matches first (in list order), then Fuse fuzzy/typo hits fill the rest. Stable
// and generic over any item, given a name accessor.
export function fuzzyRank<T>(
  items: T[], query: string, nameOf: (item: T) => string, limit?: number,
): T[] {
  const q = query.trim();
  if (!q) return limit != null ? items.slice(0, limit) : items;
  const ql = q.toLowerCase();

  const literal: T[] = [];
  const seen = new Set<T>();
  for (const it of items) {
    const n = nameOf(it).toLowerCase();
    if (n.includes(ql) || acronym(nameOf(it)).toLowerCase().includes(ql)) {
      literal.push(it); seen.add(it);
    }
  }

  const fuse = new Fuse(items, {
    ...NAME_FUSE_OPTIONS, keys: ["__name"], getFn: (it) => nameOf(it as T),
  } as IFuseOptions<T>);
  const merged = [...literal];
  for (const r of fuse.search(q)) {
    if (!seen.has(r.item)) { merged.push(r.item); seen.add(r.item); }
  }
  return limit != null ? merged.slice(0, limit) : merged;
}

/** Best single fuzzy match for `query`, or undefined. */
export function fuzzyBest<T>(items: T[], query: string, nameOf: (item: T) => string): T | undefined {
  return fuzzyRank(items, query, nameOf, 1)[0];
}

// ── Cached per-guild card index ──────────────────────────────────────────────

interface CardLike { id: number; name: string }

let _cardsVersion = 0;
const _cardFuse = new Map<string, { v: number; fuse: Fuse<CardLike> }>();

/** Bump when card data changes so guild card indexes rebuild lazily. */
export function bumpCardsSearchVersion(): void {
  _cardsVersion++;
}

function cardFuse<T extends CardLike>(guildId: string, cards: T[]): Fuse<T> {
  const hit = _cardFuse.get(guildId);
  if (hit && hit.v === _cardsVersion) return hit.fuse as unknown as Fuse<T>;
  const fuse = new Fuse(cards, { ...NAME_FUSE_OPTIONS, keys: ["name"] } as IFuseOptions<T>);
  _cardFuse.set(guildId, { v: _cardsVersion, fuse: fuse as unknown as Fuse<CardLike> });
  return fuse;
}

/**
 * Fuzzy-find one card by name within a guild's roster. Exact / substring /
 * acronym literal matches win; otherwise the cached Fuse index resolves typos.
 * Pass the guild's cards (e.g. from getAllCardsCached) — the index is cached per
 * guild and only rebuilt after bumpCardsSearchVersion().
 */
export function fuzzyFindCard<T extends CardLike>(guildId: string, cards: T[], query: string): T | undefined {
  const q = query.trim();
  if (!q) return undefined;
  const ql = q.toLowerCase();
  const literal =
    cards.find(c => c.name.toLowerCase() === ql) ??
    cards.find(c => c.name.toLowerCase().includes(ql)) ??
    cards.find(c => acronym(c.name).toLowerCase() === ql);
  if (literal) return literal;
  return cardFuse(guildId, cards).search(q, { limit: 1 })[0]?.item;
}

/** Ranked fuzzy card search within a guild's roster (uses the cached index). */
export function fuzzySearchCards<T extends CardLike>(
  guildId: string, cards: T[], query: string, limit = 25,
): T[] {
  const q = query.trim();
  if (!q) return cards.slice(0, limit);
  const ql = q.toLowerCase();
  const literal: T[] = [];
  const seen = new Set<number>();
  for (const c of cards) {
    if (c.name.toLowerCase().includes(ql) || acronym(c.name).toLowerCase().includes(ql)) {
      literal.push(c); seen.add(c.id);
    }
  }
  const merged = [...literal];
  for (const r of cardFuse(guildId, cards).search(q)) {
    if (!seen.has(r.item.id)) { merged.push(r.item as T); seen.add(r.item.id); }
  }
  return merged.slice(0, limit);
}
