import { Router, type IRouter, type Request, type Response } from "express";
import { db, suggestionsTable, insertSuggestionSchema } from "@workspace/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { createHash } from "node:crypto";
import { requireDashboardAuth } from "../middlewares/dashboard-auth.js";

const router: IRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/\S+/gi;
const MAX_URLS = 3;

function hashIp(ip: string): string {
  const salt = process.env["SESSION_SECRET"] ?? "fallback-suggestion-salt";
  return createHash("sha256").update(`${ip}|${salt}`).digest("hex");
}

function clientIp(req: Request): string {
  // express's `req.ip` already honours `trust proxy` when set; fall back to
  // socket address. We never persist the raw IP — only the salted hash.
  return req.ip ?? req.socket.remoteAddress ?? "0.0.0.0";
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown, res: Response): z.infer<T> | null {
  const r = schema.safeParse(value);
  if (!r.success) { res.status(400).json({ error: "Invalid payload", details: r.error.issues }); return null; }
  return r.data;
}

// Strip sensitive fields before returning to ANY admin. Even when the
// submitter chose to be non-anonymous we only expose username (not the
// snowflake) so admins can't DM-attack reporters. ipHash never leaves the
// server.
function sanitize(row: typeof suggestionsTable.$inferSelect) {
  const { ipHash: _ipHash, submitterDiscordId: _id, ...rest } = row;
  void _ipHash; void _id;
  return rest.anonymous
    ? { ...rest, submitterDiscordUsername: null }
    : rest;
}

// ── Public submit ────────────────────────────────────────────────────────────
// Honeypot field `website` must be empty (bots fill it). Body 20–4000 chars.
// At most 3 URLs in the body. Per-ip-hash rate limits: 5/10min and 20/day.
// 1-hour duplicate guard on (ip_hash, title).
const submitSchema = insertSuggestionSchema.extend({
  title: z.string().trim().min(4).max(160),
  body: z.string().trim().min(20).max(4000),
  // Honeypot — must be absent or empty.
  website: z.string().max(0).optional(),
});

router.post("/suggestions", async (req, res) => {
  const body = parse(submitSchema, req.body, res);
  if (!body) return;

  if ((body.body.match(URL_RE) ?? []).length > MAX_URLS) {
    res.status(400).json({ error: `At most ${MAX_URLS} URLs allowed in the body.` });
    return;
  }

  const ipHash = hashIp(clientIp(req));
  const now = new Date();
  const tenMinAgo = new Date(now.getTime() - 10 * 60_000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60_000);

  // Rate limits. One round-trip via two count() aggregates.
  const [rates] = await db.select({
    last10m: sql<number>`count(*) filter (where ${suggestionsTable.createdAt} > ${tenMinAgo})::int`,
    last24h: sql<number>`count(*) filter (where ${suggestionsTable.createdAt} > ${oneDayAgo})::int`,
  }).from(suggestionsTable).where(eq(suggestionsTable.ipHash, ipHash));

  if ((rates?.last10m ?? 0) >= 5) { res.status(429).json({ error: "Too many submissions. Try again in a few minutes." }); return; }
  if ((rates?.last24h ?? 0) >= 20) { res.status(429).json({ error: "Daily submission limit reached." }); return; }

  // Duplicate guard.
  const [dup] = await db.select({ id: suggestionsTable.id }).from(suggestionsTable)
    .where(and(
      eq(suggestionsTable.ipHash, ipHash),
      eq(suggestionsTable.title, body.title),
      gte(suggestionsTable.createdAt, oneHourAgo),
    )).limit(1);
  if (dup) { res.status(409).json({ error: "Looks like you already submitted that recently." }); return; }

  const anonymous = body.anonymous ?? true;
  const [row] = await db.insert(suggestionsTable).values({
    category: body.category,
    title: body.title,
    body: body.body,
    anonymous,
    submitterDiscordId: anonymous ? null : body.submitterDiscordId ?? null,
    submitterDiscordUsername: anonymous ? null : body.submitterDiscordUsername ?? null,
    ipHash,
  }).returning();

  res.status(201).json({ ok: true, id: row.id });
});

// ── Admin: list ──────────────────────────────────────────────────────────────
const listQuery = z.object({
  status: z.enum(["new", "in_review", "planned", "resolved", "rejected", "duplicate"]).optional(),
});

router.get("/admin/suggestions", requireDashboardAuth, async (req, res) => {
  const q = parse(listQuery, req.query, res);
  if (!q) return;
  const where = q.status ? eq(suggestionsTable.status, q.status) : undefined;
  const rows = await db.select().from(suggestionsTable)
    .where(where)
    .orderBy(desc(suggestionsTable.createdAt))
    .limit(500);
  res.json({ suggestions: rows.map(sanitize) });
});

// ── Admin: update status / notes ────────────────────────────────────────────
const patchSchema = z.object({
  status: z.enum(["new", "in_review", "planned", "resolved", "rejected", "duplicate"]).optional(),
  adminNotes: z.string().max(4000).optional(),
});
const idParam = z.object({ id: z.coerce.number().int().positive() });

router.patch("/admin/suggestions/:id", requireDashboardAuth, async (req, res) => {
  const params = parse(idParam, req.params, res);
  if (!params) return;
  const body = parse(patchSchema, req.body, res);
  if (!body) return;
  if (!body.status && body.adminNotes === undefined) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const patch: Record<string, unknown> = { ...body };
  if (body.status === "resolved" || body.status === "rejected" || body.status === "duplicate") {
    patch.resolvedAt = new Date();
    patch.resolvedBy = req.session?.userId ?? null;
  } else if (body.status) {
    patch.resolvedAt = null;
    patch.resolvedBy = null;
  }
  const [row] = await db.update(suggestionsTable).set(patch)
    .where(eq(suggestionsTable.id, params.id)).returning();
  if (!row) { res.status(404).json({ error: "Suggestion not found" }); return; }
  res.json({ suggestion: sanitize(row) });
});

export default router;
