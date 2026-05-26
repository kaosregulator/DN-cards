import { Router, type IRouter } from "express";
import { db, cardRarityOverridesTable, customRaritiesTable, cardsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireDashboardAuth } from "../middlewares/dashboard-auth.js";
import { invalidateRarityContextCache } from "../bot/db.js";

const router: IRouter = Router();
router.use(requireDashboardAuth);

const cardIdSchema = z.coerce.number().int().positive();
const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);

const putBody = z.object({
  customRaritySlug: slugSchema,
}).strict();

router.get("/:guildId", async (req, res) => {
  const guildId = req.params.guildId;
  const rows = await db.select({
    cardId: cardRarityOverridesTable.cardId,
    customRaritySlug: cardRarityOverridesTable.customRaritySlug,
    cardName: cardsTable.name,
    cardRarity: cardsTable.rarity,
  })
    .from(cardRarityOverridesTable)
    .innerJoin(cardsTable, eq(cardRarityOverridesTable.cardId, cardsTable.id))
    .where(eq(cardRarityOverridesTable.guildId, guildId));
  res.json({ guildId, overrides: rows });
});

router.put("/:guildId/:cardId", async (req, res) => {
  const guildId = req.params.guildId;
  const cardIdParsed = cardIdSchema.safeParse(req.params.cardId);
  if (!cardIdParsed.success) {
    res.status(400).json({ error: "Invalid cardId" });
    return;
  }
  const bodyParsed = putBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid body", details: z.flattenError(bodyParsed.error) });
    return;
  }
  // Validate the slug exists for this guild — the FK would catch it but the
  // error would be opaque. A 404 here is much clearer to the admin UI.
  const [tier] = await db.select().from(customRaritiesTable).where(and(
    eq(customRaritiesTable.guildId, guildId),
    eq(customRaritiesTable.slug, bodyParsed.data.customRaritySlug),
  ));
  if (!tier) {
    res.status(404).json({ error: "Unknown custom rarity slug for this guild" });
    return;
  }
  await db.insert(cardRarityOverridesTable).values({
    guildId,
    cardId: cardIdParsed.data,
    customRaritySlug: bodyParsed.data.customRaritySlug,
  }).onConflictDoUpdate({
    target: [cardRarityOverridesTable.guildId, cardRarityOverridesTable.cardId],
    set: { customRaritySlug: bodyParsed.data.customRaritySlug },
  });
  invalidateRarityContextCache(guildId);
  res.json({ ok: true });
});

router.delete("/:guildId/:cardId", async (req, res) => {
  const guildId = req.params.guildId;
  const cardIdParsed = cardIdSchema.safeParse(req.params.cardId);
  if (!cardIdParsed.success) {
    res.status(400).json({ error: "Invalid cardId" });
    return;
  }
  await db.delete(cardRarityOverridesTable).where(and(
    eq(cardRarityOverridesTable.guildId, guildId),
    eq(cardRarityOverridesTable.cardId, cardIdParsed.data),
  ));
  invalidateRarityContextCache(guildId);
  res.json({ ok: true });
});

export default router;
