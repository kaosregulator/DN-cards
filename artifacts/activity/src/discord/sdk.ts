// ─────────────────────────────────────────────────────────────────────────────
// Discord Embedded App SDK bootstrap + auth handshake.
//
// Responsibilities (Phase 1):
//   • initialise the SDK and wait for `ready`
//   • run the OAuth handshake:  authorize → server token exchange → authenticate
//   • expose the resulting Discord `access_token` so the API client can prove
//     the caller's identity to the backend.
//
// The backend, not this file, is authoritative. All this does is obtain a token
// Discord vouches for and hand it to our server, which independently re-verifies
// it on every request.
// ─────────────────────────────────────────────────────────────────────────────

import { DiscordSDK } from "@discord/embedded-app-sdk";
import { api } from "../net/api";
import { isInDiscord } from "./env";

export interface DiscordSession {
  /** Discord OAuth2 access token — sent to our backend as a Bearer credential. */
  accessToken: string;
  /** True when we handshook a real Discord frame; false in local dev bypass. */
  inDiscord: boolean;
  /**
   * This Activity instance's id. Everyone who launched the SAME Activity shares
   * it, which makes it the natural matchmaking room key for online PvP.
   */
  instanceId: string | null;
}

// Scopes mirror routes/oauth.ts so the same Discord app works for both surfaces.
const SCOPES = ["identify", "guilds.members.read"] as const;

let sdk: DiscordSDK | null = null;

const DISCORD_CLIENT_ID_RE = /^\d{15,22}$/;

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** The live SDK instance once `initDiscord` has run inside Discord (else null). */
export function getSdk(): DiscordSDK | null {
  return sdk;
}

/**
 * Perform the full Discord Activity auth handshake and return a session.
 *
 * In local dev (no `frame_id`), there is no Discord frame to talk to. We return
 * a bypass session with an empty token: the backend rejects it with 401, which
 * the UI surfaces clearly — proving the wiring without pretending to be signed
 * in. A real token only exists inside Discord.
 */
export async function initDiscord(): Promise<DiscordSession> {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID?.trim();

  if (!isInDiscord()) {
    return { accessToken: "", inDiscord: false, instanceId: null };
  }
  if (!clientId) {
    throw new Error("VITE_DISCORD_CLIENT_ID is not set — cannot start the Activity.");
  }
  if (!DISCORD_CLIENT_ID_RE.test(clientId)) {
    throw new Error(
      "The Discord Activity client ID is invalid. Publish again after fixing the Activity environment configuration.",
    );
  }

  sdk = new DiscordSDK(clientId);
  await withTimeout(
    sdk.ready(),
    10_000,
    "Discord did not finish connecting to the Activity. Close it, reopen it, and try again.",
  );

  // 1) Ask Discord for a one-time OAuth code scoped to this user + app.
  const { code } = await withTimeout(
    sdk.commands.authorize({
      client_id: clientId,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: [...SCOPES],
    }),
    15_000,
    "Discord authorization timed out. Close the Activity and try launching it again.",
  );

  // 2) Only our server can exchange the code (it holds the client secret).
  const { access_token } = await withTimeout(
    api.exchangeToken(code),
    15_000,
    "The DN Cards server did not complete Discord authorization in time. Try again shortly.",
  );

  // 3) Complete the handshake so the SDK is authenticated for RPC calls.
  await withTimeout(
    sdk.commands.authenticate({ access_token }),
    10_000,
    "Discord authentication timed out. Close the Activity and try launching it again.",
  );

  return { accessToken: access_token, inDiscord: true, instanceId: sdk.instanceId ?? null };
}
