import { Router, type IRouter, type Request, type Response } from "express";
import { getPlayerProfile } from "../bot/player/profile.js";
import { getOrCreateHq } from "../bot/hq/db.js";
import { HOME_GUILD_ID } from "../bot/home-guild.js";
import { loginRateLimiter } from "../lib/rate-limiters.js";
import { logger } from "../lib/logger.js";

/**
 * activity.ts — backend for the DN Cards **Discord Activity** (Phaser client).
 *
 * This is the ONLY new server surface Phase 1 adds. It is deliberately thin and
 * NON-AUTHORITATIVE from the client's point of view: the browser never tells us
 * who it is or what it owns. Instead it hands us a Discord OAuth2 access token,
 * we ask Discord who that token belongs to, and we load that user's REAL DN
 * Cards state from the same readers the bot uses (getPlayerProfile / getOrCreateHq).
 *
 * Flow (standard Discord Embedded App SDK handshake):
 *   1. Client: discordSdk.commands.authorize({ code }) → one-time OAuth `code`.
 *   2. Client → POST /api/activity/token { code }  ── we exchange it here.
 *   3. We return { access_token } (never the client secret).
 *   4. Client: discordSdk.commands.authenticate({ access_token }).
 *   5. Client → GET /api/activity/@me (Bearer access_token) ── we identify the
 *      user against Discord, then return their authoritative player snapshot.
 *
 * Reuses the SAME Discord app credentials as routes/oauth.ts. Dormant until
 * DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET are set, exactly like oauth.ts, so
 * this ships safely disabled and turns on with env alone — no code change.
 */

const DISCORD_API = "https://discord.com/api";

function oauthConfig() {
  const clientId = process.env["DISCORD_CLIENT_ID"]?.trim();
  const clientSecret = process.env["DISCORD_CLIENT_SECRET"]?.trim();
  return { clientId, clientSecret, configured: !!(clientId && clientSecret) };
}

const router: IRouter = Router();

// ── GET /api/activity/status — is the Activity backend wired up? ──────────────
// Drives the client's "not configured" screen without leaking anything.
router.get("/status", (_req, res) => {
  res.json({ configured: oauthConfig().configured, homeGuildId: HOME_GUILD_ID });
});

// ── POST /api/activity/token — exchange the SDK's OAuth code for a token ──────
// The Embedded App SDK gives the client a one-time `code`; only the server may
// exchange it (it holds the client secret). We hand back just the access_token.
router.post("/token", loginRateLimiter, async (req, res) => {
  const cfg = oauthConfig();
  if (!cfg.configured) {
    res.status(503).json({ error: "Activity backend is not configured." });
    return;
  }
  const code = typeof req.body?.code === "string" ? req.body.code : null;
  if (!code) {
    res.status(400).json({ error: "Missing OAuth code." });
    return;
  }

  try {
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId!,
        client_secret: cfg.clientSecret!,
        grant_type: "authorization_code",
        code,
      }),
    });
    if (!tokenRes.ok) {
      logger.warn({ status: tokenRes.status }, "activity token exchange failed");
      res.status(502).json({ error: "Discord token exchange failed." });
      return;
    }
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) {
      res.status(502).json({ error: "Discord did not return an access token." });
      return;
    }
    // Only the access token crosses back to the client. The SDK needs it to
    // call authenticate(); we re-verify it on every /@me request anyway.
    res.json({ access_token: token.access_token });
  } catch (err) {
    logger.error({ err }, "activity token exchange threw");
    res.status(502).json({ error: "Discord token exchange error." });
  }
});

// Resolve a Bearer access token to a Discord user id by asking Discord.
// We never trust a client-supplied id — this is the identity source of truth.
async function identify(req: Request): Promise<{ id: string; username: string; avatar: string | null } | null> {
  const auth = req.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  const accessToken = m[1]!.trim();
  try {
    const meRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meRes.ok) return null;
    const u = (await meRes.json()) as { id?: string; username?: string; avatar?: string | null };
    if (!u.id) return null;
    return { id: u.id, username: u.username ?? "player", avatar: u.avatar ?? null };
  } catch (err) {
    logger.debug({ err }, "activity identify failed");
    return null;
  }
}

// ── GET /api/activity/@me — authoritative player snapshot for the Activity ────
// Phase 1 payload = enough real data to PROVE the pipeline end-to-end (identity
// + economy + collection + HQ summary). Later phases extend this, never the
// client's authority.
router.get("/@me", async (req: Request, res: Response) => {
  if (!oauthConfig().configured) {
    res.status(503).json({ error: "Activity backend is not configured." });
    return;
  }
  if (!HOME_GUILD_ID) {
    res.status(503).json({ error: "Activity is not configured (HOME_GUILD_ID missing)." });
    return;
  }
  const user = await identify(req);
  if (!user) {
    res.status(401).json({ error: "Invalid or missing Discord access token." });
    return;
  }

  try {
    const guildId = HOME_GUILD_ID;
    // Same readers the bot uses — one source of truth. Never trust the client.
    const [profile, hq] = await Promise.all([
      getPlayerProfile(guildId, user.id),
      getOrCreateHq(guildId, user.id),
    ]);

    res.json({
      user: { id: user.id, username: user.username, avatar: user.avatar },
      guildId,
      player: {
        level: profile.account.level,
        xp: profile.account.xp,
        xpInto: profile.account.into,
        xpNeeded: profile.account.needed,
        shards: profile.economy.shards,
        collection: profile.collection,
        battles: {
          wins: profile.battles.wins,
          losses: profile.battles.losses,
          level: profile.battles.level,
        },
        achievements: profile.achievements.unlocked,
      },
      hq: {
        level: hq.hqLevel,
        themeId: hq.themeId,
        activeRoomId: hq.activeRoomId,
        wallId: hq.wallId,
        floorId: hq.floorId,
      },
    });
  } catch (err) {
    logger.error({ err, userId: user.id }, "activity /@me snapshot failed");
    res.status(500).json({ error: "Failed to load player state." });
  }
});

export default router;
