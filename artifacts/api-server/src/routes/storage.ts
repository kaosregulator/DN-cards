import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod/v4";
import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const expected = process.env["ADMIN_TOKEN"];
  if (!expected) {
    res.status(503).json({ error: "ADMIN_TOKEN not configured on server" });
    return;
  }
  const header = req.header("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : req.header("x-admin-token") ?? "";
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    res.status(401).json({ error: "Invalid admin token" });
    return;
  }
  next();
}

const requestUrlSchema = z.object({
  contentType: z.string().regex(/^image\/(png|jpe?g|gif|webp|avif)$/i, "contentType must be a supported image MIME"),
});

// POST /api/admin/uploads/request-url — admin-only; returns presigned PUT URL + objectPath to store on the card.
router.post("/admin/uploads/request-url", requireAdmin, async (req, res) => {
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
