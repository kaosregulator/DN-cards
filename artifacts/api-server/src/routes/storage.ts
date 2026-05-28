import express, { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod/v4";
import { Readable } from "node:stream";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireDashboardAuth } from "../middlewares/dashboard-auth.js";

const router: IRouter = Router();
const storage = new ObjectStorageService();

const ALLOWED_IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|avif)$/i;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const requestUrlSchema = z.object({
  contentType: z.string().regex(/^image\/(png|jpe?g|gif|webp|avif)$/i, "contentType must be a supported image MIME"),
});

// POST /api/admin/uploads/request-url — admin-only; returns presigned PUT URL + objectPath to store on the card.
router.post("/admin/uploads/request-url", requireDashboardAuth, async (req, res) => {
  const parsed = requestUrlSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
    return;
  }
  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    // Convert https://storage.googleapis.com/<bucket>/<dir>/uploads/<id>?... → /objects/uploads/<id>
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
// CORS, so we accept raw image bytes here and PUT to GCS server-side. Client
// sends the file as the request body with Content-Type: image/<format>.
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
router.get("/storage/objects/*splat", async (req, res) => {
  const objectPath = req.path.replace(/^\/storage/, "");
  try {
    const file = await storage.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", (metadata.contentType as string) || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    const stream = file.createReadStream();
    stream.on("error", (err) => {
      req.log?.error({ err, objectPath }, "Stream error");
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    Readable.from(stream).pipe(res);
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
