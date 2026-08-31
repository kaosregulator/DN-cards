// ─────────────────────────────────────────────────────────────────────────────
// Offline engine — the default generator.
//
// Renders every discovered MakeEmoji style locally: the same engine that draws
// the browser previews, so what a user previews is exactly what they get. It
// needs no network and no browser, which is what makes /emoji work reliably on
// any host — the headless-Chromium path proved too fragile in deployment to be
// the thing users depend on.
//
// ON by default. Set EMOJI_DISABLE_OFFLINE=1 only to force the MakeEmoji browser
// path where a browser is reliably present.
// ─────────────────────────────────────────────────────────────────────────────

import { EmojiError } from "../../utils/errors.js";
import type { GenerateOptions, GenerateResult } from "../../types.js";
import type { EmojiProvider, ProviderStatus } from "../types.js";
import {
  implementedOfflineStyles, loadOfflineManifest, loadOfflineStyles, offlinePackageRoot,
} from "./registry.js";
import { renderOffline } from "./renderer.js";

/** Opt OUT — the engine is on unless this is set. */
const ENV_DISABLE = "EMOJI_DISABLE_OFFLINE";

export function isOfflineFallbackEnabled(): boolean {
  return !/^(1|true|yes|on)$/i.test(process.env[ENV_DISABLE]?.trim() ?? "");
}

export class OfflineProvider implements EmojiProvider {
  readonly id = "offline";
  readonly name = "MakeEmoji offline backup";

  async status(): Promise<ProviderStatus> {
    if (!isOfflineFallbackEnabled()) {
      return {
        available: false,
        reason: `disabled via ${ENV_DISABLE}`,
      };
    }
    if (!offlinePackageRoot()) {
      return { available: false, reason: "offline package missing (artifacts/emoji-offline)" };
    }
    const styles = implementedOfflineStyles();
    if (styles.length === 0) {
      return { available: false, reason: "offline package has no implemented styles yet" };
    }
    return { available: true };
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    if (!isOfflineFallbackEnabled()) {
      throw new EmojiError("provider_unavailable", "The emoji generator isn't available right now.");
    }
    return renderOffline(options);
  }

  /** Operator / admin diagnostics. */
  report() {
    const manifest = loadOfflineManifest();
    return {
      enabled: isOfflineFallbackEnabled(),
      packageRoot: offlinePackageRoot(),
      styleCount: loadOfflineStyles().length,
      implementedStyleCount: implementedOfflineStyles().length,
      offlineReady: manifest?.offlineReady ?? false,
      version: manifest?.version ?? null,
      discoveredAt: manifest?.discoveredAt ?? null,
    };
  }
}

export const offlineProvider = new OfflineProvider();
