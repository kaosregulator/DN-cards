import { Router, type IRouter, type Response } from "express";
import { db, newsPostsTable, insertNewsPostSchema, updateNewsPostSchema } from "@workspace/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod/v4";
import { requireDashboardAuth } from "../middlewares/dashboard-auth.js";

const router: IRouter = Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });
const slugParam = z.object({ slug: z.string().min(1).max(160) });

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown, res: Response): z.infer<T> | null {
  const r = schema.safeParse(value);
  if (!r.success) { res.status(400).json({ error: "Invalid payload", details: r.error.issues }); return null; }
  return r.data;
}

// Slug normalizer: lowercase, alphanumerics + hyphens.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || `post-${Date.now()}`;
}

// ── Public: list published posts (pinned first, then newest first) ──────────
router.get("/news", async (_req, res) => {
  const rows = await db.select().from(newsPostsTable)
    .where(isNotNull(newsPostsTable.publishedAt))
    .orderBy(desc(newsPostsTable.pinned), desc(newsPostsTable.publishedAt));
  res.json({ posts: rows });
});

// ── Public: single post by slug (must be published) ─────────────────────────
router.get("/news/:slug", async (req, res) => {
  const params = parse(slugParam, req.params, res);
  if (!params) return;
  const [row] = await db.select().from(newsPostsTable)
    .where(and(eq(newsPostsTable.slug, params.slug), isNotNull(newsPostsTable.publishedAt)));
  if (!row) { res.status(404).json({ error: "Post not found" }); return; }
  res.json({ post: row });
});

// ── Admin: list all posts (including drafts) ────────────────────────────────
router.get("/admin/news", requireDashboardAuth, async (_req, res) => {
  const rows = await db.select().from(newsPostsTable)
    .orderBy(desc(newsPostsTable.pinned), desc(newsPostsTable.createdAt));
  res.json({ posts: rows });
});

// ── Admin: create ───────────────────────────────────────────────────────────
router.post("/admin/news", requireDashboardAuth, async (req, res) => {
  const body = parse(insertNewsPostSchema, req.body, res);
  if (!body) return;
  const authorUserId = req.session?.userId ?? null;
  try {
    const [row] = await db.insert(newsPostsTable).values({
      ...body,
      slug: slugify(body.slug || body.title),
      authorUserId,
    }).returning();
    res.status(201).json({ post: row });
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "Slug already in use" }); return; }
    throw err;
  }
});

// ── Admin: update ───────────────────────────────────────────────────────────
router.patch("/admin/news/:id", requireDashboardAuth, async (req, res) => {
  const params = parse(idParam, req.params, res);
  if (!params) return;
  const body = parse(updateNewsPostSchema, req.body, res);
  if (!body) return;
  try {
    const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };
    if (typeof body.slug === "string") patch.slug = slugify(body.slug);
    const [row] = await db.update(newsPostsTable).set(patch)
      .where(eq(newsPostsTable.id, params.id)).returning();
    if (!row) { res.status(404).json({ error: "Post not found" }); return; }
    res.json({ post: row });
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "Slug already in use" }); return; }
    throw err;
  }
});

// ── Admin: delete ───────────────────────────────────────────────────────────
router.delete("/admin/news/:id", requireDashboardAuth, async (req, res) => {
  const params = parse(idParam, req.params, res);
  if (!params) return;
  await db.delete(newsPostsTable).where(eq(newsPostsTable.id, params.id));
  res.json({ deleted: true, id: params.id });
});

export default router;
