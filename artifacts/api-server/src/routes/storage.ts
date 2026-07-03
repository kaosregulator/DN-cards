import express, { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireDashboardAuth } from "../middlewares/dashboard-auth.js";
import { getCachedImage, setCachedImage } from "../lib/imageCache";

const router: IRouter = Router();
const storage = new ObjectStorageService();

const ALLOWED_IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|avif)$/i;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

// Lazy-load sharp so the route still works if the package isn't present.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sharp: ((buf: Buffer) => any) | null | undefined = undefined;
async function loadSharp(): Promise<((buf: Buffer) => any) | null> {
  if (_sharp !== undefined) return _sharp;
  try {
    const mod = await import("sharp");
    _sharp = (mod.default ?? mod) as (buf: Buffer) => any;
  } catch {
    _sharp = null;
  }
  return _sharp;
}

const requestUrlSchema = { contentType: true };

// POST /api/admin/uploads/request-url — admin-only; returns presigned PUT URL + objectPath to store on the card.
router.post("/admin/uploads/request-url", requireDashboardAuth, async (req, res) => {
  const ct = (req.body as Record<string, unknown>)?.contentType;
  if (typeof ct !== "string" || !/^image\/(png|jpe?g|gif|webp|avif)$/i.test(ct)) {
    res.status(400).json({ error: "contentType must be a supported image MIME" });
    return;
  }
  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const url = new URL(uploadURL);
    const objectPath = storage.normalizeObjectEntityPath(`https://storage.googleapis.com${url.pathname}`);
    res.json({ uploadURL, objectPath });
  } catch (err) {
    req.log?.error({ err }, "Failed to sign upload URL");
    res.status(500).json({ error: "Failed to sign upload URL" });
  }
});

// POST /api/admin/uploads/file — admin-only; server-proxied upload.
// Browser PUTs to storage.googleapis.com from dncards.com are blocked by GCS
// CORS, so we accept raw image bytes here and PUT to GCS server-side.
router.post(
  "/admin/uploads/file",
  requireDashboardAuth,
  express.raw({ type: "image/*", limit: MAX_UPLOAD_BYTES }),
  async (req, res) => {
    const contentType = (req.header("content-type") ?? "").toLowerCase();
    if (!ALLOWED_IMAGE_MIME.test(contentType)) {
      res.status(400).json({ error: "Unsupported image type. Use PNG, JPG, GIF, WebP, or AVIF." });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Empty request body" });
      return;
    }
    try {
      const uploadURL = await storage.getObjectEntityUploadURL();
      const put = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": contentType, "Content-Length": String(req.body.length) },
        body: req.body,
      });
      if (!put.ok) {
        const detail = await put.text().catch(() => "");
        req.log?.error({ status: put.status, detail }, "GCS PUT failed");
        res.status(502).json({ error: `Upload to storage failed (${put.status})` });
        return;
      }
      const url = new URL(uploadURL);
      const objectPath = storage.normalizeObjectEntityPath(`https://storage.googleapis.com${url.pathname}`);
      res.json({ objectPath });
    } catch (err) {
      req.log?.error({ err }, "Server-side upload failed");
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

// GET /api/storage/objects/* — public; streams admin-uploaded card images.
// Supports ?w=N (16–800) to return a WebP thumbnail via sharp.
// Responses are cached on disk (/tmp/dn-img-cache) for 24 h so repeated
// requests skip the GCS round-trip entirely.
router.get("/storage/objects/*splat", async (req, res) => {
  const objectPath = req.path.replace(/^\/storage/, "");

  // Parse optional thumbnail width.
  const wRaw = typeof req.query.w === "string" ? parseInt(req.query.w, 10) : NaN;
  const thumbWidth = Number.isInteger(wRaw) && wRaw >= 16 && wRaw <= 800 ? wRaw : undefined;

  // ── 1. Cache hit ─────────────────────────────────────────────────────────
  const cached = await getCachedImage(objectPath, thumbWidth);
  if (cached) {
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Length", String(cached.data.length));
    res.setHeader("X-Cache", "HIT");
    res.end(cached.data);
    return;
  }

  // ── 2. Cache miss: fetch from GCS ─────────────────────────────────────────
  try {
    const file = await storage.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    const srcContentType: string = (metadata.contentType as string) || "application/octet-stream";

    // Collect the GCS stream into a Buffer (needed for sharp; also lets us
    // cache the result without streaming it twice).
    const stream = file.createReadStream();
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    const rawData = Buffer.concat(chunks);

    // ── 3. Thumbnail resize (sharp) ────────────────────────────────────────
    let serveData = rawData;
    let serveContentType = srcContentType;

    if (thumbWidth && ALLOWED_IMAGE_MIME.test(srcContentType)) {
      const sharpFn = await loadSharp();
      if (sharpFn) {
        try {
          serveData = await sharpFn(rawData)
            .resize(thumbWidth, null, { withoutEnlargement: true })
            .webp({ quality: 82 })
            .toBuffer();
          serveContentType = "image/webp";
        } catch (sharpErr) {
          req.log?.warn({ sharpErr, objectPath, thumbWidth }, "sharp resize failed, serving original");
          serveData = rawData;
          serveContentType = srcContentType;
        }
      }
    }

    // ── 4. Write to cache (non-blocking) ───────────────────────────────────
    // Cache the original separately from the resized version so both are
    // available without another GCS fetch.
    void setCachedImage(objectPath, rawData, srcContentType);
    if (thumbWidth && serveData !== rawData) {
      void setCachedImage(objectPath, serveData, serveContentType, thumbWidth);
    }

    // ── 5. Serve ───────────────────────────────────────────────────────────
    res.setHeader("Content-Type", serveContentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Length", String(serveData.length));
    res.setHeader("X-Cache", "MISS");
    res.end(serveData);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    req.log?.error({ err, objectPath }, "Object fetch failed");
    res.status(500).json({ error: "Object fetch failed" });
  }
});

export default router;
