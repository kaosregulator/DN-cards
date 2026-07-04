import { Router, type IRouter, type Response } from "express";
import { db, cardsTable, cardDisplayOverridesTable, upsertCardDisplayOverrideSchema, setsTable, cardSetMembershipsTable, cardRarityOverridesTable, customRaritiesTable, rarityDisplayOverridesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireDashboardAuth } from "../middlewares/dashboard-auth.js";
import { invalidateCardCache } from "../bot/db.js";

// IMPORTANT: This router is presentation-only.
//
// Discord is the sole source of truth for ALL gameplay data (card name,
// rarity, worth, burn, drop weight, limited/event flags, max copies, packs
// availability, archive state, image used in spawns, description). Any
// change to those values goes through the bot's `!editcard`, `!addcard`,
// `!removecard`, etc. — never the website.
//
// The website "Card Manager" page now writes ONLY to `card_display_overrides`,
// a single global table that overrides what the public website roster shows
// for a card. Discord never reads from it.
//
// Removed (relative to the pre-2026-05-26 admin router):
//   POST   /cards                — gameplay (creates a card the bot will spawn)
//   POST   /cards/:id/duplicate  — gameplay (creates a card the bot will spawn)
//   DELETE /cards/:id            — gameplay (mutates the spawn pool)
//   PATCH  /cards/:id            — gameplay (mutates rarity/worth/etc.)
//   The bot's in-memory card cache invalidation hook (`invalidateCardCache`)
//   is no longer called from this router because no field on `cards` is
//   mutated here. `cards` is read-only from the website.

const router: IRouter = Router();

router.use(requireDashboardAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown, res: Response): z.infer<T> | null {
  const result = schema.safeParse(value);
  if (!result.success) {
    res.status(400).json({ error: "Invalid payload", details: result.error.issues });
    return null;
  }
  return result.data;
}

// ── List cards with merged display overrides ─────────────────────────────────
// Returns BOTH the base (gameplay-truth) row AND the override row so the
// admin UI can show "Discord says X / website shows Y" side by side.
// Also includes the card's set memberships from the first-class sets tables.
router.get("/cards", async (_req, res) => {
  const homeGuildId = process.env["HOME_GUILD_ID"] ?? null;

  const [rows, memberships, customOverrides, rarityLabels] = await Promise.all([
    db
      .select({ card: cardsTable, override: cardDisplayOverridesTable })
      .from(cardsTable)
      .leftJoin(cardDisplayOverridesTable, eq(cardDisplayOverridesTable.cardId, cardsTable.id))
      .orderBy(cardsTable.id),
    db
      .select({ cardId: cardSetMembershipsTable.cardId, setId: setsTable.id, setName: setsTable.name })
      .from(cardSetMembershipsTable)
      .innerJoin(setsTable, eq(setsTable.id, cardSetMembershipsTable.setId)),
    homeGuildId
      ? db
          .select({
            cardId: cardRarityOverridesTable.cardId,
            slug: customRaritiesTable.slug,
            name: customRaritiesTable.name,
          })
          .from(cardRarityOverridesTable)
          .innerJoin(
            customRaritiesTable,
            and(
              eq(customRaritiesTable.guildId, cardRarityOverridesTable.guildId),
              eq(customRaritiesTable.slug, cardRarityOverridesTable.customRaritySlug),
            ),
          )
          .where(eq(cardRarityOverridesTable.guildId, homeGuildId))
      : Promise.resolve([] as { cardId: number; slug: string; name: string }[]),
    homeGuildId
      ? db
          .select({ rarity: rarityDisplayOverridesTable.rarity, displayName: rarityDisplayOverridesTable.displayName })
          .from(rarityDisplayOverridesTable)
          .where(eq(rarityDisplayOverridesTable.guildId, homeGuildId))
      : Promise.resolve([] as { rarity: string; displayName: string | null }[]),
  ]);

  const setsByCard = new Map<number, { id: number; name: string }[]>();
  for (const m of memberships) {
    if (!setsByCard.has(m.cardId)) setsByCard.set(m.cardId, []);
    setsByCard.get(m.cardId)!.push({ id: m.setId, name: m.setName });
  }

  const customTierByCard = new Map<number, { slug: string; name: string }>();
  for (const o of customOverrides) {
    customTierByCard.set(o.cardId, { slug: o.slug, name: o.name });
  }

  const rarityLabelMap = new Map<string, string>();
  for (const r of rarityLabels) {
    if (r.displayName) rarityLabelMap.set(r.rarity, r.displayName);
  }

  res.json({
    cards: rows.map(r => {
      const customTier = customTierByCard.get(r.card.id);
      const effectiveRarity = customTier?.slug ?? r.card.rarity;
      const effectiveRarityLabel = customTier?.name ?? rarityLabelMap.get(r.card.rarity) ?? r.card.rarity;
      return {
        ...r.card,
        sets: setsByCard.get(r.card.id) ?? [],
        displayOverride: r.override ?? null,
        effectiveRarity,
        effectiveRarityLabel,
      };
    }),
  });
});

// ── Upsert a card's website display override ─────────────────────────────────
// PUT /cards/:id/display
// Body: { displayName?, displayImageUrl?, displayDescription?, displayCategory?, flavorText?,
//         hiddenFromSite?, featured?, sortWeight? }
//
// Any omitted field is left at its current value (or default for first insert).
// Pass null to clear a text override and fall back to the card's gameplay value.
router.put("/cards/:id/display", async (req, res) => {
  const params = parse(idParam, req.params, res);
  if (!params) return;
  const body = parse(upsertCardDisplayOverrideSchema, req.body, res);
  if (!body) return;

  // Make sure the card exists so we don't insert a dangling FK row that the
  // DB would (correctly) reject with a less helpful error.
  const [card] = await db.select({ id: cardsTable.id }).from(cardsTable).where(eq(cardsTable.id, params.id));
  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }

  const updatedBy = req.session?.userId ?? null;

  const [row] = await db
    .insert(cardDisplayOverridesTable)
    .values({
      cardId: params.id,
      displayName: body.displayName ?? null,
      displayImageUrl: body.displayImageUrl ?? null,
      displayDescription: body.displayDescription ?? null,
      displayCategory: body.displayCategory ?? null,
      flavorText: body.flavorText ?? null,
      hiddenFromSite: body.hiddenFromSite ?? false,
      featured: body.featured ?? false,
      sortWeight: body.sortWeight ?? 0,
      updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: cardDisplayOverridesTable.cardId,
      // Only overwrite the fields the caller actually sent; preserve the rest.
      set: {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.displayImageUrl !== undefined ? { displayImageUrl: body.displayImageUrl } : {}),
        ...(body.displayDescription !== undefined ? { displayDescription: body.displayDescription } : {}),
        ...(body.displayCategory !== undefined ? { displayCategory: body.displayCategory } : {}),
        ...(body.flavorText !== undefined ? { flavorText: body.flavorText } : {}),
        ...(body.hiddenFromSite !== undefined ? { hiddenFromSite: body.hiddenFromSite } : {}),
        ...(body.featured !== undefined ? { featured: body.featured } : {}),
        ...(body.sortWeight !== undefined ? { sortWeight: body.sortWeight } : {}),
        updatedBy,
        updatedAt: new Date(),
      },
    })
    .returning();

  res.json({ override: row });
});

// ── Update a card's rarity (gameplay field) ───────────────────────────────────
// PATCH /cards/:id/rarity
// Body: { rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic" }
const rarityValues = ["common", "uncommon", "rare", "epic", "legendary", "mythic"] as const;
const patchRaritySchema = z.object({ rarity: z.enum(rarityValues) });

router.patch("/cards/:id/rarity", async (req, res) => {
  const params = parse(idParam, req.params, res);
  if (!params) return;
  const body = parse(patchRaritySchema, req.body, res);
  if (!body) return;

  const [card] = await db.select({ id: cardsTable.id }).from(cardsTable).where(eq(cardsTable.id, params.id));
  if (!card) { res.status(404).json({ error: "Card not found" }); return; }

  const [updated] = await db
    .update(cardsTable)
    .set({ rarity: body.rarity })
    .where(eq(cardsTable.id, params.id))
    .returning({ id: cardsTable.id, rarity: cardsTable.rarity });

  // Bust the bot's in-memory card cache so spawns/commands see the new rarity immediately.
  invalidateCardCache();

  res.json({ card: updated });
});

// ── Reset (delete) a card's display override row ─────────────────────────────
// DELETE /cards/:id/display — removes ALL website overrides for a card so the
// roster shows the underlying gameplay values again. The `cards` row is not
// touched.
router.delete("/cards/:id/display", async (req, res) => {
  const params = parse(idParam, req.params, res);
  if (!params) return;
  await db.delete(cardDisplayOverridesTable).where(eq(cardDisplayOverridesTable.cardId, params.id));
  res.json({ deleted: true, cardId: params.id });
});

export default router;
