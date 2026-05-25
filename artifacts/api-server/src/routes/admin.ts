import { Router, type IRouter, type Response } from "express";
import { db, cardsTable } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireDashboardAuth } from "../middlewares/dashboard-auth.js";

const router: IRouter = Router();

// Card admin endpoints accept either a session login or the master ADMIN_TOKEN.
router.use(requireDashboardAuth);

// ── Validation schemas ────────────────────────────────────────────────────────
const rarityValues = ["common", "uncommon", "rare", "epic", "legendary"] as const;
const cardTypeValues = ["tank", "aircraft", "ship", "vehicle", "infantry", "boss", "community", "event", "achievement", "limited"] as const;

const cardPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  rarity: z.enum(rarityValues).optional(),
  cardType: z.enum(cardTypeValues).optional(),
  dropWeight: z.number().min(0).max(1000).optional(),
  worthValue: z.number().int().min(0).max(1_000_000).optional(),
  burnValue: z.number().int().min(0).max(1_000_000).optional(),
  imageUrl: z.union([z.string().url(), z.string().regex(/^\/objects\/[^?#]+$/)]).nullable().optional(),
  maxCopies: z.number().int().min(1).max(100_000).nullable().optional(),
  isLimitedEdition: z.boolean().optional(),
  isEventExclusive: z.boolean().optional(),
  inPacks: z.boolean().optional(),
  droppable: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  flavor: z.string().max(500).nullable().optional(),
  podiumPlace: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable().optional(),
  previewAnimation: z.enum(["spin", "bounce", "flip", "pulse", "none"]).nullable().optional(),
  // Accept CSS hex like #aabbcc or #aabbccdd, or named/rgba via short max-length string.
  previewBgColor: z.string().max(40).regex(/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d.,\s%]+\))$/).nullable().optional(),
  displayOrientation: z.enum(["portrait", "landscape"]).nullable().optional(),
});

const cardCreateSchema = cardPatchSchema.extend({
  name: z.string().trim().min(1).max(80),
  rarity: z.enum(rarityValues),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown, res: Response): z.infer<T> | null {
  const result = schema.safeParse(value);
  if (!result.success) {
    res.status(400).json({ error: "Invalid payload", details: result.error.issues });
    return null;
  }
  return result.data;
}

// ── List (includes archived; admin needs full visibility) ────────────────────
router.get("/cards", async (_req, res) => {
  const rows = await db.select().from(cardsTable).orderBy(cardsTable.id);
  res.json({ cards: rows });
});

// ── Create (used by duplicate too) ───────────────────────────────────────────
router.post("/cards", async (req, res) => {
  const body = parse(cardCreateSchema, req.body, res);
  if (!body) return;
  try {
    const [created] = await db.insert(cardsTable).values({
      ...body,
      isLimitedEdition: body.isLimitedEdition ?? false,
      isEventExclusive: body.isEventExclusive ?? false,
      droppable: body.droppable ?? true,
      inPacks: body.inPacks ?? true,
      isArchived: body.isArchived ?? false,
    }).returning();
    res.status(201).json({ card: created });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "A card with that name already exists" });
      return;
    }
    throw err;
  }
});

// ── Edit ──────────────────────────────────────────────────────────────────────
router.patch("/cards/:id", async (req, res) => {
  const params = parse(idParam, req.params, res);
  if (!params) return;
  const body = parse(cardPatchSchema, req.body, res);
  if (!body) return;
  if (Object.keys(body).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Read current state so we can compute the *effective* post-patch values
      // for invariant enforcement (you can't set podiumPlace on a non-event card).
      const [current] = await tx.select().from(cardsTable).where(eq(cardsTable.id, params.id));
      if (!current) return { notFound: true as const };

      const effectiveEventExclusive = body.isEventExclusive ?? current.isEventExclusive;
      const patch: typeof body = { ...body };

      // If the card is (or is becoming) non-event-exclusive, the podium slot
      // must be null regardless of what the client sent — both for the explicit
      // toggle-off case and to reject "set place on a regular card" requests.
      if (!effectiveEventExclusive) {
        patch.podiumPlace = null;
      }

      const finalPlace = patch.podiumPlace;

      // Evict the prior occupant of the slot, but only when this card is
      // actually taking it. Use the *final* patched value so a payload like
      // { isEventExclusive:false, podiumPlace:1 } doesn't accidentally evict.
      if (finalPlace === 1 || finalPlace === 2 || finalPlace === 3) {
        await tx.update(cardsTable)
          .set({ podiumPlace: null })
          .where(and(eq(cardsTable.podiumPlace, finalPlace), sql`${cardsTable.id} <> ${params.id}`));
      }

      const [row] = await tx.update(cardsTable).set(patch).where(eq(cardsTable.id, params.id)).returning();
      return { row };
    });

    if ("notFound" in result) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    res.json({ card: result.row });
  } catch (err: any) {
    if (err?.code === "23505") {
      // Disambiguate name-unique vs podium-slot-unique conflicts so admins
      // get a useful message when concurrent edits race for the same slot.
      const detail = String(err?.constraint ?? err?.detail ?? "");
      if (detail.includes("podium_place")) {
        res.status(409).json({ error: "That podium slot was just taken by another edit. Reopen the card and try again." });
        return;
      }
      res.status(409).json({ error: "A card with that name already exists" });
      return;
    }
    throw err;
  }
});

// ── Duplicate ─────────────────────────────────────────────────────────────────
router.post("/cards/:id/duplicate", async (req, res) => {
  const params = parse(idParam, req.params, res);
  if (!params) return;
  const [source] = await db.select().from(cardsTable).where(eq(cardsTable.id, params.id));
  if (!source) {
    res.status(404).json({ error: "Card not found" });
    return;
  }

  // Generate a unique "(copy N)" suffix. Retry on concurrent collisions (23505).
  const { id: _id, createdAt: _c, totalMinted: _t, ...rest } = source;
  let suffix = 1;
  for (let attempt = 0; attempt < 25; attempt++) {
    const newName = suffix === 1 ? `${source.name} (copy)` : `${source.name} (copy ${suffix})`;
    const [existing] = await db.select({ id: cardsTable.id }).from(cardsTable)
      .where(sql`lower(${cardsTable.name}) = lower(${newName})`);
    if (existing) { suffix += 1; continue; }
    try {
      const [created] = await db.insert(cardsTable)
        .values({ ...rest, name: newName, isArchived: false })
        .returning();
      res.status(201).json({ card: created });
      return;
    } catch (err: any) {
      if (err?.code === "23505") { suffix += 1; continue; }
      throw err;
    }
  }
  res.status(409).json({ error: "Could not allocate a unique duplicate name; please rename and try again." });
});

// ── Delete (hard) ─────────────────────────────────────────────────────────────
// Refuses if the card has been minted; client should archive instead.
router.delete("/cards/:id", async (req, res) => {
  const params = parse(idParam, req.params, res);
  if (!params) return;
  const [card] = await db.select().from(cardsTable).where(eq(cardsTable.id, params.id));
  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  if (card.totalMinted > 0) {
    res.status(409).json({
      error: "Card has been minted and cannot be hard-deleted; archive it instead.",
      totalMinted: card.totalMinted,
    });
    return;
  }
  await db.delete(cardsTable).where(eq(cardsTable.id, params.id));
  res.json({ deleted: true, id: params.id });
});

export default router;
