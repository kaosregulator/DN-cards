import { Router, type IRouter } from "express";
import { db, dashboardUsersTable, setupTokensTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { randomBytes } from "node:crypto";
import { requireDashboardAuth, requireDashboardOwner } from "../middlewares/dashboard-auth.js";

const router: IRouter = Router();

router.use(requireDashboardAuth);

// ── GET /api/dashboard/users — any signed-in user can see the roster ──────────
router.get("/", async (_req, res) => {
  const rows = await db.select({
    id: dashboardUsersTable.id,
    username: dashboardUsersTable.username,
    isOwner: dashboardUsersTable.isOwner,
    createdAt: dashboardUsersTable.createdAt,
    lastLoginAt: dashboardUsersTable.lastLoginAt,
  }).from(dashboardUsersTable).orderBy(desc(dashboardUsersTable.isOwner), dashboardUsersTable.username);
  res.json({ users: rows });
});

// Below endpoints are owner-only.
router.use(requireDashboardOwner);

// ── POST /api/dashboard/users — generate a one-time invite link ───────────────
// Owner enters no password directly. We return a setup URL; owner copies and
// sends it to the new admin (in DM, Discord, whatever).
const inviteSchema = z.object({ note: z.string().trim().max(80).optional() });
router.post("/", async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  await db.insert(setupTokensTable).values({
    token,
    issuedToDiscordId: parsed.data.note ?? `web:${req.session?.username ?? "owner"}`,
    expiresAt,
  });
  res.status(201).json({ token, expiresAt, setupPath: `/setup/${token}` });
});

// ── POST /api/dashboard/users/:id/reset — issue a reset link for a user ───────
const idParam = z.object({ id: z.coerce.number().int().positive() });
router.post("/:id/reset", async (req, res) => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const [user] = await db.select().from(dashboardUsersTable).where(eq(dashboardUsersTable.id, parsed.data.id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(setupTokensTable).values({
    token,
    issuedToDiscordId: `reset:${user.username}`,
    resetForUserId: user.id,
    expiresAt,
  });
  res.status(201).json({ token, expiresAt, setupPath: `/setup/${token}`, username: user.username });
});

// ── DELETE /api/dashboard/users/:id ───────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const [user] = await db.select().from(dashboardUsersTable).where(eq(dashboardUsersTable.id, parsed.data.id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.isOwner) {
    // Refuse to delete the last owner so the dashboard can't become locked
    // out (the master ADMIN_TOKEN would still work, but we want to keep at
    // least one real account around).
    const owners = await db.select({ id: dashboardUsersTable.id }).from(dashboardUsersTable).where(eq(dashboardUsersTable.isOwner, true));
    if (owners.length <= 1) {
      res.status(409).json({ error: "Can't remove the last owner. Promote someone else first." });
      return;
    }
  }
  await db.delete(dashboardUsersTable).where(eq(dashboardUsersTable.id, parsed.data.id));
  res.json({ deleted: true, id: parsed.data.id });
});

// ── POST /api/dashboard/users/:id/promote — toggle owner flag ─────────────────
const promoteSchema = z.object({ isOwner: z.boolean() });
router.post("/:id/promote", async (req, res) => {
  const params = idParam.safeParse(req.params);
  const body = promoteSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }
  // Refuse to demote the last owner (mirrors the DELETE guard). Without this,
  // the dashboard could end up with zero owners and require break-glass.
  if (!body.data.isOwner) {
    const owners = await db.select({ id: dashboardUsersTable.id })
      .from(dashboardUsersTable)
      .where(eq(dashboardUsersTable.isOwner, true));
    const isTargetTheOnlyOwner = owners.length <= 1 && owners.some((o) => o.id === params.data.id);
    if (isTargetTheOnlyOwner) {
      res.status(409).json({ error: "Can't demote the last owner. Promote someone else first." });
      return;
    }
  }
  const [updated] = await db.update(dashboardUsersTable)
    .set({ isOwner: body.data.isOwner })
    .where(eq(dashboardUsersTable.id, params.data.id))
    .returning({ id: dashboardUsersTable.id, username: dashboardUsersTable.username, isOwner: dashboardUsersTable.isOwner });
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user: updated });
});

export default router;
