import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual, createHash } from "node:crypto";
import { db, dashboardUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Credential fingerprinting ─────────────────────────────────────────────────
// We store a short SHA-256 fingerprint of the user's bcrypt passwordHash in
// the session at login time. On every request we compare the fingerprint
// against the live DB value. If they differ (because an admin reset the
// password after the session was issued), the session is invalid and we
// destroy it immediately rather than letting it coast for 30 days.
//
// Using a hash-of-hash is fine: bcrypt output is public-key-like in that it
// cannot be reversed; we just need a stable marker that flips when the
// password changes, not something that must be secret in its own right.
export function credentialFingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 32);
}

// ── Session user loader ───────────────────────────────────────────────────────
// Re-reads the dashboard_users row on every request so that revoked, deleted,
// demoted, or password-reset accounts take effect immediately rather than
// waiting 30 days for the session cookie to expire.
//
// The result is cached on res.locals so both requireDashboardAuth and
// requireDashboardOwner share one DB round-trip per request.

type LiveUser = { id: number; username: string; isOwner: boolean };

async function loadSessionUser(req: Request, res: Response): Promise<LiveUser | null> {
  // Already resolved for this request.
  if ("_dashboardUserChecked" in res.locals) {
    return (res.locals._dashboardUser as LiveUser | null);
  }

  res.locals._dashboardUserChecked = true;

  if (!req.session?.userId) {
    res.locals._dashboardUser = null;
    return null;
  }

  const [user] = await db
    .select({
      id: dashboardUsersTable.id,
      username: dashboardUsersTable.username,
      isOwner: dashboardUsersTable.isOwner,
      passwordHash: dashboardUsersTable.passwordHash,
    })
    .from(dashboardUsersTable)
    .where(eq(dashboardUsersTable.id, req.session.userId))
    .limit(1);

  if (!user) {
    // Account deleted — invalidate the stale session.
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    res.locals._dashboardUser = null;
    return null;
  }

  // Verify the credential fingerprint stored at login time still matches the
  // live passwordHash. A missing or mismatched fingerprint means either:
  //   (a) the session predates this security fix (no fingerprint stored), or
  //   (b) the password was reset after the session was issued.
  // In both cases, treat the session as revoked so the user must re-login.
  // Fail-closed: absence of the field is treated as a mismatch, not a pass.
  const liveFingerprint = credentialFingerprint(user.passwordHash);
  if (!req.session.sessionAuthVersion || req.session.sessionAuthVersion !== liveFingerprint) {
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    res.locals._dashboardUser = null;
    return null;
  }

  // Keep the session's isOwner flag current so /me stays accurate without a
  // separate round-trip. The session itself is not the authority — the DB is.
  if (req.session.isOwner !== user.isOwner) {
    req.session.isOwner = user.isOwner;
  }

  const liveUser: LiveUser = { id: user.id, username: user.username, isOwner: user.isOwner };
  res.locals._dashboardUser = liveUser;
  return liveUser;
}

// ── Shared auth middleware ────────────────────────────────────────────────────
// A request is authenticated if EITHER:
//   1. It has a valid session backed by a live dashboard_users row whose
//      credential fingerprint still matches (i.e. password not reset since
//      the session was issued), OR
//   2. It carries the master ADMIN_TOKEN as a Bearer header (break-glass /
//      legacy clients).
// We always allow the master token so admins can recover even if every
// dashboard_users row is deleted by accident.
export async function requireDashboardAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await loadSessionUser(req, res);
  if (user) {
    next();
    return;
  }

  const expected = process.env["ADMIN_TOKEN"];
  if (expected) {
    const header = req.header("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : req.header("x-admin-token") ?? "";
    if (provided) {
      const expectedBuf = Buffer.from(expected, "utf8");
      const providedBuf = Buffer.from(provided, "utf8");
      if (providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf)) {
        next();
        return;
      }
    }
  }
  res.status(401).json({ error: "Authentication required" });
}

// ── Owner-only guard ──────────────────────────────────────────────────────────
// Checks the live DB row — not just the session flag — so a demotion takes
// effect on the very next request.
// The master ADMIN_TOKEN always counts as owner.
export async function requireDashboardOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await loadSessionUser(req, res);
  if (user?.isOwner) {
    next();
    return;
  }

  const expected = process.env["ADMIN_TOKEN"];
  if (expected) {
    const header = req.header("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : req.header("x-admin-token") ?? "";
    if (provided) {
      const expectedBuf = Buffer.from(expected, "utf8");
      const providedBuf = Buffer.from(provided, "utf8");
      if (providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf)) {
        next();
        return;
      }
    }
  }
  res.status(403).json({ error: "Owner-only action" });
}
