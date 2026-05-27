import { Router, type IRouter } from "express";
import { db, dashboardUsersTable, setupTokensTable } from "@workspace/db";
import { eq, and, isNull, gt, sql } from "drizzle-orm";
import { z } from "zod/v4";
import bcrypt from "bcryptjs";
import { loginRateLimiter } from "../lib/rate-limiters.js";
import { credentialFingerprint } from "../middlewares/dashboard-auth.js";

// Augment express-session with our custom fields. Declared here so anything
// that imports this module picks up the types.
declare module "express-session" {
  interface SessionData {
    userId?: number;
    username?: string;
    isOwner?: boolean;
    // SHA-256 fingerprint of passwordHash at session-issue time. Used by
    // requireDashboardAuth to detect password resets and invalidate stale
    // sessions immediately.
    sessionAuthVersion?: string;
  }
}

const router: IRouter = Router();

const usernameSchema = z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_.-]+$/);
const passwordSchema = z.string().min(8).max(128);

// ── GET /api/auth/me — current session ────────────────────────────────────────
router.get("/me", (req, res) => {
  if (!req.session?.userId) {
    res.json({ user: null });
    return;
  }
  res.json({
    user: {
      id: req.session.userId,
      username: req.session.username,
      isOwner: req.session.isOwner,
    },
  });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
// Rate-limited: 10 attempts per IP per 15 minutes.
const loginSchema = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });
router.post("/login", loginRateLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing username or password" });
    return;
  }
  const [user] = await db.select().from(dashboardUsersTable).where(eq(dashboardUsersTable.username, parsed.data.username)).limit(1);
  if (!user) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  await db.update(dashboardUsersTable).set({ lastLoginAt: new Date() }).where(eq(dashboardUsersTable.id, user.id));
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.isOwner = user.isOwner;
  req.session.sessionAuthVersion = credentialFingerprint(user.passwordHash);
  res.json({ user: { id: user.id, username: user.username, isOwner: user.isOwner } });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("dn-dash");
    res.json({ ok: true });
  });
});

// ── GET /api/auth/setup/:token/check ──────────────────────────────────────────
// Lets the setup page validate the token before rendering the form.
// Rate-limited to slow token enumeration attempts.
router.get("/setup/:token/check", loginRateLimiter, async (req, res) => {
  const token = String(req.params.token);
  const [row] = await db.select().from(setupTokensTable).where(eq(setupTokensTable.token, token)).limit(1);
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    res.status(404).json({ valid: false, error: "Setup link is invalid or expired" });
    return;
  }
  // For password resets we already know the target user — surface their
  // username so the form can prefill it.
  let presetUsername: string | null = null;
  if (row.resetForUserId) {
    const [u] = await db.select({ username: dashboardUsersTable.username }).from(dashboardUsersTable).where(eq(dashboardUsersTable.id, row.resetForUserId)).limit(1);
    presetUsername = u?.username ?? null;
  }
  res.json({ valid: true, isReset: row.resetForUserId !== null, presetUsername });
});

// ── POST /api/auth/setup/:token — consume a one-time setup link ───────────────
const setupSchema = z.object({ username: usernameSchema, password: passwordSchema });
const resetSchema = z.object({ password: passwordSchema });
router.post("/setup/:token", loginRateLimiter, async (req, res) => {
  const token = String(req.params.token);
  // Atomic consume: only one concurrent request can flip usedAt from NULL to
  // NOW(). Whichever loses the race gets zero rows back and is rejected.
  // We do this BEFORE creating the user so a race can't mint two accounts
  // from one invite link.
  const [row] = await db.update(setupTokensTable)
    .set({ usedAt: new Date() })
    .where(and(
      eq(setupTokensTable.token, token),
      isNull(setupTokensTable.usedAt),
      gt(setupTokensTable.expiresAt, new Date()),
    ))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Setup link is invalid or expired" });
    return;
  }

  // If we fail past this point we must roll the token back so the user can
  // retry. (Validation errors, unique-violations on username, etc.)
  const releaseToken = async () => {
    await db.update(setupTokensTable).set({ usedAt: null }).where(eq(setupTokensTable.id, row.id));
  };

  try {
    if (row.resetForUserId) {
      // Password-reset flow: username is fixed, just update the hash.
      const parsed = resetSchema.safeParse(req.body);
      if (!parsed.success) {
        await releaseToken();
        res.status(400).json({ error: "Password must be at least 8 characters" });
        return;
      }
      const hash = await bcrypt.hash(parsed.data.password, 10);
      const [user] = await db.update(dashboardUsersTable).set({ passwordHash: hash }).where(eq(dashboardUsersTable.id, row.resetForUserId)).returning();
      if (!user) {
        // Target user is gone; leave the token consumed (it's stale anyway).
        res.status(404).json({ error: "Target user no longer exists" });
        return;
      }
      // Auto-login after reset. The new sessionAuthVersion reflects the new
      // passwordHash, so any prior sessions issued with the old hash will fail
      // fingerprint verification on their next request and be destroyed.
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.isOwner = user.isOwner;
      req.session.sessionAuthVersion = credentialFingerprint(user.passwordHash);
      res.json({ user: { id: user.id, username: user.username, isOwner: user.isOwner } });
      return;
    }

    // New-user flow: create the row. First-ever dashboard user becomes owner.
    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) {
      await releaseToken();
      res.status(400).json({ error: "Username must be 3–32 chars (letters/numbers/_-.); password ≥ 8 chars." });
      return;
    }
    // Atomic "first user becomes owner": insert isOwner = true only when no
    // owner already exists. Wraps in a SQL subquery so the read-then-write is
    // a single statement against the DB.
    const hash = await bcrypt.hash(parsed.data.password, 10);
    let created;
    try {
      [created] = await db.insert(dashboardUsersTable).values({
        username: parsed.data.username,
        passwordHash: hash,
        isOwner: sql<boolean>`NOT EXISTS (SELECT 1 FROM dashboard_users WHERE is_owner = true)`,
      }).returning();
    } catch (err: any) {
      await releaseToken();
      if (err?.code === "23505") {
        res.status(409).json({ error: "That username is already taken" });
        return;
      }
      throw err;
    }
    req.session.userId = created.id;
    req.session.username = created.username;
    req.session.isOwner = created.isOwner;
    req.session.sessionAuthVersion = credentialFingerprint(created.passwordHash);
    res.json({ user: { id: created.id, username: created.username, isOwner: created.isOwner } });
  } catch (err) {
    // On unexpected failure, free the token so the user can retry.
    await releaseToken().catch(() => { /* swallow */ });
    throw err;
  }
});

// Helper used by other routes / bot to know if setup exists at all (used to
// decide which fallback flow to show on the login page).
export async function dashboardUserCount(): Promise<number> {
  const rows = await db.select({ id: dashboardUsersTable.id }).from(dashboardUsersTable).limit(1);
  return rows.length;
}

// Tiny status endpoint so the login page can tell the user "no admins set up
// yet — ask the server owner to run /dashboard in Discord".
router.get("/status", async (_req, res) => {
  const count = await dashboardUserCount();
  res.json({ hasUsers: count > 0 });
});

// Re-export gt/and/isNull so the bot doesn't need to import drizzle directly
// when generating tokens.
export { gt, and, isNull };

export default router;
