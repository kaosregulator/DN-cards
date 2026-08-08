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
}

// Scopes mirror routes/oauth.ts so the same Discord app works for both surfaces.
const SCOPES = ["identify", "guilds.members.read"] as const;

let sdk: DiscordSDK | null = null;

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
    return { accessToken: "", inDiscord: false };
  }
  if (!clientId) {
    throw new Error("VITE_DISCORD_CLIENT_ID is not set — cannot start the Activity.");
  }

  sdk = new DiscordSDK(clientId);
  await sdk.ready();

  // 1) Ask Discord for a one-time OAuth code scoped to this user + app.
  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: [...SCOPES],
  });

  // 2) Only our server can exchange the code (it holds the client secret).
  const { access_token } = await api.exchangeToken(code);

  // 3) Complete the handshake so the SDK is authenticated for RPC calls.
  await sdk.commands.authenticate({ access_token });

  return { accessToken: access_token, inDiscord: true };
}
