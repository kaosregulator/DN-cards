import {
  db,
  cardsTable, collectionsTable, guildSettingsTable,
  adminUsersTable, spawnLogTable, userCurrencyTable, tradesTable,
  wishlistsTable, userTimeoutsTable, cardEventsTable,
  rarityProfilesTable,
  customRaritiesTable, cardRarityOverridesTable,
  rarityDisplayOverridesTable,
  setsTable, cardSetMembershipsTable,
} from "@workspace/db";
import { eq, and, sql, desc, inArray, isNull } from "drizzle-orm";
import type { Card, CardEvent, CardSet, CustomRarity, GuildSettings, RarityProfile, Trade } from "@workspace/db";
import {
  DEFAULT_CARDS, SHINY_RATE, SHINY_MULTIPLIER, type Rarity,
  type RarityDisplayMap,
} from "./cards-data.js";
import {
  applyRarityProfile,
  applyRarityProfileAll,
  applyRarityContext,
  applyRarityContextAll,
  effectiveRarityKey,
  getDisplayRarities,
  getGuildRarityWeights,
  isRandomDroppable,
  getEffectiveDropWeight,
  buildDropChanceSummary,
  type RarityProfileMap,
  type RarityContext,
} from "./rarity-runtime.js";
export {
  applyRarityProfile,
  applyRarityProfileAll,
  applyRarityContext,
  applyRarityContextAll,
  effectiveRarityKey,
  getDisplayRarities,
  getGuildRarityWeights,
  isRandomDroppable,
  getEffectiveDropWeight,
  buildDropChanceSummary,
} from "./rarity-runtime.js";
export type {
  RarityProfileMap,
  RarityContext,
  DisplayRarity,
  DropWeightOptions,
  DropChanceSummary,
} from "./rarity-runtime.js";
import { logger } from "../lib/logger.js";

// ── Per-guild rarity profile (worth/burn/dropWeight overrides) ───────────────
// One row per (guild, rarity). Any null column means "use the card's value".
// Tiny dataset (≤6 rows/guild) — cached for 5s like the cards cache. Caches
// per-guild so a write for one server doesn't pollute another's view.
const _profileCache = new Map<string, { value: RarityProfileMap; expiresAt: number }>();
const PROFILE_TTL_MS = 5_000;

export async function getRarityProfile(guildId: string): Promise<RarityProfileMap> {
  const cached = _profileCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const rows = await db.select().from(rarityProfilesTable).where(eq(rarityProfilesTable.guildId, guildId));
  const map: RarityProfileMap = new Map();
  for (const r of rows) map.set(r.rarity as Rarity, r);
  _profileCache.set(guildId, { value: map, expiresAt: Date.now() + PROFILE_TTL_MS });
  return map;
}

export function invalidateRarityProfileCache(guildId?: string): void {
  if (guildId) _profileCache.delete(guildId);
  else _profileCache.clear();
}

// ── Custom Rarity Tiers (Stage 2) ────────────────────────────────────────────
// Per-guild context that bundles BOTH the Stage-1 rarity profile (per-tier
// numeric overrides for built-in rarities) AND Stage-2 custom tiers + card
// overrides. When a card is assigned to a custom tier, that tier's values
// REPLACE the card's worth/burn/dropWeight entirely — no layering with the
// Stage-1 profile for that card. For un-overridden cards the Stage-1
// profile still applies as before, so Server 1 (zero custom rows) is
// unchanged.
//
const _ctxCache = new Map<string, { value: RarityContext; expiresAt: number }>();
const CTX_TTL_MS = 5_000;

export async function getRarityContext(guildId: string): Promise<RarityContext> {
  const cached = _ctxCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const [profile, customs, overrides] = await Promise.all([
    getRarityProfile(guildId),
    db.select().from(customRaritiesTable).where(eq(customRaritiesTable.guildId, guildId)),
    db.select().from(cardRarityOverridesTable).where(eq(cardRarityOverridesTable.guildId, guildId)),
  ]);
  const customBySlug = new Map<string, CustomRarity>();
  for (const c of customs) customBySlug.set(c.slug, c);
  const customByCard = new Map<number, CustomRarity>();
  for (const o of overrides) {
    const tier = customBySlug.get(o.customRaritySlug);
    if (tier) customByCard.set(o.cardId, tier);
  }
  const sorted = [...customs].sort((a, b) => a.position - b.position);
  const value: RarityContext = { guildId, profile, customByCard, customBySlug, customs: sorted };
  _ctxCache.set(guildId, { value, expiresAt: Date.now() + CTX_TTL_MS });
  return value;
}

export function invalidateRarityContextCache(guildId?: string): void {
  if (guildId) _ctxCache.delete(guildId);
  else _ctxCache.clear();
}

// ── Rarity Display Overrides (per-guild cosmetic rename of built-in tiers) ───
// Cosmetic layer only — does NOT affect economy values. One row per (guild,
// rarity). Cached for 5s per guild; invalidated on every write. Callers
// pass the returned map as the 3rd argument to rarityLabel/rarityEmoji/
// rarityColor in cards-data.ts, which applies it with highest priority.
const _displayCache = new Map<string, { value: RarityDisplayMap; expiresAt: number }>();
const DISPLAY_TTL_MS = 5_000;

export async function getRarityDisplayOverrides(guildId: string): Promise<RarityDisplayMap> {
  const cached = _displayCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const rows = await db.select().from(rarityDisplayOverridesTable)
    .where(eq(rarityDisplayOverridesTable.guildId, guildId));
  const map: RarityDisplayMap = new Map();
  for (const r of rows) {
    map.set(r.rarity as Rarity, {
      displayName: r.displayName,
      emoji: r.emoji,
      color: r.color,
    });
  }
  _displayCache.set(guildId, { value: map, expiresAt: Date.now() + DISPLAY_TTL_MS });
  return map;
}

export function invalidateRarityDisplayCache(guildId?: string): void {
  if (guildId) _displayCache.delete(guildId);
  else _displayCache.clear();
}

export async function upsertRarityDisplayOverride(
  guildId: string,
  rarity: Rarity,
  patch: { displayName?: string | null; emoji?: string | null; color?: number | null },
  updatedBy?: string,
): Promise<void> {
  await db.insert(rarityDisplayOverridesTable)
    .values({ guildId, rarity, ...patch, updatedAt: new Date(), updatedBy: updatedBy ?? null })
    .onConflictDoUpdate({
      target: [rarityDisplayOverridesTable.guildId, rarityDisplayOverridesTable.rarity],
      set: { ...patch, updatedAt: new Date(), updatedBy: updatedBy ?? null },
    });
  invalidateRarityDisplayCache(guildId);
}

export async function clearRarityDisplayOverride(guildId: string, rarity: Rarity): Promise<void> {
  await db.delete(rarityDisplayOverridesTable).where(
    and(
      eq(rarityDisplayOverridesTable.guildId, guildId),
      eq(rarityDisplayOverridesTable.rarity, rarity),
    ),
  );
  invalidateRarityDisplayCache(guildId);
}

export async function clearAllRarityDisplayOverrides(guildId: string): Promise<void> {
  await db.delete(rarityDisplayOverridesTable)
    .where(eq(rarityDisplayOverridesTable.guildId, guildId));
  invalidateRarityDisplayCache(guildId);
}

export async function getGuildDropChanceRuntime(guildId: string) {
  const [settings, ctx, spawnPool, eventBoosts] = await Promise.all([
    getOrCreateGuildSettings(guildId),
    getRarityContext(guildId),
    getActiveSetSpawnPoolCached(guildId),
    getActiveEventBoosts(guildId),
  ]);
  const rarityWeights = getGuildRarityWeights(settings);
  const chanceSummary = buildDropChanceSummary(spawnPool.cards, {
    ctx,
    rarityWeights,
    setRarityWeights: spawnPool.rarityWeights,
    eventBoosts,
  });
  return { settings, ctx, spawnPool, rarityWeights, eventBoosts, chanceSummary };
}

// ── Seed / resync default cards ───────────────────────────────────────────────
// Defaults are now tracked purely
// via the first-class `sets` + `card_set_memberships` tables.
export const DEFAULTS_SET_NAME = "defaults";

// Seed defaults ONLY on a completely empty database — never re-sync or re-add
// after unload, so admin removals are permanent. Membership rows are added to
// the "defaults" set (created if missing) so the cards are immediately
// activatable via `/setadmin active set:defaults`.
// Force-add default cards (used by /loadset defaults). Skips names already in DB.
// Each newly-added card is also joined to the "defaults" set.
export async function loadDefaultCards(): Promise<{ added: number; skipped: number }> {
  let added = 0, skipped = 0;
  const defaultsSet = (await getSetByName(DEFAULTS_SET_NAME)) ?? (await createSet(DEFAULTS_SET_NAME));
  for (const card of DEFAULT_CARDS) {
    const existing = await getCardByName(card.name);
    if (existing) {
      // Ensure existing copies are still members of the defaults set.
      await db.insert(cardSetMembershipsTable)
        .values({ setId: defaultsSet.id, cardId: existing.id })
        .onConflictDoNothing();
      skipped++;
      continue;
    }
    const [inserted] = await db.insert(cardsTable).values(card).onConflictDoNothing().returning({ id: cardsTable.id });
    if (inserted) {
      await db.insert(cardSetMembershipsTable)
        .values({ setId: defaultsSet.id, cardId: inserted.id })
        .onConflictDoNothing();
      added++;
    }
  }
  invalidateActiveSetCardsCache();
  return { added, skipped };
}

// Remove all default-roster cards (and their FK dependents) — destructive.
export async function unloadDefaultCards(): Promise<{ removed: number }> {
  return deleteSetByName(DEFAULTS_SET_NAME);
}

// ── Card Sets ─────────────────────────────────────────────────────────────────
// Thin wrapper for legacy callers that expect the old `{ setName, cardCount }` shape.
export async function listSets(): Promise<Array<{ setName: string; cardCount: number }>> {
  const rows = await listSetsV2();
  return rows.map(r => ({ setName: r.set.name, cardCount: r.cardCount }));
}

// Delete every card in a set by NAME — destructive (used by `/unloadset` and
// `unloadDefaultCards`). Cards are looked up via the memberships junction.
// Cascades through collections, spawn_log, trades, and finally the set row itself.
export async function deleteSetByName(setName: string): Promise<{ removed: number }> {
  const set = await getSetByName(setName);
  if (!set) return { removed: 0 };
  const members = await db.select({ cardId: cardSetMembershipsTable.cardId })
    .from(cardSetMembershipsTable).where(eq(cardSetMembershipsTable.setId, set.id));
  const ids = members.map(m => m.cardId);

  if (ids.length > 0) {
    await db.delete(collectionsTable).where(inArray(collectionsTable.cardId, ids));
    await db.delete(spawnLogTable).where(inArray(spawnLogTable.cardId, ids));
    await db.delete(tradesTable).where(
      sql`${tradesTable.offeredCardId} IN ${ids} OR ${tradesTable.requestedCardId} IN ${ids}`,
    );
    await db.delete(cardsTable).where(inArray(cardsTable.id, ids));
  }
  // Memberships cascade with cards, but if the set was empty we still drop
  // the set row to match the legacy "no traces left" semantics.
  await db.delete(setsTable).where(eq(setsTable.id, set.id));

  invalidateCardCache();
  invalidateActiveSetCardsCache();
  logger.info({ setName, removed: ids.length }, "Deleted card set");
  return { removed: ids.length };
}

// ── Card Sets v2 (first-class sets + memberships, Phase 1-3) ─────────────────
// Replaces the ad-hoc cards.set_name aggregation with a proper sets table +
// junction table. Guilds pick an active set via
// /setadmin active — only its cards spawn (Option B: no active set = no
// random spawns).

function slugifySetName(raw: string): string {
  return raw.toLowerCase().trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Resolve a set by its name (case-insensitive). Returns undefined when missing.
export async function getSetByName(name: string): Promise<CardSet | undefined> {
  const slug = slugifySetName(name);
  if (!slug) return undefined;
  const [row] = await db.select().from(setsTable)
    .where(sql`lower(${setsTable.name}) = ${slug}`).limit(1);
  return row;
}

export async function getSetById(id: number): Promise<CardSet | undefined> {
  const [row] = await db.select().from(setsTable).where(eq(setsTable.id, id)).limit(1);
  return row;
}

/** Idempotent: returns existing set if one with this slug already exists. */
export async function createSet(name: string, description?: string): Promise<CardSet> {
  const slug = slugifySetName(name);
  if (!slug) throw new Error("Set name must contain at least one letter or digit.");
  const existing = await getSetByName(slug);
  if (existing) return existing;
  const [row] = await db.insert(setsTable)
    .values({ name: slug, description: description ?? null })
    .returning();
  invalidateActiveSetCardsCache();
  return row;
}

export async function renameSet(setId: number, newName: string): Promise<CardSet | undefined> {
  const slug = slugifySetName(newName);
  if (!slug) throw new Error("New set name must contain at least one letter or digit.");
  const clash = await getSetByName(slug);
  if (clash && clash.id !== setId) throw new Error(`A set named \`${slug}\` already exists.`);
  const [row] = await db.update(setsTable)
    .set({ name: slug, updatedAt: new Date() })
    .where(eq(setsTable.id, setId))
    .returning();
  invalidateActiveSetCardsCache();
  return row;
}

/** Non-destructive — deletes the set row + membership rows only. Cards stay. */
export async function deleteSetById(setId: number): Promise<{ removedMemberships: number }> {
  const memberships = await db.select({ cardId: cardSetMembershipsTable.cardId })
    .from(cardSetMembershipsTable).where(eq(cardSetMembershipsTable.setId, setId));
  await db.delete(setsTable).where(eq(setsTable.id, setId));
  // Cascade clears cardSetMembershipsTable rows automatically.
  invalidateActiveSetCardsCache();
  return { removedMemberships: memberships.length };
}

export async function addCardToSet(setId: number, cardId: number): Promise<{ added: boolean }> {
  const existing = await db.select({ cardId: cardSetMembershipsTable.cardId })
    .from(cardSetMembershipsTable)
    .where(and(eq(cardSetMembershipsTable.setId, setId), eq(cardSetMembershipsTable.cardId, cardId)))
    .limit(1);
  if (existing.length > 0) return { added: false };
  await db.insert(cardSetMembershipsTable).values({ setId, cardId });
  invalidateActiveSetCardsCache();
  return { added: true };
}

export async function removeCardFromSet(setId: number, cardId: number): Promise<{ removed: boolean }> {
  const res = await db.delete(cardSetMembershipsTable)
    .where(and(eq(cardSetMembershipsTable.setId, setId), eq(cardSetMembershipsTable.cardId, cardId)))
    .returning({ cardId: cardSetMembershipsTable.cardId });
  if (res.length === 0) return { removed: false };
  invalidateActiveSetCardsCache();
  return { removed: true };
}

export async function moveCardBetweenSets(fromSetId: number, toSetId: number, cardId: number): Promise<void> {
  await db.delete(cardSetMembershipsTable)
    .where(and(eq(cardSetMembershipsTable.setId, fromSetId), eq(cardSetMembershipsTable.cardId, cardId)));
  await db.insert(cardSetMembershipsTable).values({ setId: toSetId, cardId }).onConflictDoNothing();
  invalidateActiveSetCardsCache();
}

/** Resolves names → ids leniently. Returns counts + any names not found.
 *  Uses a single bulk insert/delete instead of one round-trip per card. */
export async function bulkAddCardsToSet(
  setId: number, cardNames: string[],
): Promise<{ added: number; alreadyIn: number; notFound: string[] }> {
  const all = await getAllCards();
  const byName = new Map(all.map(c => [c.name.toLowerCase(), c]));
  const notFound: string[] = [];
  const cardIds: number[] = [];
  for (const raw of cardNames) {
    const card = byName.get(raw.toLowerCase().trim());
    if (!card) { notFound.push(raw); continue; }
    cardIds.push(card.id);
  }
  if (cardIds.length === 0) return { added: 0, alreadyIn: 0, notFound };

  // Find which cards are already in the set
  const existing = await db.select({ cardId: cardSetMembershipsTable.cardId })
    .from(cardSetMembershipsTable)
    .where(and(
      eq(cardSetMembershipsTable.setId, setId),
      inArray(cardSetMembershipsTable.cardId, cardIds),
    ));
  const alreadySet = new Set(existing.map(r => r.cardId));
  const toAdd = cardIds.filter(id => !alreadySet.has(id));
  if (toAdd.length > 0) {
    await db.insert(cardSetMembershipsTable).values(
      toAdd.map(id => ({ setId, cardId: id })),
    );
    invalidateActiveSetCardsCache();
  }
  return { added: toAdd.length, alreadyIn: alreadySet.size, notFound };
}

export async function bulkRemoveCardsFromSet(
  setId: number, cardNames: string[],
): Promise<{ removed: number; notInSet: number; notFound: string[] }> {
  const all = await getAllCards();
  const byName = new Map(all.map(c => [c.name.toLowerCase(), c]));
  const notFound: string[] = [];
  const cardIds: number[] = [];
  for (const raw of cardNames) {
    const card = byName.get(raw.toLowerCase().trim());
    if (!card) { notFound.push(raw); continue; }
    cardIds.push(card.id);
  }
  if (cardIds.length === 0) return { removed: 0, notInSet: 0, notFound };

  const res = await db.delete(cardSetMembershipsTable)
    .where(and(
      eq(cardSetMembershipsTable.setId, setId),
      inArray(cardSetMembershipsTable.cardId, cardIds),
    ))
    .returning({ cardId: cardSetMembershipsTable.cardId });
  const removedSet = new Set(res.map(r => r.cardId));
  const notInSet = cardIds.length - removedSet.size;
  if (removedSet.size > 0) invalidateActiveSetCardsCache();
  return { removed: removedSet.size, notInSet, notFound };
}

export async function getCardsInSet(setId: number): Promise<Card[]> {
  return db.select({
    id: cardsTable.id, name: cardsTable.name, description: cardsTable.description,
    rarity: cardsTable.rarity, cardType: cardsTable.cardType, dropWeight: cardsTable.dropWeight,
    worthValue: cardsTable.worthValue, burnValue: cardsTable.burnValue,
    isLimitedEdition: cardsTable.isLimitedEdition, isEventExclusive: cardsTable.isEventExclusive,
    maxCopies: cardsTable.maxCopies, totalMinted: cardsTable.totalMinted,
    imageUrl: cardsTable.imageUrl, flavor: cardsTable.flavor,
    droppable: cardsTable.droppable, inPacks: cardsTable.inPacks,
    isArchived: cardsTable.isArchived,
    podiumPlace: cardsTable.podiumPlace,
    previewAnimation: cardsTable.previewAnimation, previewBgColor: cardsTable.previewBgColor,
    displayOrientation: cardsTable.displayOrientation,
    createdAt: cardsTable.createdAt,
  }).from(cardsTable)
    .innerJoin(cardSetMembershipsTable, eq(cardSetMembershipsTable.cardId, cardsTable.id))
    .where(eq(cardSetMembershipsTable.setId, setId));
}

/**
 * Cards that aren't a member of ANY set. Used by `/setadmin exportall` so a
 * single export gives admins a full backup even if some cards were never
 * assigned to a set (common on Server 2 where the legacy roster pre-dates
 * the sets system).
 */
export async function getUnassignedCards(): Promise<Card[]> {
  return db.select({
    id: cardsTable.id, name: cardsTable.name, description: cardsTable.description,
    rarity: cardsTable.rarity, cardType: cardsTable.cardType, dropWeight: cardsTable.dropWeight,
    worthValue: cardsTable.worthValue, burnValue: cardsTable.burnValue,
    isLimitedEdition: cardsTable.isLimitedEdition, isEventExclusive: cardsTable.isEventExclusive,
    maxCopies: cardsTable.maxCopies, totalMinted: cardsTable.totalMinted,
    imageUrl: cardsTable.imageUrl, flavor: cardsTable.flavor,
    droppable: cardsTable.droppable, inPacks: cardsTable.inPacks,
    isArchived: cardsTable.isArchived,
    podiumPlace: cardsTable.podiumPlace,
    previewAnimation: cardsTable.previewAnimation, previewBgColor: cardsTable.previewBgColor,
    displayOrientation: cardsTable.displayOrientation,
    createdAt: cardsTable.createdAt,
  }).from(cardsTable)
    .leftJoin(cardSetMembershipsTable, eq(cardSetMembershipsTable.cardId, cardsTable.id))
    .where(isNull(cardSetMembershipsTable.cardId));
}

/** Returns true iff a card belongs to a given set. O(1) round-trip. */
export async function isCardInSet(setId: number, cardId: number): Promise<boolean> {
  const [row] = await db.select({ cardId: cardSetMembershipsTable.cardId })
    .from(cardSetMembershipsTable)
    .where(and(eq(cardSetMembershipsTable.setId, setId), eq(cardSetMembershipsTable.cardId, cardId)))
    .limit(1);
  return !!row;
}

/** List all sets with card counts. Sorted by largest first. */
export async function listSetsV2(): Promise<Array<{ set: CardSet; cardCount: number }>> {
  const rows = await db.select({
    id: setsTable.id, name: setsTable.name, description: setsTable.description,
    rarityWeights: setsTable.rarityWeights, awardsCompletion: setsTable.awardsCompletion,
    createdAt: setsTable.createdAt, updatedAt: setsTable.updatedAt,
    cardCount: sql<number>`coalesce(count(${cardSetMembershipsTable.cardId}), 0)::int`.as("card_count"),
  })
    .from(setsTable)
    .leftJoin(cardSetMembershipsTable, eq(cardSetMembershipsTable.setId, setsTable.id))
    .groupBy(setsTable.id);
  return rows
    .map(r => ({
      set: {
        id: r.id, name: r.name, description: r.description,
        rarityWeights: r.rarityWeights, awardsCompletion: r.awardsCompletion,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
      } satisfies CardSet,
      cardCount: Number(r.cardCount),
    }))
    .sort((a, b) => b.cardCount - a.cardCount || a.set.name.localeCompare(b.set.name));
}

// ── Active set per guild ─────────────────────────────────────────────────────
export async function setActiveSet(guildId: string, setId: number): Promise<void> {
  await getOrCreateGuildSettings(guildId);
  await db.update(guildSettingsTable)
    .set({ activeSetId: setId, updatedAt: new Date() })
    .where(eq(guildSettingsTable.guildId, guildId));
  invalidateActiveSetCardsCache(guildId);
}

export async function clearActiveSet(guildId: string): Promise<void> {
  await db.update(guildSettingsTable)
    .set({ activeSetId: null, updatedAt: new Date() })
    .where(eq(guildSettingsTable.guildId, guildId));
  invalidateActiveSetCardsCache(guildId);
}

export async function getActiveSet(guildId: string): Promise<CardSet | null> {
  const settings = await getOrCreateGuildSettings(guildId);
  if (!settings.activeSetId) return null;
  const set = await getSetById(settings.activeSetId);
  return set ?? null;
}

// Spawn-pool cache: which cards are eligible for random spawns in this guild
// right now, plus the active set's per-tier weight overrides (if any). 5s
// TTL like the cards cache. Empty pool when no active set is selected
// (Option B: nothing spawns until an admin picks one).
type ActiveSetSpawnPool = { cards: Card[]; rarityWeights: Record<string, number> | null };
const _activeSetCardsCache = new Map<string, { value: ActiveSetSpawnPool; expiresAt: number }>();
const ACTIVE_SET_CACHE_TTL_MS = 5_000;

export async function getActiveSetSpawnPoolCached(guildId: string): Promise<ActiveSetSpawnPool> {
  const cached = _activeSetCardsCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const settings = await getOrCreateGuildSettings(guildId);
  let pool: ActiveSetSpawnPool = { cards: [], rarityWeights: null };
  if (settings.activeSetId) {
    const [set, all] = await Promise.all([
      getSetById(settings.activeSetId),
      getCardsInSet(settings.activeSetId),
    ]);
    pool = {
      cards: all.filter(c => c.droppable && !c.isArchived),
      rarityWeights: set?.rarityWeights ?? null,
    };
  }
  _activeSetCardsCache.set(guildId, { value: pool, expiresAt: Date.now() + ACTIVE_SET_CACHE_TTL_MS });
  return pool;
}

// Per-set rarity-weight CRUD. Only the keys present in `weights` are kept;
// pass `null` to clear all overrides for the set. The cache is invalidated
// globally because we don't know which guild has this set active.
export async function setSetRarityWeights(
  setId: number,
  weights: Record<string, number> | null,
): Promise<CardSet | undefined> {
  const [row] = await db.update(setsTable)
    .set({ rarityWeights: weights, updatedAt: new Date() })
    .where(eq(setsTable.id, setId))
    .returning();
  invalidateActiveSetCardsCache();
  return row;
}

export async function patchSetRarityWeight(
  setId: number,
  rarity: string,
  weight: number | null,
): Promise<CardSet | undefined> {
  const existing = await getSetById(setId);
  if (!existing) return undefined;
  const next = { ...(existing.rarityWeights ?? {}) };
  if (weight == null) delete next[rarity];
  else next[rarity] = weight;
  const cleaned = Object.keys(next).length > 0 ? next : null;
  return setSetRarityWeights(setId, cleaned);
}

// P6: showcase toggle for set-completion achievements. Off by default.
export async function setSetAwardsCompletion(setId: number, enabled: boolean): Promise<CardSet | undefined> {
  const [row] = await db.update(setsTable)
    .set({ awardsCompletion: enabled, updatedAt: new Date() })
    .where(eq(setsTable.id, setId))
    .returning();
  return row;
}

// P6: return IDs of every set the user has fully completed (owns every
// membership card) in this guild. Non-empty sets only — empty sets can't be
// "completed". Shinies don't matter here; ownership = collections row exists.
export async function getCompletedSetIds(guildId: string, userId: string): Promise<number[]> {
  const rows = await db.execute(sql<{ set_id: number }>`
    SELECT m.set_id
    FROM ${cardSetMembershipsTable} m
    LEFT JOIN ${collectionsTable} c
      ON c.card_id = m.card_id
     AND c.guild_id = ${guildId}
     AND c.user_id = ${userId}
    GROUP BY m.set_id
    HAVING COUNT(DISTINCT m.card_id) > 0
       AND COUNT(DISTINCT m.card_id) = COUNT(DISTINCT c.card_id)
  `);
  // drizzle .execute returns { rows } for pg
  const list = (rows as any).rows ?? rows;
  return (list as Array<{ set_id: number }>).map(r => Number(r.set_id));
}

// P6: every set flagged with awardsCompletion = true (for dynamic showcase
// achievement generation). Tiny table, no need to cache.
export async function listShowcaseSets(): Promise<CardSet[]> {
  return db.select().from(setsTable).where(eq(setsTable.awardsCompletion, true));
}

export function invalidateActiveSetCardsCache(guildId?: string): void {
  if (guildId) _activeSetCardsCache.delete(guildId);
  else _activeSetCardsCache.clear();
}

// ── Guild Settings ────────────────────────────────────────────────────────────
export async function getOrCreateGuildSettings(guildId: string): Promise<GuildSettings> {
  const [row] = await db
    .select().from(guildSettingsTable)
    .where(eq(guildSettingsTable.guildId, guildId)).limit(1);
  if (row) return row;
  const [created] = await db.insert(guildSettingsTable).values({ guildId }).returning();
  return created;
}

export async function updateGuildSettings(guildId: string, values: Partial<GuildSettings>) {
  await db
    .update(guildSettingsTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(guildSettingsTable.guildId, guildId));
}

// ── Admin Users ───────────────────────────────────────────────────────────────
export async function isAdmin(guildId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: adminUsersTable.id })
    .from(adminUsersTable)
    .where(and(eq(adminUsersTable.guildId, guildId), eq(adminUsersTable.userId, userId)));
  return rows.length > 0;
}

export async function addAdmin(guildId: string, userId: string, addedBy: string) {
  await db.insert(adminUsersTable).values({ guildId, userId, addedBy }).onConflictDoNothing();
}

export async function removeAdmin(guildId: string, userId: string) {
  await db.delete(adminUsersTable)
    .where(and(eq(adminUsersTable.guildId, guildId), eq(adminUsersTable.userId, userId)));
}

export async function listAdmins(guildId: string) {
  return db.select().from(adminUsersTable).where(eq(adminUsersTable.guildId, guildId));
}

// ── User Catch Timeouts ───────────────────────────────────────────────────────
export async function setUserTimeout(
  guildId: string, userId: string, expiresAt: Date, issuedBy: string, reason?: string,
): Promise<void> {
  // Clear any existing timeout for this user, then insert the new one.
  await db.delete(userTimeoutsTable)
    .where(and(eq(userTimeoutsTable.guildId, guildId), eq(userTimeoutsTable.userId, userId)));
  await db.insert(userTimeoutsTable).values({
    guildId, userId, expiresAt, issuedBy, reason: reason ?? null,
  });
}

export async function clearUserTimeout(guildId: string, userId: string): Promise<void> {
  await db.delete(userTimeoutsTable)
    .where(and(eq(userTimeoutsTable.guildId, guildId), eq(userTimeoutsTable.userId, userId)));
}

/** Returns the active timeout row if the user is currently timed-out, else null. */
export async function getUserTimeout(guildId: string, userId: string) {
  const [row] = await db.select().from(userTimeoutsTable)
    .where(and(
      eq(userTimeoutsTable.guildId, guildId),
      eq(userTimeoutsTable.userId, userId),
      sql`${userTimeoutsTable.expiresAt} > NOW()`,
    ))
    .limit(1);
  return row ?? null;
}

/** All active (non-expired) timeouts in a guild. */
export async function listActiveTimeouts(guildId: string) {
  return db.select().from(userTimeoutsTable)
    .where(and(
      eq(userTimeoutsTable.guildId, guildId),
      sql`${userTimeoutsTable.expiresAt} > NOW()`,
    ))
    .orderBy(userTimeoutsTable.expiresAt);
}

// ── Cards ─────────────────────────────────────────────────────────────────────
let _allCardsCache: Card[] | null = null;
let _allCardsAt = 0;
const CARD_CACHE_TTL_MS = 5_000;

export async function getAllCards(): Promise<Card[]> {
  return db.select().from(cardsTable);
}

// Cached variant for the hot path (spawn embeds, catch embeds, decision buttons).
// 5s TTL keeps it fresh while eliminating repeated DB round-trips.
export async function getAllCardsCached(): Promise<Card[]> {
  const now = Date.now();
  if (_allCardsCache && _allCardsAt + CARD_CACHE_TTL_MS > now) return _allCardsCache;
  _allCardsCache = await getAllCards();
  _allCardsAt = now;
  return _allCardsCache;
}

export function invalidateCardCache(): void {
  _allCardsCache = null;
  _allCardsAt = 0;
}

export async function getCardByName(name: string): Promise<Card | undefined> {
  const [card] = await db
    .select().from(cardsTable)
    .where(sql`lower(${cardsTable.name}) = lower(${name})`);
  return card;
}

export async function getCardById(id: number): Promise<Card | undefined> {
  const [card] = await db.select().from(cardsTable).where(eq(cardsTable.id, id));
  return card;
}

export async function addCard(values: {
  name: string; description: string; rarity: string; cardType?: string;
  dropWeight: number; worthValue: number; burnValue: number;
  isLimitedEdition?: boolean; isEventExclusive?: boolean;
  maxCopies?: number; imageUrl?: string; flavor?: string; droppable?: boolean;
  inPacks?: boolean;
}) {
  const [card] = await db.insert(cardsTable).values(values as any).returning();
  await db.update(cardsTable).set({ totalMinted: 0 }).where(eq(cardsTable.id, card.id));
  invalidateCardCache();
  return card;
}

export async function removeCard(name: string) {
  const card = await getCardByName(name);
  if (!card) return;
  const id = card.id;
  await db.transaction(async (tx) => {
    await tx.delete(collectionsTable).where(eq(collectionsTable.cardId, id));
    await tx.delete(spawnLogTable).where(eq(spawnLogTable.cardId, id));
    await tx.delete(tradesTable).where(
      sql`${tradesTable.offeredCardId} = ${id} OR ${tradesTable.requestedCardId} = ${id}`,
    );
    await tx.delete(cardsTable).where(eq(cardsTable.id, id));
  });
  invalidateCardCache();
  invalidateActiveSetCardsCache();
}

export async function updateCard(cardId: number, values: Partial<{
  name: string; description: string; rarity: string; cardType: string;
  dropWeight: number; worthValue: number; burnValue: number;
  isLimitedEdition: boolean; isEventExclusive: boolean; isArchived: boolean; inPacks: boolean;
  maxCopies: number | null; imageUrl: string | null; flavor: string | null; droppable: boolean;
}>) {
  const [updated] = await db.update(cardsTable).set(values as any).where(eq(cardsTable.id, cardId)).returning();
  invalidateCardCache();
  // `droppable` / `isArchived` flips change whether this card belongs in any
  // guild's active-set spawn pool. Blow the per-guild cache so the next
  // spawn re-reads from DB. (Other fields don't affect membership but the
  // cache invalidation is cheap — a guard would be premature optimization.)
  invalidateActiveSetCardsCache();
  return updated;
}

// ── Weighted Random Card Pick (with optional guild rarity weight overrides) ────
// `eventBoosts` multiplies a card's effective weight when an active event
// targets it (see card_events). Applied AFTER the rarity-tier override so
// admins can boost a card above its tier's baseline without bumping the
// whole tier.
export async function pickRandomCard(
  rarityWeights?: Record<string, number>,
  eventBoosts?: Map<number, number>,
  ctx?: RarityContext,
  availableCards?: Card[],
  setRarityWeights?: Record<string, number> | null,
): Promise<Card | undefined> {
  // When the caller passes `availableCards`, trust it as-is (already filtered
  // — e.g. by guild active set). Otherwise fall back to the global droppable
  // pool. Spawn-manager always provides `availableCards` so Option B (no
  // active set → no spawns) is enforced before we even get here.
  let cards = availableCards ?? (await getAllCards()).filter(c => c.droppable && !c.isArchived);
  // Respect each custom tier's `droppable` flag — a card assigned to a
  // non-droppable custom tier is excluded from random spawns even if its own
  // column says droppable=true.
  cards = cards.filter(c => isRandomDroppable(c, ctx));
  if (cards.length === 0) return undefined;

  // Event boost multiplies whichever base wins so admins can still spike a
  // single card above its tier baseline. Note: set weights are read from a
  // PARTIAL map — keys the admin didn't override fall through.
  const getWeight = (card: Card) => getEffectiveDropWeight(card, {
    rarityWeights,
    eventBoosts,
    ctx,
    setRarityWeights,
  });

  const totalWeight = cards.reduce((sum, c) => sum + getWeight(c), 0);
  if (totalWeight <= 0) {
    logger.debug(
      { pool: cards.length, hasSetWeights: !!setRarityWeights },
      "pickRandomCard: total effective weight is 0 — no spawn this tick",
    );
    return undefined;
  }
  let rand = Math.random() * totalWeight;
  for (const card of cards) {
    rand -= getWeight(card);
    if (rand <= 0) return card;
  }
  return cards[cards.length - 1];
}

// ── Collections ───────────────────────────────────────────────────────────────
// Acquisition entry point for catches, pack opens, tradein rewards, and
// admin /give. Rolls Shiny once per copy unless `opts.noShiny` is set
// (admin /give skips the roll for predictability). The roll is bot-side
// before the DB write — caller sees the result and surfaces ✨ in the UI.
export async function catchCard(
  guildId: string, userId: string, cardId: number,
  opts?: { noShiny?: boolean },
): Promise<{ isShiny: boolean }> {
  const isShiny = !opts?.noShiny && Math.random() < SHINY_RATE;

  // Atomic upsert — the (guild_id, user_id, card_id) unique index makes this
  // race-safe so two simultaneous catches of the same card can never create
  // duplicate collection rows. We increment whichever counter applies; the
  // OTHER counter is left untouched via the column-default trick on insert
  // and an explicit set: shinyCount/count on conflict.
  if (isShiny) {
    await db.insert(collectionsTable)
      .values({ guildId, userId, cardId, count: 0, shinyCount: 1 })
      .onConflictDoUpdate({
        target: [collectionsTable.guildId, collectionsTable.userId, collectionsTable.cardId],
        set: {
          shinyCount: sql`${collectionsTable.shinyCount} + 1`,
          lastCaughtAt: new Date(),
        },
      });
  } else {
    await db.insert(collectionsTable)
      .values({ guildId, userId, cardId, count: 1 })
      .onConflictDoUpdate({
        target: [collectionsTable.guildId, collectionsTable.userId, collectionsTable.cardId],
        set: {
          count: sql`${collectionsTable.count} + 1`,
          lastCaughtAt: new Date(),
        },
      });
  }

  await db.update(cardsTable)
    .set({ totalMinted: sql`${cardsTable.totalMinted} + 1` })
    .where(eq(cardsTable.id, cardId));

  return { isShiny };
}

/**
 * Restore a card copy to a user's collection WITHOUT touching the global
 * `totalMinted` counter. Use this when refunding a card that was previously
 * removed by `removeCardFromUser` (e.g. a failed /tradein) — the card was
 * never destroyed from the world's perspective, so the mint count shouldn't
 * move. For genuine new mints (drops, packs, admin gives) use `catchCard`.
 */
export async function restoreCardToUser(guildId: string, userId: string, cardId: number) {
  await db.insert(collectionsTable)
    .values({ guildId, userId, cardId, count: 1 })
    .onConflictDoUpdate({
      target: [collectionsTable.guildId, collectionsTable.userId, collectionsTable.cardId],
      set: {
        count: sql`${collectionsTable.count} + 1`,
        lastCaughtAt: new Date(),
      },
    });
}

export async function removeCardFromUser(
  guildId: string, userId: string, cardId: number,
): Promise<{ success: boolean; remaining: number }> {
  const [entry] = await db.select().from(collectionsTable)
    .where(and(
      eq(collectionsTable.guildId, guildId),
      eq(collectionsTable.userId, userId),
      eq(collectionsTable.cardId, cardId),
    ));
  if (!entry || entry.count < 1) return { success: false, remaining: 0 };

  const newCount = entry.count - 1;
  // Only delete the row when BOTH piles are empty — otherwise we'd silently
  // erase the user's shinies for this card when their last normal copy goes
  // (tradein/takeback/etc. only consume the normal pile in v1).
  if (newCount === 0 && entry.shinyCount === 0) {
    await db.delete(collectionsTable).where(eq(collectionsTable.id, entry.id));
  } else {
    await db.update(collectionsTable).set({ count: newCount }).where(eq(collectionsTable.id, entry.id));
  }
  return { success: true, remaining: newCount };
}

export async function getUserCollection(guildId: string, userId: string) {
  const rows = await db.select({
    cardId: collectionsTable.cardId,
    count: collectionsTable.count,
    shinyCount: collectionsTable.shinyCount,
    firstCaughtAt: collectionsTable.firstCaughtAt,
    name: cardsTable.name,
    rarity: cardsTable.rarity,
    cardType: cardsTable.cardType,
    description: cardsTable.description,
    worthValue: cardsTable.worthValue,
    burnValue: cardsTable.burnValue,
    dropWeight: cardsTable.dropWeight,
    isLimitedEdition: cardsTable.isLimitedEdition,
    isEventExclusive: cardsTable.isEventExclusive,
    imageUrl: cardsTable.imageUrl,
  }).from(collectionsTable)
    .innerJoin(cardsTable, eq(collectionsTable.cardId, cardsTable.id))
    .where(and(
      eq(collectionsTable.guildId, guildId),
      eq(collectionsTable.userId, userId),
      // Hide rows that have been fully burned down to zero of both.
      sql`(${collectionsTable.count} + ${collectionsTable.shinyCount}) > 0`,
    ));
  // Apply the per-guild rarity context (Stage-1 profile + Stage-2 custom
  // tiers) so worth/burn shown in /collection, /rank, /catalog, leaderboard
  // net worth, etc. all reflect server overrides AND custom-tier overrides.
  const ctx = await getRarityContext(guildId);
  const enriched = rows.map(r => ({ ...r, id: r.cardId })) as Array<typeof rows[number] & { id: number }>;
  return applyRarityContextAll(enriched, ctx);
}

export async function getUserCardCount(guildId: string, userId: string): Promise<{ unique: number; total: number; netWorth: number }> {
  const items = await getUserCollection(guildId, userId);
  return {
    unique: items.length,
    total: items.reduce((s, i) => s + i.count + i.shinyCount, 0),
    netWorth: items.reduce(
      (s, i) => s + i.worthValue * (i.count + i.shinyCount * SHINY_MULTIPLIER),
      0,
    ),
  };
}

export async function getCollectionEntry(guildId: string, userId: string, cardId: number) {
  const [row] = await db.select().from(collectionsTable)
    .where(and(
      eq(collectionsTable.guildId, guildId),
      eq(collectionsTable.userId, userId),
      eq(collectionsTable.cardId, cardId),
    ));
  return row;
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
// Computes per-user totals with rarity-profile overrides applied. We pull
// per-(user,card) rows and group in JS so that worth uses the profile's
// override when present (per-rarity), falling back to the card's own value.
// Dataset is small (one row per held card per user per guild).
export async function getLeaderboard(guildId: string, sortBy: "worth" | "cards" = "worth", limit = 10) {
  const rows = await db.select({
    userId: collectionsTable.userId,
    rarity: cardsTable.rarity,
    worthValue: cardsTable.worthValue,
    count: collectionsTable.count,
    shinyCount: collectionsTable.shinyCount,
    cardId: collectionsTable.cardId,
  })
    .from(collectionsTable)
    .innerJoin(cardsTable, eq(collectionsTable.cardId, cardsTable.id))
    .where(eq(collectionsTable.guildId, guildId));

  const ctx = await getRarityContext(guildId);
  type Agg = { userId: string; totalCards: number; uniqueCards: number; netWorth: number };
  const byUser = new Map<string, Agg>();
  for (const r of rows) {
    // Custom-tier worth replaces the card's worth entirely; otherwise fall
    // back to the Stage-1 profile, then the card's own worth.
    const customTier = ctx.customByCard.get(r.cardId);
    const worth = customTier
      ? customTier.worthValue
      : (ctx.profile.get(r.rarity as Rarity)?.worthValue ?? r.worthValue);
    let a = byUser.get(r.userId);
    if (!a) { a = { userId: r.userId, totalCards: 0, uniqueCards: 0, netWorth: 0 }; byUser.set(r.userId, a); }
    a.totalCards += r.count + r.shinyCount;
    a.uniqueCards += 1; // one row per (user,card)
    a.netWorth += (r.count + r.shinyCount * SHINY_MULTIPLIER) * worth;
  }
  const sorted = [...byUser.values()].sort((a, b) =>
    sortBy === "cards" ? b.totalCards - a.totalCards : b.netWorth - a.netWorth,
  );
  return sorted.slice(0, limit);
}

// Lifetime pack openers per guild (sorted desc). Used by /top.
export async function getTopPackOpeners(guildId: string, limit = 5) {
  return db.select({
    userId: userCurrencyTable.userId,
    packsOpened: userCurrencyTable.packsOpened,
  })
    .from(userCurrencyTable)
    .where(and(eq(userCurrencyTable.guildId, guildId), sql`${userCurrencyTable.packsOpened} > 0`))
    .orderBy(sql`${userCurrencyTable.packsOpened} desc`)
    .limit(limit);
}

// ── Currency (DN Shards) ──────────────────────────────────────────────────────
export async function getOrCreateCurrency(guildId: string, userId: string) {
  const [row] = await db.select().from(userCurrencyTable)
    .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)));
  if (row) return row;
  const [created] = await db.insert(userCurrencyTable).values({ guildId, userId }).returning();
  return created;
}

// Atomic: never lose increments under concurrent callers.
export async function addShards(guildId: string, userId: string, amount: number) {
  await getOrCreateCurrency(guildId, userId);
  const earnedDelta = Math.max(0, amount);
  await db.update(userCurrencyTable)
    .set({
      shards: sql`${userCurrencyTable.shards} + ${amount}`,
      totalEarned: sql`${userCurrencyTable.totalEarned} + ${earnedDelta}`,
      updatedAt: new Date(),
    })
    .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)));
}

// Atomic: never goes below 0 even under concurrency.
export async function deductShards(guildId: string, userId: string, amount: number): Promise<{ success: boolean; remaining: number }> {
  await getOrCreateCurrency(guildId, userId);
  const [row] = await db.update(userCurrencyTable)
    .set({
      shards: sql`GREATEST(0, ${userCurrencyTable.shards} - ${amount})`,
      updatedAt: new Date(),
    })
    .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)))
    .returning({ shards: userCurrencyTable.shards });
  if (!row) return { success: false, remaining: 0 };
  return { success: row.shards >= 0, remaining: row.shards };
}

// Atomic: only deducts if balance >= amount. Returns false if insufficient.
export async function spendShards(guildId: string, userId: string, amount: number): Promise<boolean> {
  await getOrCreateCurrency(guildId, userId);
  const rows = await db.update(userCurrencyTable)
    .set({
      shards: sql`${userCurrencyTable.shards} - ${amount}`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(userCurrencyTable.guildId, guildId),
      eq(userCurrencyTable.userId, userId),
      sql`${userCurrencyTable.shards} >= ${amount}`,
    ))
    .returning({ id: userCurrencyTable.id });
  return rows.length > 0;
}

// Atomic refund — credit shards back without affecting totalEarned.
export async function refundShards(guildId: string, userId: string, amount: number) {
  await getOrCreateCurrency(guildId, userId);
  await db.update(userCurrencyTable)
    .set({
      shards: sql`${userCurrencyTable.shards} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)));
}

// ── Burn a card ───────────────────────────────────────────────────────────────
export async function incrementCardsBurned(guildId: string, userId: string, by: number = 1) {
  await getOrCreateCurrency(guildId, userId);
  await db.update(userCurrencyTable)
    .set({ cardsBurned: sql`${userCurrencyTable.cardsBurned} + ${by}` })
    .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)));
}

export async function getUserOwnedCount(
  guildId: string, userId: string, cardId: number,
): Promise<{ count: number; shinyCount: number }> {
  const [row] = await db.select({
    count: collectionsTable.count,
    shinyCount: collectionsTable.shinyCount,
  })
    .from(collectionsTable)
    .where(and(
      eq(collectionsTable.guildId, guildId),
      eq(collectionsTable.userId, userId),
      eq(collectionsTable.cardId, cardId),
    ));
  return { count: row?.count ?? 0, shinyCount: row?.shinyCount ?? 0 };
}

// Burns from the `count` column by default, or the `shinyCount` column when
// `opts.shiny` is set. Atomic: one concurrent burn wins the row. Shiny burns
// pay SHINY_MULTIPLIER × burnValue per copy. `remaining` is of the chosen
// pile (normal or shiny).
export async function burnCard(
  guildId: string, userId: string, cardId: number, amount: number = 1,
  opts?: { shiny?: boolean },
): Promise<{ success: boolean; burned: number; shardsGained: number; remaining: number; isShiny: boolean }> {
  if (amount < 1) return { success: false, burned: 0, shardsGained: 0, remaining: 0, isShiny: !!opts?.shiny };
  const [card] = await db.select({ burnValue: cardsTable.burnValue, rarity: cardsTable.rarity })
    .from(cardsTable).where(eq(cardsTable.id, cardId));
  if (!card) return { success: false, burned: 0, shardsGained: 0, remaining: 0, isShiny: !!opts?.shiny };
  // Per-guild rarity context may override the card's burnValue, either via
  // a Stage-2 custom tier (replaces) or a Stage-1 profile (per built-in tier).
  const ctx = await getRarityContext(guildId);
  const customTier = ctx.customByCard.get(cardId);
  const effectiveBurnValue = customTier
    ? customTier.burnValue
    : (ctx.profile.get(card.rarity as Rarity)?.burnValue ?? card.burnValue);

  const burningShiny = !!opts?.shiny;
  const targetCol = burningShiny ? collectionsTable.shinyCount : collectionsTable.count;

  const updated = await db.update(collectionsTable)
    .set(burningShiny
      ? { shinyCount: sql`${collectionsTable.shinyCount} - ${amount}` }
      : { count: sql`${collectionsTable.count} - ${amount}` })
    .where(and(
      eq(collectionsTable.guildId, guildId),
      eq(collectionsTable.userId, userId),
      eq(collectionsTable.cardId, cardId),
      sql`${targetCol} >= ${amount}`,
    ))
    .returning({
      id: collectionsTable.id,
      count: collectionsTable.count,
      shinyCount: collectionsTable.shinyCount,
    });
  if (updated.length === 0) return { success: false, burned: 0, shardsGained: 0, remaining: 0, isShiny: burningShiny };

  const row = updated[0]!;
  // Only delete the row when BOTH counters are zero — a user may have burned
  // their last normal copy but still own a shiny (or vice versa).
  if (row.count === 0 && row.shinyCount === 0) {
    await db.delete(collectionsTable).where(eq(collectionsTable.id, row.id));
  }
  const perCard = effectiveBurnValue * (burningShiny ? SHINY_MULTIPLIER : 1);
  const shardsGained = perCard * amount;
  await addShards(guildId, userId, shardsGained);
  await incrementCardsBurned(guildId, userId, amount);
  const remaining = burningShiny ? row.shinyCount : row.count;
  return { success: true, burned: amount, shardsGained, remaining, isShiny: burningShiny };
}

// ── Trades ────────────────────────────────────────────────────────────────────
export async function createTrade(args: {
  guildId: string;
  initiatorId: string;
  targetId: string;
  offeredCardId?: number | null;
  requestedCardId?: number | null;
  offeredShards?: number;
  requestedShards?: number;
  channelId: string;
  messageId?: string;
}) {
  const [trade] = await db.insert(tradesTable).values({
    guildId: args.guildId,
    initiatorId: args.initiatorId,
    targetId: args.targetId,
    offeredCardId: args.offeredCardId ?? null,
    requestedCardId: args.requestedCardId ?? null,
    offeredShards: args.offeredShards ?? 0,
    requestedShards: args.requestedShards ?? 0,
    channelId: args.channelId,
    messageId: args.messageId,
  }).returning();
  return trade;
}

export async function getTrade(tradeId: number): Promise<Trade | undefined> {
  const [row] = await db.select().from(tradesTable).where(eq(tradesTable.id, tradeId));
  return row;
}

export async function updateTradeStatus(tradeId: number, status: "accepted" | "declined" | "cancelled" | "expired") {
  await db.update(tradesTable)
    .set({ status, resolvedAt: new Date() })
    .where(eq(tradesTable.id, tradeId));
}

export async function updateTradeMessageId(tradeId: number, messageId: string) {
  await db.update(tradesTable).set({ messageId }).where(eq(tradesTable.id, tradeId));
}

export async function getPendingTradesFor(guildId: string, userId: string) {
  return db.select({
    id: tradesTable.id,
    initiatorId: tradesTable.initiatorId,
    targetId: tradesTable.targetId,
    offeredCardName: sql<string | null>`offered.name`,
    requestedCardName: sql<string | null>`requested.name`,
    offeredShards: tradesTable.offeredShards,
    requestedShards: tradesTable.requestedShards,
    createdAt: tradesTable.createdAt,
  })
    .from(tradesTable)
    .leftJoin(sql`${cardsTable} offered`, sql`offered.id = ${tradesTable.offeredCardId}`)
    .leftJoin(sql`${cardsTable} requested`, sql`requested.id = ${tradesTable.requestedCardId}`)
    .where(and(
      eq(tradesTable.guildId, guildId),
      eq(tradesTable.status, "pending"),
      sql`(${tradesTable.initiatorId} = ${userId} OR ${tradesTable.targetId} = ${userId})`,
    ))
    .orderBy(desc(tradesTable.createdAt))
    .limit(10);
}

// ── Trade history (resolved trades involving a user) ────────────────────────
// Returns the most recent `limit` trades where the user was either the
// initiator or the target and the trade is no longer pending. Joined twice
// against cards for offered/requested names.
export async function getTradeHistoryFor(guildId: string, userId: string, limit = 10) {
  return db.select({
    id: tradesTable.id,
    initiatorId: tradesTable.initiatorId,
    targetId: tradesTable.targetId,
    offeredCardName: sql<string | null>`offered.name`,
    requestedCardName: sql<string | null>`requested.name`,
    offeredShards: tradesTable.offeredShards,
    requestedShards: tradesTable.requestedShards,
    status: tradesTable.status,
    createdAt: tradesTable.createdAt,
    resolvedAt: tradesTable.resolvedAt,
  })
    .from(tradesTable)
    .leftJoin(sql`${cardsTable} offered`, sql`offered.id = ${tradesTable.offeredCardId}`)
    .leftJoin(sql`${cardsTable} requested`, sql`requested.id = ${tradesTable.requestedCardId}`)
    .where(and(
      eq(tradesTable.guildId, guildId),
      sql`${tradesTable.status} <> 'pending'`,
      sql`(${tradesTable.initiatorId} = ${userId} OR ${tradesTable.targetId} = ${userId})`,
    ))
    // NULLS LAST so legacy rows without resolvedAt don't bubble to the top
    // of "recent resolved" history; ties fall back to createdAt.
    .orderBy(sql`${tradesTable.resolvedAt} DESC NULLS LAST`, desc(tradesTable.createdAt))
    .limit(limit);
}

// ── Gift shards (atomic transfer) ────────────────────────────────────────────
export async function giftShards(
  guildId: string, fromUserId: string, toUserId: string, amount: number,
): Promise<{ success: boolean; remaining: number }> {
  if (amount <= 0) {
    const cur = await getOrCreateCurrency(guildId, fromUserId);
    return { success: false, remaining: cur.shards };
  }
  // Ensure both currency rows exist BEFORE entering the transaction so the
  // upsert side-effect doesn't get rolled back on a debit failure.
  await getOrCreateCurrency(guildId, fromUserId);
  await getOrCreateCurrency(guildId, toUserId);

  const success = await db.transaction(async (tx) => {
    const debited = await tx.update(userCurrencyTable)
      .set({
        shards: sql`${userCurrencyTable.shards} - ${amount}`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(userCurrencyTable.guildId, guildId),
        eq(userCurrencyTable.userId, fromUserId),
        sql`${userCurrencyTable.shards} >= ${amount}`,
      ))
      .returning({ id: userCurrencyTable.id });
    if (debited.length === 0) {
      // Transaction rolls back automatically — sender keeps their shards.
      throw new Error("insufficient_shards");
    }
    await tx.update(userCurrencyTable)
      .set({
        shards: sql`${userCurrencyTable.shards} + ${amount}`,
        totalEarned: sql`${userCurrencyTable.totalEarned} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(userCurrencyTable.guildId, guildId),
        eq(userCurrencyTable.userId, toUserId),
      ));
    return true;
  }).catch((err) => {
    if (err instanceof Error && err.message === "insufficient_shards") return false;
    throw err;
  });

  const cur = await getOrCreateCurrency(guildId, fromUserId);
  return { success, remaining: cur.shards };
}

export type TradeSwapResult = "ok" | "balance_failed" | "already_resolved";

export async function executeTradeSwap(trade: Trade): Promise<TradeSwapResult> {
  // Guard: trades created before validation tightening may carry negatives.
  if (trade.offeredShards < 0 || trade.requestedShards < 0) return "balance_failed";

  // Pre-create currency rows so the on-conflict upsert can't be rolled back
  // alongside the swap. Inside the txn we use atomic conditional UPDATEs so
  // concurrent accepts/burns can't lead to double-spend.
  if (trade.offeredShards > 0) await getOrCreateCurrency(trade.guildId, trade.initiatorId);
  if (trade.requestedShards > 0) await getOrCreateCurrency(trade.guildId, trade.targetId);
  if (trade.requestedCardId) await getOrCreateCurrency(trade.guildId, trade.initiatorId);
  if (trade.offeredCardId) await getOrCreateCurrency(trade.guildId, trade.targetId);

  return await db.transaction(async (tx) => {
    // 0) Atomic status claim — only one concurrent accept can transition
    //    pending→accepted. Prevents double-execution when a user has ≥2
    //    copies of the offered card (atomic count debits would otherwise
    //    BOTH succeed and the recipient would receive two copies).
    const claimed = await tx.update(tradesTable)
      .set({ status: "accepted", resolvedAt: new Date() })
      .where(and(eq(tradesTable.id, trade.id), eq(tradesTable.status, "pending")))
      .returning({ id: tradesTable.id });
    if (claimed.length === 0) throw new Error("trade_already_resolved");

    // 1) Atomic card debits — single SQL per side ensures only one concurrent
    //    trade can claim the last copy.
    if (trade.offeredCardId) {
      const dec = await tx.update(collectionsTable)
        .set({ count: sql`${collectionsTable.count} - 1` })
        .where(and(
          eq(collectionsTable.guildId, trade.guildId),
          eq(collectionsTable.userId, trade.initiatorId),
          eq(collectionsTable.cardId, trade.offeredCardId),
          sql`${collectionsTable.count} >= 1`,
        ))
        .returning({ id: collectionsTable.id, newCount: collectionsTable.count, shinyCount: collectionsTable.shinyCount });
      if (dec.length === 0) throw new Error("initiator_lacks_card");
      // Preserve shiny inventory: only drop the row when both piles are empty.
      if (dec[0]!.newCount === 0 && dec[0]!.shinyCount === 0) {
        await tx.delete(collectionsTable).where(eq(collectionsTable.id, dec[0]!.id));
      }
    }
    if (trade.requestedCardId) {
      const dec = await tx.update(collectionsTable)
        .set({ count: sql`${collectionsTable.count} - 1` })
        .where(and(
          eq(collectionsTable.guildId, trade.guildId),
          eq(collectionsTable.userId, trade.targetId),
          eq(collectionsTable.cardId, trade.requestedCardId),
          sql`${collectionsTable.count} >= 1`,
        ))
        .returning({ id: collectionsTable.id, newCount: collectionsTable.count, shinyCount: collectionsTable.shinyCount });
      if (dec.length === 0) throw new Error("target_lacks_card");
      if (dec[0]!.newCount === 0 && dec[0]!.shinyCount === 0) {
        await tx.delete(collectionsTable).where(eq(collectionsTable.id, dec[0]!.id));
      }
    }

    // 2) Atomic shard debits.
    if (trade.offeredShards > 0) {
      const debit = await tx.update(userCurrencyTable)
        .set({ shards: sql`${userCurrencyTable.shards} - ${trade.offeredShards}`, updatedAt: new Date() })
        .where(and(
          eq(userCurrencyTable.guildId, trade.guildId),
          eq(userCurrencyTable.userId, trade.initiatorId),
          sql`${userCurrencyTable.shards} >= ${trade.offeredShards}`,
        ))
        .returning({ id: userCurrencyTable.id });
      if (debit.length === 0) throw new Error("initiator_lacks_shards");
    }
    if (trade.requestedShards > 0) {
      const debit = await tx.update(userCurrencyTable)
        .set({ shards: sql`${userCurrencyTable.shards} - ${trade.requestedShards}`, updatedAt: new Date() })
        .where(and(
          eq(userCurrencyTable.guildId, trade.guildId),
          eq(userCurrencyTable.userId, trade.targetId),
          sql`${userCurrencyTable.shards} >= ${trade.requestedShards}`,
        ))
        .returning({ id: userCurrencyTable.id });
      if (debit.length === 0) throw new Error("target_lacks_shards");
    }

    // 3) Card credits — trades are MOVES, not new mints, so do not bump
    //    cardsTable.totalMinted (otherwise limited-editions would deplete
    //    on every trade). Mirrors restoreCardToUser semantics.
    if (trade.requestedCardId) await restoreCardToUserTx(tx, trade.guildId, trade.initiatorId, trade.requestedCardId);
    if (trade.offeredCardId) await restoreCardToUserTx(tx, trade.guildId, trade.targetId, trade.offeredCardId);

    // 4) Shard credits — bump totalEarned alongside shards so the
    //    leaderboard / lifetime-earned stat reflects trade income.
    if (trade.requestedShards > 0) {
      await tx.update(userCurrencyTable)
        .set({
          shards: sql`${userCurrencyTable.shards} + ${trade.requestedShards}`,
          totalEarned: sql`${userCurrencyTable.totalEarned} + ${trade.requestedShards}`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(userCurrencyTable.guildId, trade.guildId),
          eq(userCurrencyTable.userId, trade.initiatorId),
        ));
    }
    if (trade.offeredShards > 0) {
      await tx.update(userCurrencyTable)
        .set({
          shards: sql`${userCurrencyTable.shards} + ${trade.offeredShards}`,
          totalEarned: sql`${userCurrencyTable.totalEarned} + ${trade.offeredShards}`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(userCurrencyTable.guildId, trade.guildId),
          eq(userCurrencyTable.userId, trade.targetId),
        ));
    }

    return "ok" as const;
  }).catch((err): TradeSwapResult => {
    if (err instanceof Error && err.message === "trade_already_resolved") return "already_resolved";
    if (err instanceof Error && [
      "initiator_lacks_card", "target_lacks_card",
      "initiator_lacks_shards", "target_lacks_shards",
    ].includes(err.message)) return "balance_failed";
    logger.error({ err, tradeId: trade.id }, "executeTradeSwap failed");
    return "balance_failed";
  });
}

// Transaction-safe variant of restoreCardToUser — credits one copy to the
// user's collection WITHOUT touching cardsTable.totalMinted. Used by trade
// swaps, which are moves (no new card is minted into the world).
async function restoreCardToUserTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  guildId: string, userId: string, cardId: number,
) {
  await tx.insert(collectionsTable)
    .values({ guildId, userId, cardId, count: 1 })
    .onConflictDoUpdate({
      target: [collectionsTable.guildId, collectionsTable.userId, collectionsTable.cardId],
      set: {
        count: sql`${collectionsTable.count} + 1`,
        lastCaughtAt: new Date(),
      },
    });
}

// ── Spawn Log ─────────────────────────────────────────────────────────────────
export async function logSpawn(guildId: string, channelId: string, cardId: number, isForced: boolean) {
  const [row] = await db.insert(spawnLogTable)
    .values({ guildId, channelId, cardId, isForced }).returning();
  return row;
}

export async function markCaught(spawnId: number, userId: string) {
  await db.update(spawnLogTable)
    .set({ caughtBy: userId, caughtAt: new Date() })
    .where(eq(spawnLogTable.id, spawnId));
}

// ── Wishlists ─────────────────────────────────────────────────────────────────
export async function addWishlist(guildId: string, userId: string, cardId: number): Promise<boolean> {
  const inserted = await db.insert(wishlistsTable)
    .values({ guildId, userId, cardId })
    .onConflictDoNothing()
    .returning({ id: wishlistsTable.id });
  return inserted.length > 0;
}

export async function removeWishlist(guildId: string, userId: string, cardId: number): Promise<boolean> {
  const deleted = await db.delete(wishlistsTable)
    .where(and(
      eq(wishlistsTable.guildId, guildId),
      eq(wishlistsTable.userId, userId),
      eq(wishlistsTable.cardId, cardId),
    ))
    .returning({ id: wishlistsTable.id });
  return deleted.length > 0;
}

export async function getUserWishlist(
  guildId: string, userId: string,
): Promise<Array<{ cardId: number; name: string; rarity: string; worthValue: number }>> {
  const rows = await db.select({
    cardId: cardsTable.id,
    name: cardsTable.name,
    rarity: cardsTable.rarity,
    worthValue: cardsTable.worthValue,
  })
    .from(wishlistsTable)
    .innerJoin(cardsTable, eq(cardsTable.id, wishlistsTable.cardId))
    .where(and(eq(wishlistsTable.guildId, guildId), eq(wishlistsTable.userId, userId)))
    .orderBy(desc(cardsTable.worthValue));
  return rows;
}

export async function getCardWishlisters(guildId: string, cardId: number): Promise<string[]> {
  const rows = await db.select({ userId: wishlistsTable.userId })
    .from(wishlistsTable)
    .where(and(eq(wishlistsTable.guildId, guildId), eq(wishlistsTable.cardId, cardId)));
  return rows.map(r => r.userId);
}

// ── Card Events (limited-time spawn boosts) ──────────────────────────────────
export async function createCardEvent(args: {
  guildId: string; cardId: number; weightMultiplier: number;
  endsAt: Date; createdBy: string;
}): Promise<CardEvent> {
  const [row] = await db.insert(cardEventsTable).values({
    guildId: args.guildId,
    cardId: args.cardId,
    weightMultiplier: args.weightMultiplier,
    endsAt: args.endsAt,
    createdBy: args.createdBy,
  }).returning();
  return row;
}

export async function listActiveCardEvents(guildId: string): Promise<Array<CardEvent & { cardName: string }>> {
  const rows = await db.select({
    id: cardEventsTable.id,
    guildId: cardEventsTable.guildId,
    cardId: cardEventsTable.cardId,
    weightMultiplier: cardEventsTable.weightMultiplier,
    startsAt: cardEventsTable.startsAt,
    endsAt: cardEventsTable.endsAt,
    createdBy: cardEventsTable.createdBy,
    createdAt: cardEventsTable.createdAt,
    cardName: cardsTable.name,
  })
    .from(cardEventsTable)
    .innerJoin(cardsTable, eq(cardsTable.id, cardEventsTable.cardId))
    .where(and(
      eq(cardEventsTable.guildId, guildId),
      sql`${cardEventsTable.endsAt} > NOW()`,
      sql`${cardEventsTable.startsAt} <= NOW()`,
    ))
    .orderBy(cardEventsTable.endsAt);
  return rows;
}

// Combined multiplier per card — if two events stack on the same card, the
// effective boost is the product. Used by spawn-manager before pickRandomCard.
export async function getActiveEventBoosts(guildId: string): Promise<Map<number, number>> {
  const events = await listActiveCardEvents(guildId);
  const boosts = new Map<number, number>();
  for (const e of events) {
    boosts.set(e.cardId, (boosts.get(e.cardId) ?? 1) * e.weightMultiplier);
  }
  return boosts;
}

// Stops an event by setting endsAt to NOW. Returns the row + card name if
// the caller owns it (same guild) and it was still active, else null.
export async function stopCardEvent(
  guildId: string, eventId: number,
): Promise<(CardEvent & { cardName: string }) | null> {
  const rows = await db.update(cardEventsTable)
    .set({ endsAt: new Date() })
    .where(and(
      eq(cardEventsTable.id, eventId),
      eq(cardEventsTable.guildId, guildId),
      sql`${cardEventsTable.endsAt} > NOW()`,
    ))
    .returning();
  const row = rows[0];
  if (!row) return null;
  const [card] = await db.select({ name: cardsTable.name })
    .from(cardsTable).where(eq(cardsTable.id, row.cardId));
  return { ...row, cardName: card?.name ?? `card #${row.cardId}` };
}

// ── Rarity admin writes (Discord = source of truth for gameplay) ─────────────
// These helpers exist so Discord slash commands can manage rarity_profiles,
// custom_rarities, and card_rarity_overrides. The website is intentionally
// read-only against these tables; do NOT call these from any HTTP route.

export async function upsertRarityProfile(
  guildId: string,
  rarity: Rarity,
  patch: { worthValue?: number | null; burnValue?: number | null; dropWeight?: number | null; updatedBy?: string },
): Promise<RarityProfile> {
  const insertValues = {
    guildId,
    rarity,
    worthValue: patch.worthValue ?? null,
    burnValue: patch.burnValue ?? null,
    dropWeight: patch.dropWeight ?? null,
    updatedBy: patch.updatedBy ?? null,
  };
  const setOnConflict: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.worthValue !== undefined) setOnConflict.worthValue = patch.worthValue;
  if (patch.burnValue !== undefined) setOnConflict.burnValue = patch.burnValue;
  if (patch.dropWeight !== undefined) setOnConflict.dropWeight = patch.dropWeight;
  if (patch.updatedBy !== undefined) setOnConflict.updatedBy = patch.updatedBy;
  const [row] = await db.insert(rarityProfilesTable)
    .values(insertValues)
    .onConflictDoUpdate({ target: [rarityProfilesTable.guildId, rarityProfilesTable.rarity], set: setOnConflict })
    .returning();
  invalidateRarityProfileCache(guildId);
  invalidateRarityContextCache(guildId);
  invalidateCardCache();
  return row;
}

export async function deleteRarityProfile(guildId: string, rarity: Rarity): Promise<boolean> {
  const res = await db.delete(rarityProfilesTable)
    .where(and(eq(rarityProfilesTable.guildId, guildId), eq(rarityProfilesTable.rarity, rarity)))
    .returning({ id: rarityProfilesTable.id });
  invalidateRarityProfileCache(guildId);
  invalidateRarityContextCache(guildId);
  invalidateCardCache();
  return res.length > 0;
}

export async function listRarityProfiles(guildId: string): Promise<RarityProfile[]> {
  return db.select().from(rarityProfilesTable).where(eq(rarityProfilesTable.guildId, guildId));
}

export async function createCustomRarity(
  guildId: string,
  data: {
    slug: string; name: string; emoji: string; position: number;
    worthValue: number; burnValue: number;
    color?: number; dropWeight?: number; droppable?: boolean; inPacks?: boolean;
    updatedBy?: string;
  },
): Promise<CustomRarity> {
  const [row] = await db.insert(customRaritiesTable).values({
    guildId,
    slug: data.slug,
    name: data.name,
    emoji: data.emoji,
    position: data.position,
    worthValue: data.worthValue,
    burnValue: data.burnValue,
    color: data.color ?? 0x5865f2,
    dropWeight: data.dropWeight ?? 1.0,
    droppable: data.droppable ?? true,
    inPacks: data.inPacks ?? false,
    updatedBy: data.updatedBy ?? null,
  }).returning();
  invalidateRarityContextCache(guildId);
  invalidateCardCache();
  return row;
}

export async function updateCustomRarity(
  guildId: string,
  slug: string,
  patch: Partial<{
    name: string; emoji: string; position: number; worthValue: number; burnValue: number;
    color: number; dropWeight: number; droppable: boolean; inPacks: boolean; updatedBy: string;
  }>,
): Promise<CustomRarity | null> {
  if (Object.keys(patch).length === 0) {
    const [existing] = await db.select().from(customRaritiesTable)
      .where(and(eq(customRaritiesTable.guildId, guildId), eq(customRaritiesTable.slug, slug)));
    return existing ?? null;
  }
  const [row] = await db.update(customRaritiesTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(customRaritiesTable.guildId, guildId), eq(customRaritiesTable.slug, slug)))
    .returning();
  invalidateRarityContextCache(guildId);
  invalidateCardCache();
  return row ?? null;
}

export async function deleteCustomRarity(guildId: string, slug: string): Promise<{ removed: boolean; clearedAssignments: number }> {
  const cleared = await db.delete(cardRarityOverridesTable)
    .where(and(eq(cardRarityOverridesTable.guildId, guildId), eq(cardRarityOverridesTable.customRaritySlug, slug)))
    .returning({ id: cardRarityOverridesTable.id });
  const res = await db.delete(customRaritiesTable)
    .where(and(eq(customRaritiesTable.guildId, guildId), eq(customRaritiesTable.slug, slug)))
    .returning({ id: customRaritiesTable.id });
  invalidateRarityContextCache(guildId);
  invalidateCardCache();
  return { removed: res.length > 0, clearedAssignments: cleared.length };
}

export async function listCustomRarities(guildId: string): Promise<CustomRarity[]> {
  const rows = await db.select().from(customRaritiesTable).where(eq(customRaritiesTable.guildId, guildId));
  return rows.sort((a, b) => a.position - b.position);
}

export async function getCustomRarityBySlug(guildId: string, slug: string): Promise<CustomRarity | null> {
  const [row] = await db.select().from(customRaritiesTable)
    .where(and(eq(customRaritiesTable.guildId, guildId), eq(customRaritiesTable.slug, slug)));
  return row ?? null;
}

export async function assignCardToCustomRarity(guildId: string, cardId: number, slug: string): Promise<void> {
  await db.insert(cardRarityOverridesTable)
    .values({ guildId, cardId, customRaritySlug: slug })
    .onConflictDoUpdate({
      target: [cardRarityOverridesTable.guildId, cardRarityOverridesTable.cardId],
      set: { customRaritySlug: slug },
    });
  invalidateRarityContextCache(guildId);
  invalidateCardCache();
}

export async function unassignCardCustomRarity(guildId: string, cardId: number): Promise<boolean> {
  const res = await db.delete(cardRarityOverridesTable)
    .where(and(eq(cardRarityOverridesTable.guildId, guildId), eq(cardRarityOverridesTable.cardId, cardId)))
    .returning({ id: cardRarityOverridesTable.id });
  invalidateRarityContextCache(guildId);
  invalidateCardCache();
  return res.length > 0;
}
