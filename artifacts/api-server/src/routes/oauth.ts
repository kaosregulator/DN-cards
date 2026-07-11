import { Router, type IRouter, type Request } from "express";
import crypto from "node:crypto";
import { db, collectionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { HOME_GUILD_ID } from "../bot/home-guild.js";
import { loginRateLimiter } from "../lib/rate-limiters.js";

/**
 * oauth.ts — Discord OAuth2 login for *website visitors* (read-only).
 *
 * This is the presentation layer's user login. It uses the `identify` and
 * `guilds.members.read` scopes to grab the visitor's username + avatar and to
 * verify they're a member of the home guild. It NEVER writes game data — the
 * only game table it touches is a read of the visitor's own `collections` rows
 * to power the website's Owned/Unowned view.
 *
 * Dormant by design: with no DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET set,
 * every endpoint reports "not configured" and the UI hides the login button.
 * Set the env vars (see below) to activate — no code change required.
 *
 * Required env to activate:
 *   DISCORD_CLIENT_ID       — OAuth2 app client id
 *   DISCORD_CLIENT_SECRET   — OAuth2 app client secret
 *   DISCORD_OAUTH_REDIRECT_URI (optional) — exact redirect registered in the
 *       Discord Developer Portal. If unset, derived from the request as
 *       `${origin}/api/oauth/discord/callback`.
 */

declare module "express-session" {
  interface SessionData {
    // Website visitor identity (separate from the admin dashboard session).
    discordUserId?: string;
    discordUsername?: string;
    discordAvatar?: string | null;
    discordInHomeGuild?: boolean;
    // Short-lived CSRF state for the OAuth round-trip.
    oauthState?: string;
  }
}

const DISCORD_API = "https://discord.com/api";
const SCOPES = ["identify", "guilds.members.read"];

function oauthConfig() {
  const clientId = process.env["DISCORD_CLIENT_ID"]?.trim();
  const clientSecret = process.env["DISCORD_CLIENT_SECRET"]?.trim();
  return { clientId, clientSecret, configured: !!(clientId && clientSecret) };
}

function redirectUri(req: Request): string {
  const fromEnv = process.env["DISCORD_OAUTH_REDIRECT_URI"]?.trim();
  if (fromEnv) return fromEnv;
  const proto = (req.get("x-forwarded-proto") ?? req.protocol).split(",")[0];
  return `${proto}://${req.get("host")}/api/oauth/discord/callback`;
}

const router: IRouter = Router();

// ── GET /api/oauth/status — is OAuth wired up? (drives UI visibility) ──────────
router.get("/status", (_req, res) => {
  res.json({ configured: oauthConfig().configured, homeGuildId: HOME_GUILD_ID });
});

// ── GET /api/oauth/me — current website visitor ───────────────────────────────
router.get("/me", (req, res) => {
  const s = req.session;
  if (!s?.discordUserId) {
    res.json({ user: null });
    return;
  }
  res.json({
    user: {
      id: s.discordUserId,
      username: s.discordUsername ?? null,
      avatar: s.discordAvatar ?? null,
      inHomeGuild: s.discordInHomeGuild ?? false,
    },
  });
});

// ── GET /api/oauth/discord/login — kick off the OAuth flow ────────────────────
router.get("/discord/login", loginRateLimiter, (req, res) => {
  const cfg = oauthConfig();
  if (!cfg.configured) {
    res.status(503).json({ error: "Discord login is not configured." });
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: cfg.clientId!,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
    prompt: "none",
  });
  res.redirect(`${DISCORD_API}/oauth2/authorize?${params.toString()}`);
});

// ── GET /api/oauth/discord/callback — exchange code, verify guild ─────────────
router.get("/discord/callback", loginRateLimiter, async (req, res) => {
  const cfg = oauthConfig();
  if (!cfg.configured) {
    res.status(503).send("Discord login is not configured.");
    return;
  }
  const code = typeof req.query["code"] === "string" ? req.query["code"] : null;
  const state = typeof req.query["state"] === "string" ? req.query["state"] : null;
  const expected = req.session.oauthState;
  delete req.session.oauthState;
  if (!code || !state || !expected || state !== expected) {
    res.status(400).send("Invalid OAuth response. Please try logging in again.");
    return;
  }

  try {
    // 1) Exchange the auth code for an access token.
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId!,
        client_secret: cfg.clientSecret!,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(req),
      }),
    });
    if (!tokenRes.ok) {
      res.status(502).send("Discord token exchange failed. Please try again.");
      return;
    }
    const token = (await tokenRes.json()) as { access_token: string; token_type: string };
    const authHeader = { Authorization: `${token.token_type} ${token.access_token}` };

    // 2) identify — username + avatar.
    const userRes = await fetch(`${DISCORD_API}/users/@me`, { headers: authHeader });
    if (!userRes.ok) {
      res.status(502).send("Could not read your Discord profile. Please try again.");
      return;
    }
    const user = (await userRes.json()) as { id: string; username: string; avatar: string | null; global_name?: string | null };

    // 3) guilds.members.read — verify home-guild membership (best-effort).
    let inHomeGuild = false;
    if (HOME_GUILD_ID) {
      const memberRes = await fetch(`${DISCORD_API}/users/@me/guilds/${HOME_GUILD_ID}/member`, { headers: authHeader });
      inHomeGuild = memberRes.ok; // 200 = member, 404 = not a member
    }

    // Persist to the httpOnly session cookie (configured in app.ts).
    req.session.discordUserId = user.id;
    req.session.discordUsername = user.global_name || user.username;
    req.session.discordAvatar = user.avatar;
    req.session.discordInHomeGuild = inHomeGuild;

    // Bounce back to the app. The SPA reads /api/oauth/me on load.
    res.redirect("/?login=success");
  } catch {
    res.status(502).send("Discord login failed. Please try again.");
  }
});

// ── POST /api/oauth/logout — clear the visitor identity ───────────────────────
router.post("/logout", (req, res) => {
  if (req.session) {
    delete req.session.discordUserId;
    delete req.session.discordUsername;
    delete req.session.discordAvatar;
    delete req.session.discordInHomeGuild;
  }
  res.json({ ok: true });
});

// ── GET /api/oauth/collection — the logged-in visitor's owned card ids ─────────
// Read-only. Uses the session's Discord user id (server-side, unspoofable) to
// look up their collection rows for the home guild. Powers Owned/Unowned.
router.get("/collection", async (req, res) => {
  const userId = req.session?.discordUserId;
  if (!userId) {
    res.status(401).json({ error: "Not logged in." });
    return;
  }
  if (!HOME_GUILD_ID) {
    res.json({ ownedCardIds: [], holdings: [] });
    return;
  }
  const rows = await db
    .select({ cardId: collectionsTable.cardId, count: collectionsTable.count, shinyCount: collectionsTable.shinyCount })
    .from(collectionsTable)
    .where(and(eq(collectionsTable.guildId, HOME_GUILD_ID), eq(collectionsTable.userId, userId)));
  res.json({
    ownedCardIds: rows.map((r) => r.cardId),
    holdings: rows,
  });
});

export default router;
