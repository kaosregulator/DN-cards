import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

// ── Shared auth middleware ────────────────────────────────────────────────────
// A request is authenticated if EITHER:
//   1. It has a valid session cookie set by /api/auth/login, OR
//   2. It carries the master ADMIN_TOKEN as a Bearer header (break-glass /
//      legacy clients).
// We always allow the master token so admins can recover even if every
// dashboard_users row is deleted by accident.
export function requireDashboardAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.userId) {
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

// Owner-only guard. The master ADMIN_TOKEN always counts as owner.
export function requireDashboardOwner(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.isOwner) {
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
