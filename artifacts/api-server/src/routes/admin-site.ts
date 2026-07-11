import { Router, type IRouter } from "express";
import { db, sitePresentationTable, presentationConfigSchema } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireDashboardAuth } from "../middlewares/dashboard-auth.js";
import { HOME_GUILD_ID } from "../bot/home-guild.js";

/**
 * admin-site.ts — admin CMS for website PRESENTATION ONLY.
 *
 * Authenticated (dashboard auth) + locked to the home guild. It writes to the
 * `site_presentation` table exclusively — hero copy/media, splash, theme,
 * Discord invite, and scheduled hero banners. It CANNOT touch card ownership,
 * stats, rarities, or any bot config; those live in game tables this router
 * never references.
 */
const router: IRouter = Router();

router.use(requireDashboardAuth);
router.use((_req, res, next) => {
  if (!HOME_GUILD_ID) {
    res.status(503).json({ error: "Site admin is not configured (HOME_GUILD_ID missing)." });
    return;
  }
  next();
});

// ── GET current raw config (admin view — includes banners + schedules) ────────
router.get("/site-presentation", async (_req, res) => {
  const [row] = await db
    .select()
    .from(sitePresentationTable)
    .where(eq(sitePresentationTable.guildId, HOME_GUILD_ID!))
    .limit(1);
  res.json({ config: row?.config ?? {}, updatedAt: row?.updatedAt ?? null });
});

// ── PUT replace the config (validated) ────────────────────────────────────────
router.put("/site-presentation", async (req, res) => {
  const parsed = presentationConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid presentation config", details: parsed.error.issues });
    return;
  }
  const updatedBy = req.session?.userId ?? null;
  const [row] = await db
    .insert(sitePresentationTable)
    .values({ guildId: HOME_GUILD_ID!, config: parsed.data, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: sitePresentationTable.guildId,
      set: { config: parsed.data, updatedBy, updatedAt: new Date() },
    })
    .returning();
  res.json({ config: row.config, updatedAt: row.updatedAt });
});

export default router;
