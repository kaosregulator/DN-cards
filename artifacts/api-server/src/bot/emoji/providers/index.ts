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
 *   1. Offline engine — the default. Renders every discovered style locally,
 *      no browser, and is the SAME engine as the previews, so preview == final.
 *   2. MakeEmoji.com browser — used only when the offline engine is turned off
 *      (EMOJI_DISABLE_OFFLINE=1) and a real browser is present.
 *   3. Local procedural renderer — a last resort, off unless explicitly enabled.
 */
export const PROVIDERS: readonly EmojiProvider[] = [
  offlineProvider, makeEmojiProvider, localProvider,
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
      logger.debug({ provider: provider.id }, "serving emoji");
      return provider;
    }
    reasons.push(`${provider.id}: ${status.reason}`);
  }

  // With the offline engine on by default this is nearly unreachable — it means
  // someone disabled it AND the browser is absent. Say what actually happened.
  logger.error({ reasons }, "no emoji provider is available");
  throw new EmojiError(
    "provider_unavailable",
    "The emoji generator is turned off on this server. An admin can re-enable it "
    + "by unsetting `EMOJI_DISABLE_OFFLINE`.",
  );
}

export { makeEmojiProvider, offlineProvider, localProvider };
export type { EmojiProvider, ProviderStatus } from "./types.js";
