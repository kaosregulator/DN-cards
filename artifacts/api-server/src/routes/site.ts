import { Router, type IRouter } from "express";
import { db, sitePresentationTable, type HeroBanner } from "@workspace/db";
import { eq } from "drizzle-orm";
import { HOME_GUILD_ID } from "../bot/home-guild.js";

/**
 * site.ts — read-only presentation config for the public website.
 *
 * Exposes ONLY cosmetic values (home guild id + the admin-authored
 * presentation config). It never reads or writes game data.
 *
 * The stored config lives in `site_presentation` (a presentation-only table).
 * Here we resolve the currently-active hero banner from its schedule and fold
 * it into `hero.backgroundSrc/Poster`. Everything else is passed through and
 * merged over hardcoded client defaults, so a missing row or field can never
 * blank the UI.
 */
const router: IRouter = Router();

/** Pick the newest enabled hero banner whose schedule window contains `now`. */
export function activeHeroBanner(banners: HeroBanner[] | undefined, now = Date.now()): HeroBanner | null {
  if (!Array.isArray(banners)) return null;
  const live = banners.filter((b) => {
    if (!b || b.enabled === false || !b.imageSrc) return false;
    const start = b.startAt ? Date.parse(b.startAt) : null;
    const end = b.endAt ? Date.parse(b.endAt) : null;
    if (start != null && !Number.isNaN(start) && now < start) return false;
    if (end != null && !Number.isNaN(end) && now > end) return false;
    return true;
  });
  return live.length ? live[live.length - 1] : null;
}

/** Fold the active banner into the hero so the client gets a ready background. */
export function resolvePublicPresentation(config: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!config || typeof config !== "object") return null;
  const banners = (config as { heroBanners?: HeroBanner[] }).heroBanners;
  const active = activeHeroBanner(banners);
  const hero = { ...((config as { hero?: Record<string, unknown> }).hero ?? {}) };
  if (active) {
    hero.backgroundSrc = active.imageSrc;
    hero.backgroundPoster = active.poster ?? null;
  }
  const { heroBanners: _omit, ...rest } = config as Record<string, unknown>;
  return { ...rest, hero };
}

router.get("/site/config", async (_req, res) => {
  let presentation: Record<string, unknown> | null = null;
  if (HOME_GUILD_ID) {
    try {
      const [row] = await db
        .select({ config: sitePresentationTable.config })
        .from(sitePresentationTable)
        .where(eq(sitePresentationTable.guildId, HOME_GUILD_ID))
        .limit(1);
      presentation = resolvePublicPresentation(row?.config as Record<string, unknown> | undefined);
    } catch {
      // Fail-safe: any DB hiccup falls back to client defaults (null).
      presentation = null;
    }
  }
  res.json({ homeGuildId: HOME_GUILD_ID, presentation });
});

export default router;
