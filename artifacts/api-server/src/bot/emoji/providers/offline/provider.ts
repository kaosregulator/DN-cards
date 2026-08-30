// ─────────────────────────────────────────────────────────────────────────────
// Offline MakeEmoji backup provider — OFF unless an operator turns it on.
//
// Archives the discovered MakeEmoji style registry and can render a small
// exact-name subset via the local procedural renderer with no network. It is
// never the default: MakeEmoji.com remains primary. Enable with
// EMOJI_ALLOW_OFFLINE_FALLBACK=1.
// ─────────────────────────────────────────────────────────────────────────────

import { EmojiError } from "../../utils/errors.js";
import type { GenerateOptions, GenerateResult } from "../../types.js";
import type { EmojiProvider, ProviderStatus } from "../types.js";
import {
  implementedOfflineStyles, loadOfflineManifest, loadOfflineStyles, offlinePackageRoot,
} from "./registry.js";
import { renderOffline } from "./renderer.js";

const ENV_ENABLE = "EMOJI_ALLOW_OFFLINE_FALLBACK";

export function isOfflineFallbackEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env[ENV_ENABLE]?.trim() ?? "");
}

export class OfflineProvider implements EmojiProvider {
  readonly id = "offline";
  readonly name = "MakeEmoji offline backup";

  async status(): Promise<ProviderStatus> {
    if (!isOfflineFallbackEnabled()) {
      return {
        available: false,
        reason: `disabled — set ${ENV_ENABLE}=1 to allow the archived offline backup`,
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
