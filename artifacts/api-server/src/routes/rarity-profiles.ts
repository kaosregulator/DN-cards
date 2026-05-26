import { Router, type IRouter } from "express";
import { db, rarityProfilesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireDashboardAuth } from "../middlewares/dashboard-auth.js";
import { invalidateRarityProfileCache } from "../bot/db.js";

const router: IRouter = Router();
router.use(requireDashboardAuth);

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"] as const;
type Rarity = typeof RARITIES[number];
const raritySchema = z.enum(RARITIES);

const nonNegInt = z.number().int().min(0).max(1_000_000);
const profilePatchSchema = z.object({
  worthValue: nonNegInt.nullable().optional(),
  burnValue: nonNegInt.nullable().optional(),
  dropWeight: nonNegInt.nullable().optional(),
}).strict();

export type RarityProfileRow = {
  rarity: Rarity;
  worthValue: number | null;
  burnValue: number | null;
  dropWeight: number | null;
};

// GET /api/rarity-profiles/:guildId — returns all 6 rarities, nulls = "use card default"
router.get("/:guildId", async (req, res) => {
  const guildId = req.params.guildId;
  const rows = await db.select().from(rarityProfilesTable).where(eq(rarityProfilesTable.guildId, guildId));
  const byRarity = new Map<string, typeof rows[number]>();
  for (const r of rows) byRarity.set(r.rarity, r);
  const profiles: RarityProfileRow[] = RARITIES.map(r => {
    const row = byRarity.get(r);
    return {
      rarity: r,
      worthValue: row?.worthValue ?? null,
      burnValue: row?.burnValue ?? null,
      dropWeight: row?.dropWeight ?? null,
    };
  });
  res.json({ guildId, profiles });
});

// PUT /api/rarity-profiles/:guildId/:rarity — upsert override for one rarity
router.put("/:guildId/:rarity", async (req, res) => {
  const guildId = req.params.guildId;
  const rarityParsed = raritySchema.safeParse(req.params.rarity);
  if (!rarityParsed.success) {
    res.status(400).json({ error: "Unknown rarity" });
    return;
  }
  const patchParsed = profilePatchSchema.safeParse(req.body);
  if (!patchParsed.success) {
    res.status(400).json({ error: "Invalid patch", details: z.flattenError(patchParsed.error) });
    return;
  }
  const updatedBy = req.session?.username ?? "admin-token";
  const patch = patchParsed.data;
  await db.insert(rarityProfilesTable).values({
    guildId,
    rarity: rarityParsed.data,
    worthValue: patch.worthValue ?? null,
    burnValue: patch.burnValue ?? null,
    dropWeight: patch.dropWeight ?? null,
    updatedBy,
  }).onConflictDoUpdate({
    target: [rarityProfilesTable.guildId, rarityProfilesTable.rarity],
    set: {
      worthValue: patch.worthValue ?? null,
      burnValue: patch.burnValue ?? null,
      dropWeight: patch.dropWeight ?? null,
      updatedAt: new Date(),
      updatedBy,
    },
  });
  invalidateRarityProfileCache(guildId);
  res.json({ ok: true, rarity: rarityParsed.data });
});

// DELETE /api/rarity-profiles/:guildId/:rarity — reset to card defaults
router.delete("/:guildId/:rarity", async (req, res) => {
  const guildId = req.params.guildId;
  const rarityParsed = raritySchema.safeParse(req.params.rarity);
  if (!rarityParsed.success) {
    res.status(400).json({ error: "Unknown rarity" });
    return;
  }
  await db.delete(rarityProfilesTable).where(and(
    eq(rarityProfilesTable.guildId, guildId),
    eq(rarityProfilesTable.rarity, rarityParsed.data),
  ));
  invalidateRarityProfileCache(guildId);
  res.json({ ok: true, reset: rarityParsed.data });
});

// DELETE /api/rarity-profiles/:guildId — reset every rarity for this guild
router.delete("/:guildId", async (req, res) => {
  const guildId = req.params.guildId;
  await db.delete(rarityProfilesTable).where(eq(rarityProfilesTable.guildId, guildId));
  invalidateRarityProfileCache(guildId);
  res.json({ ok: true, resetAll: true });
});

export default router;
