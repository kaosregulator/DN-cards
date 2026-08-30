import { Router, type IRouter } from "express";
import { requireDashboardAuth } from "../middlewares/dashboard-auth.js";
import {
  implementedOfflineStyles,
  isOfflineFallbackEnabled,
  loadOfflineManifest,
  loadOfflineStyles,
  offlinePackageRoot,
  offlineProvider,
} from "../bot/emoji/providers/offline/index.js";
import { makeEmojiProvider } from "../bot/emoji/providers/makeemoji/client.js";
import { getManifest } from "../bot/emoji/providers/makeemoji/manifest.js";

/**
 * Admin-facing Make Emoji status — discovery archive + provider health.
 * Presentation only; does not generate emojis.
 */
const router: IRouter = Router();

router.use(requireDashboardAuth);

router.get("/emoji/offline", async (_req, res) => {
  const offlineManifest = loadOfflineManifest();
  const styles = loadOfflineStyles();
  const implemented = implementedOfflineStyles();
  const makeEmoji = getManifest();
  const makeStatus = await makeEmojiProvider.status();
  const offlineStatus = await offlineProvider.status();

  res.json({
    primary: {
      id: makeEmojiProvider.id,
      name: makeEmojiProvider.name,
      status: makeStatus,
      verified: makeEmoji.manifest?.verified ?? false,
      discoveredAt: makeEmoji.manifest?.discoveredAt ?? null,
      liveStyleCount: makeEmoji.manifest?.controls.animation?.values.length ?? 0,
    },
    offline: {
      id: offlineProvider.id,
      name: offlineProvider.name,
      status: offlineStatus,
      enabled: isOfflineFallbackEnabled(),
      packageRoot: offlinePackageRoot(),
      version: offlineManifest?.version ?? null,
      offlineReady: offlineManifest?.offlineReady ?? false,
      discoveredAt: offlineManifest?.discoveredAt ?? null,
      styleCount: styles.length,
      implementedStyleCount: implemented.length,
      implementedStyles: implemented.map(s => s.id),
      envFlag: "EMOJI_ALLOW_OFFLINE_FALLBACK",
    },
    message:
      "MakeEmoji.com is the primary generator. The offline archive preserves discovered " +
      "styles for a future independent engine and is disabled unless EMOJI_ALLOW_OFFLINE_FALLBACK=1.",
  });
});

export default router;
