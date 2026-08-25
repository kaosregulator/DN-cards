// World Builder routes — mounted under /api/activity

import { Router, type IRouter, type Request, type Response } from "express";
import express from "express";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, normalize } from "node:path";
import { HOME_GUILD_ID } from "../bot/home-guild.js";
import { isAdmin } from "../bot/db.js";
import { logger } from "../lib/logger.js";
import { resolvedEnv } from "../lib/runtime-env.js";
import { canEditWorld, isDemoBuilderRequest, worldBuilderOpenMode } from "../bot/world-builder/auth.js";
import { builtinAssets, builtinPackMeta } from "../bot/world-builder/builtin-catalog.js";
import { importFolderFiles, importZipBuffer } from "../bot/world-builder/packs.js";
import {
  listImportedPacks,
  loadPackManifest,
  loadWorldDoc,
  removePack,
  resolvePackFile,
  saveWorldDoc,
} from "../bot/world-builder/store.js";
import type { WorldEditDocument } from "../bot/world-builder/types.js";

const DISCORD_API = "https://discord.com/api";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".json": "application/json",
};

function oauthConfigured(): boolean {
  return !!(resolvedEnv("DISCORD_CLIENT_ID") && resolvedEnv("DISCORD_CLIENT_SECRET"));
}

async function identify(req: Request): Promise<{ id: string; username: string; avatar: string | null } | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  try {
    const r = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const u = (await r.json()) as { id: string; username: string; avatar: string | null };
    return { id: u.id, username: u.username, avatar: u.avatar };
  } catch {
    return null;
  }
}

async function requireEditor(
  req: Request, res: Response,
): Promise<{ id: string; username: string } | null> {
  if (isDemoBuilderRequest(req) || (worldBuilderOpenMode() && !oauthConfigured())) {
    return { id: "demo-admin", username: "Demo Admin" };
  }
  const user = await identify(req);
  if (!user) {
    if (worldBuilderOpenMode()) return { id: "dev-admin", username: "Dev Admin" };
    res.status(401).json({ error: "Admin authentication required." });
    return null;
  }
  const ok = await canEditWorld(user.id);
  if (!ok && HOME_GUILD_ID) {
    // Also allow Discord Administrator via member fetch is expensive; stick to DB admins
    // plus open mode. Guild owners should be added via !addadmin.
    const dbAdmin = await isAdmin(HOME_GUILD_ID, user.id).catch(() => false);
    if (!dbAdmin) {
      res.status(403).json({ error: "World Builder is admin-only." });
      return null;
    }
  } else if (!ok) {
    res.status(403).json({ error: "World Builder is admin-only." });
    return null;
  }
  return user;
}

const router: IRouter = Router();

// GET /activity/world-builder/status
router.get("/world-builder/status", async (req, res) => {
  const demo = isDemoBuilderRequest(req);
  let canEdit = worldBuilderOpenMode() || demo;
  let userId: string | null = null;
  if (!canEdit) {
    const user = await identify(req);
    userId = user?.id ?? null;
    canEdit = userId ? await canEditWorld(userId) : false;
  }
  res.json({
    canEdit,
    openMode: worldBuilderOpenMode(),
    userId,
  });
});

// GET /activity/world-builder/catalog
router.get("/world-builder/catalog", async (req, res) => {
  const user = await requireEditor(req, res);
  if (!user) return;
  try {
    const builtin = builtinPackMeta();
    const imported = listImportedPacks();
    const assets = [
      ...builtinAssets(),
      ...imported.flatMap((p) => loadPackManifest(p.id)),
    ];
    res.json({ packs: [builtin, ...imported], assets });
  } catch (err) {
    logger.error({ err }, "world-builder catalog failed");
    res.status(500).json({ error: "Failed to load asset catalog." });
  }
});

// GET /activity/world-builder/maps/:mapKey
router.get("/world-builder/maps/:mapKey", async (req, res) => {
  // Readable by anyone authenticated OR open mode — overlays apply for all players
  // once saved. Edit still admin-gated on POST.
  const open = worldBuilderOpenMode() || isDemoBuilderRequest(req);
  if (!open) {
    const user = await identify(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
  }
  const mapKey = String(req.params.mapKey ?? "");
  res.json({ doc: loadWorldDoc(mapKey) });
});

// POST /activity/world-builder/maps/:mapKey
router.post("/world-builder/maps/:mapKey", async (req, res) => {
  const user = await requireEditor(req, res);
  if (!user) return;
  const mapKey = String(req.params.mapKey ?? "");
  const body = req.body?.doc as WorldEditDocument | undefined;
  if (!body || body.version !== 1) {
    res.status(400).json({ error: "Invalid world document." });
    return;
  }
  try {
    const saved = saveWorldDoc(mapKey, { ...body, mapKey }, user.id);
    res.json({ ok: true, doc: saved });
  } catch (err) {
    logger.error({ err, mapKey }, "world-builder save failed");
    res.status(500).json({ error: "Failed to save world." });
  }
});

// POST /activity/world-builder/packs/import  (raw zip)
router.post(
  "/world-builder/packs/import",
  express.raw({ type: ["application/zip", "application/octet-stream", "application/x-zip-compressed"], limit: "80mb" }),
  async (req, res) => {
    const user = await requireEditor(req, res);
    if (!user) return;
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? []);
    if (!buf.length) {
      res.status(400).json({ error: "Empty upload." });
      return;
    }
    try {
      const name = typeof req.query.name === "string" ? req.query.name : undefined;
      const summary = importZipBuffer(buf, { name });
      res.json({ ok: true, summary });
    } catch (err) {
      logger.error({ err }, "world-builder zip import failed");
      res.status(400).json({ error: "Failed to import ZIP. Ensure it is a valid archive with image assets." });
    }
  },
);

// POST /activity/world-builder/packs/import-folder  (JSON: files as base64)
router.post("/world-builder/packs/import-folder", async (req, res) => {
  const user = await requireEditor(req, res);
  if (!user) return;
  const name = typeof req.body?.name === "string" ? req.body.name : "Folder Import";
  const files = Array.isArray(req.body?.files) ? req.body.files as { path: string; dataBase64: string }[] : [];
  if (!files.length) {
    res.status(400).json({ error: "No files provided." });
    return;
  }
  if (files.length > 2000) {
    res.status(400).json({ error: "Too many files (max 2000)." });
    return;
  }
  try {
    const parsed = files.map((f) => ({
      relativePath: String(f.path ?? ""),
      data: Buffer.from(String(f.dataBase64 ?? ""), "base64"),
    })).filter((f) => f.relativePath && f.data.length > 0);
    const summary = importFolderFiles(parsed, { name });
    res.json({ ok: true, summary });
  } catch (err) {
    logger.error({ err }, "world-builder folder import failed");
    res.status(400).json({ error: "Failed to import folder." });
  }
});

// DELETE /activity/world-builder/packs/:packId
router.delete("/world-builder/packs/:packId", async (req, res) => {
  const user = await requireEditor(req, res);
  if (!user) return;
  const packId = String(req.params.packId ?? "");
  if (packId === "builtin") {
    res.status(400).json({ error: "Cannot delete the built-in pack." });
    return;
  }
  const ok = removePack(packId);
  res.json({ ok });
});

// GET /activity/assets/world-packs/:packId/files/*
router.get(/^\/assets\/world-packs\/([^/]+)\/files\/(.+)$/, (req, res) => {
  const packId = req.params[0] ?? "";
  const rel = normalize(req.params[1] ?? "").replace(/^(\.\.[/\\])+/, "");
  const full = resolvePackFile(packId, rel);
  if (!full || !existsSync(full)) {
    res.status(404).end();
    return;
  }
  const st = statSync(full);
  const ext = extname(full).toLowerCase();
  res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("Content-Length", String(st.size));
  createReadStream(full).pipe(res);
});

export default router;
