import { Router, type IRouter } from "express";
import { HOME_GUILD_ID } from "../bot/home-guild.js";

/**
 * site.ts — read-only presentation config for the public website.
 *
 * This router exposes ONLY cosmetic / presentation values the frontend needs
 * to render itself (currently just which guild is "home" so the homepage can
 * load the community leaderboard without asking the visitor to type an ID).
 *
 * It never reads or writes game data. Phase 5 (admin CMS) will layer optional
 * DB-backed overrides for hero banners / splash media / theme on top of the
 * hardcoded defaults here — always falling back to the static defaults when an
 * override is missing or broken, so the UI can never render blank.
 */
const router: IRouter = Router();

router.get("/site/config", (_req, res) => {
  res.json({
    homeGuildId: HOME_GUILD_ID,
    // Cosmetic defaults live client-side (features/site/defaults) so the site
    // renders even if this endpoint is unreachable. Reserved for future
    // admin-CMS overrides.
    presentation: null,
  });
});

export default router;
