import { Router, type IRouter } from "express";
import { db, customRaritiesTable, cardRarityOverridesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireDashboardAuth } from "../middlewares/dashboard-auth.js";
import { invalidateRarityContextCache } from "../bot/db.js";

const router: IRouter = Router();
router.use(requireDashboardAuth);

// Slugs are the stable per-guild key for a custom tier; they appear in
// `card_rarity_overrides.customRaritySlug` and in /tradein ladder keys, so
// keep them URL-safe and human-typeable.
const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "slug must be lowercase letters/digits/hyphens (1-32 chars)");
const colorSchema = z.number().int().min(0).max(0xffffff);
// Schema cols: position + dropWeight are `real` so decimals are valid (e.g.
// position 5.5, dropWeight 0.5). worth/burn are integers in DB.
const positionSchema = z.number().min(0).max(1000);
const dropWeightSchema = z.number().min(0).max(1_000_000);
const nonNegInt = z.number().int().min(0).max(1_000_000);

const customRarityPatch = z.object({
  name: z.string().min(1).max(50),
  emoji: z.string().min(1).max(16),
  color: colorSchema,
  position: positionSchema,
  worthValue: nonNegInt,
  burnValue: nonNegInt,
  dropWeight: dropWeightSchema,
  inPacks: z.boolean(),
  droppable: z.boolean(),
}).strict();

router.get("/:guildId", async (req, res) => {
  const guildId = req.params.guildId;
  const rows = await db.select().from(customRaritiesTable)
    .where(eq(customRaritiesTable.guildId, guildId));
  rows.sort((a, b) => a.position - b.position);
  res.json({ guildId, customRarities: rows });
});

router.put("/:guildId/:slug", async (req, res) => {
  const guildId = req.params.guildId;
  const slugParsed = slugSchema.safeParse(req.params.slug);
  if (!slugParsed.success) {
    res.status(400).json({ error: "Invalid slug" });
    return;
  }
  const patchParsed = customRarityPatch.safeParse(req.body);
  if (!patchParsed.success) {
    res.status(400).json({ error: "Invalid body", details: z.flattenError(patchParsed.error) });
    return;
  }
  const updatedBy = req.session?.username ?? "admin-token";
  const patch = patchParsed.data;
  await db.insert(customRaritiesTable).values({
    guildId,
    slug: slugParsed.data,
    ...patch,
    updatedBy,
  }).onConflictDoUpdate({
    target: [customRaritiesTable.guildId, customRaritiesTable.slug],
    set: { ...patch, updatedAt: new Date(), updatedBy },
  });
  invalidateRarityContextCache(guildId);
  res.json({ ok: true, slug: slugParsed.data });
});

router.delete("/:guildId/:slug", async (req, res) => {
  const guildId = req.params.guildId;
  const slugParsed = slugSchema.safeParse(req.params.slug);
  if (!slugParsed.success) {
    res.status(400).json({ error: "Invalid slug" });
    return;
  }
  // No DB-level FK on customRaritySlug, so we manually free any cards
  // assigned to this tier before removing it. Order matters — overrides
  // first so we don't leave dangling rows if the second delete races.
  await db.delete(cardRarityOverridesTable).where(and(
    eq(cardRarityOverridesTable.guildId, guildId),
    eq(cardRarityOverridesTable.customRaritySlug, slugParsed.data),
  ));
  await db.delete(customRaritiesTable).where(and(
    eq(customRaritiesTable.guildId, guildId),
    eq(customRaritiesTable.slug, slugParsed.data),
  ));
  invalidateRarityContextCache(guildId);
  res.json({ ok: true, deleted: slugParsed.data });
});

export default router;
