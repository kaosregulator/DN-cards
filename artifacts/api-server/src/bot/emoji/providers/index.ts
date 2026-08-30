// ─────────────────────────────────────────────────────────────────────────────
// Provider resolution.
//
// MakeEmoji is the generator. The local renderer is a fallback an operator can
// switch on, never something we reach for silently — if MakeEmoji is unavailable
// and no fallback is enabled, the command says so rather than producing
// different output and calling it the same thing.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from "../../../lib/logger.js";
import { EmojiError } from "../utils/errors.js";
import { makeEmojiProvider } from "./makeemoji/client.js";
import { offlineProvider } from "./offline/provider.js";
import { localProvider } from "./local/provider.js";
import type { EmojiProvider, ProviderStatus } from "./types.js";

/**
 * Priority order:
 *   1. MakeEmoji.com (primary)
 *   2. Offline archive (only when EMOJI_ALLOW_OFFLINE_FALLBACK=1)
 *   3. Local procedural fallback (only when EMOJI_ALLOW_LOCAL_FALLBACK=1)
 *
 * Neither fallback is enabled by default.
 */
export const PROVIDERS: readonly EmojiProvider[] = [
  makeEmojiProvider, offlineProvider, localProvider,
];

export interface ProviderReport {
  id: string;
  name: string;
  status: ProviderStatus;
}

/** Status of every provider — for an admin command or a health endpoint. */
export async function providerReport(): Promise<ProviderReport[]> {
  return Promise.all(
    PROVIDERS.map(async p => ({ id: p.id, name: p.name, status: await p.status() })),
  );
}

/**
 * The provider that should serve the next request.
 *
 * Throws with the reasons every provider gave, so an operator reading the logs
 * learns exactly what to fix rather than just "unavailable".
 */
export async function resolveProvider(): Promise<EmojiProvider> {
  const reasons: string[] = [];

  for (const provider of PROVIDERS) {
    const status = await provider.status();
    if (status.available) {
      if (provider.id !== "makeemoji") {
        logger.warn({ provider: provider.id }, "serving emoji from a fallback provider, not MakeEmoji");
      }
      return provider;
    }
    reasons.push(`${provider.id}: ${status.reason}`);
  }

  logger.error({ reasons }, "no emoji provider is available");
  throw new EmojiError(
    "provider_unavailable",
    "The emoji generator isn't available right now. An admin has been notified.",
  );
}

export { makeEmojiProvider, offlineProvider, localProvider };
export type { EmojiProvider, ProviderStatus } from "./types.js";
