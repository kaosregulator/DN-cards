// ─────────────────────────────────────────────────────────────────────────────
// Card image mirror — a durable, off-site backup of every card's art.
//
// The primary card art lives in one Replit Object Storage bucket. That single
// copy is the whole risk this module addresses: it mirrors each card's image
// (plus a lower-res thumbnail) into a SECOND store you own — Cloudflare R2 (or
// any S3-compatible endpoint) — so the art survives anything happening to the
// primary bucket, is browsable in a dashboard you control, and can be served at
// low res to save bandwidth.
//
// Design guarantees (this is production data — nothing here may lose an image):
//   • READ-ONLY on the source. It downloads originals; it never writes, moves,
//     or deletes them. The primary bucket is untouched.
//   • ADDITIVE. It only writes new objects into R2 and new rows into the
//     `card_image_backups` catalogue. No existing table or object changes.
//   • INERT until configured. With no R2_* env vars, `startCardImageMirror()`
//     returns immediately and imports nothing — merging this changes nothing.
//   • IDEMPOTENT + RESUMABLE. Safe to run every boot; it mirrors only cards that
//     are new or whose art changed, and a crash mid-pass just resumes next boot.
//   • SINGLE-FLIGHT across instances. A Postgres advisory lock means only one
//     Autoscale instance mirrors at a time, so no double uploads.
//
// Configuration (Replit secrets):
//   R2_ACCESS_KEY_ID       — required
//   R2_SECRET_ACCESS_KEY   — required
//   R2_BUCKET              — required
//   R2_ACCOUNT_ID          — required unless R2_ENDPOINT is set
//   R2_ENDPOINT            — optional; defaults to the R2 account endpoint
//   R2_PUBLIC_BASE_URL     — optional; base for the public URL of a mirrored key
//   CARD_MIRROR_ENABLED    — optional "false" kill-switch even when keys present
//   CARD_MIRROR_THUMB_WIDTH — optional thumbnail width in px (default 512)
//   CARD_MIRROR_PREFIX     — optional key prefix (default "card-archive")
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage.js";

// A fixed key for the cross-instance advisory lock (any stable 32-bit int).
const MIRROR_ADVISORY_LOCK_KEY = 0x0ca7_d10; // "card mirror"
const BATCH_SIZE = 25;
// A gentle pace so a first full backup of a few hundred cards never spikes CPU
// or hammers R2. One card at a time with a short breather.
const PER_CARD_DELAY_MS = 200;
// Re-scan for new/changed cards on this cadence so art added after boot gets
// backed up too, without a restart.
const RESCAN_INTERVAL_MS = 30 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface MirrorConfig {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  publicBaseUrl: string | null;
  thumbWidth: number;
  prefix: string;
}

function readConfig(): MirrorConfig | null {
  const env = process.env;
  if ((env["CARD_MIRROR_ENABLED"] ?? "").toLowerCase() === "false") return null;
  const accessKeyId = env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = env["R2_SECRET_ACCESS_KEY"];
  const bucket = env["R2_BUCKET"];
  if (!accessKeyId || !secretAccessKey || !bucket) return null;

  let endpoint = env["R2_ENDPOINT"] ?? "";
  if (!endpoint) {
    const accountId = env["R2_ACCOUNT_ID"];
    if (!accountId) return null;
    endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  }
  const thumbWidth = Math.max(64, Math.min(2048, Number(env["CARD_MIRROR_THUMB_WIDTH"]) || 512));
  const prefix = (env["CARD_MIRROR_PREFIX"] || "card-archive").replace(/^\/+|\/+$/g, "");
  const publicBaseUrl = env["R2_PUBLIC_BASE_URL"]?.replace(/\/+$/, "") || null;

  return { accessKeyId, secretAccessKey, bucket, endpoint, publicBaseUrl, thumbWidth, prefix };
}

// The @aws-sdk/client-s3 client, loaded lazily so nothing is imported when the
// mirror is disabled. The spec is held in a variable so the bundler leaves the
// import as a runtime require (the sdk is externalized) and typecheck treats it
// as `any` — no dev dependency on the sdk's types is needed.
type S3Client = { send: (command: unknown) => Promise<unknown> };
interface S3Module {
  S3Client: new (cfg: unknown) => S3Client;
  PutObjectCommand: new (input: unknown) => unknown;
}

async function loadS3(): Promise<S3Module | null> {
  try {
    const spec = "@aws-sdk/client-s3";
    return (await import(spec)) as unknown as S3Module;
  } catch (err) {
    logger.warn({ err }, "card-mirror: @aws-sdk/client-s3 not available — mirror disabled");
    return null;
  }
}

// ── Source resolution (read-only) ────────────────────────────────────────────

/** `/objects/...` form, or null if the URL is not one of our object paths. */
function toObjectPath(imageUrl: string): string | null {
  if (imageUrl.startsWith("/objects/")) return imageUrl;
  try {
    const u = new URL(imageUrl);
    const idx = u.pathname.indexOf("/api/storage/objects/");
    if (idx !== -1) return u.pathname.slice(idx + "/api/storage".length);
    if (u.pathname.startsWith("/objects/")) return u.pathname;
  } catch { /* not an absolute URL */ }
  return null;
}

/** Absolutize a relative (dashboard/static) image path against REPLIT_DOMAINS. */
function absolutize(imageUrl: string): string | null {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (imageUrl.startsWith("/")) {
    const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
    return domain ? `https://${domain}${imageUrl}` : null;
  }
  return null;
}

interface SourceBytes { buf: Buffer; contentType: string | null; }

/**
 * Download the ORIGINAL card art. Never writes anything back. Object-storage
 * paths are pulled straight from the primary store; everything else is fetched.
 * Returns null when the source genuinely can't be reached (caller records
 * `source_missing` and moves on — no original is ever lost by this).
 */
async function readSource(imageUrl: string, svc: ObjectStorageService): Promise<SourceBytes | null> {
  const objectPath = toObjectPath(imageUrl);
  if (objectPath) {
    try {
      const file = await svc.getObjectEntityFile(objectPath);
      const resp = await svc.downloadObject(file, 60);
      const buf = Buffer.from(await resp.arrayBuffer());
      return { buf, contentType: resp.headers.get("Content-Type") };
    } catch (err) {
      if (!(err instanceof ObjectNotFoundError)) {
        logger.debug({ err, imageUrl }, "card-mirror: object-storage read failed, will try HTTP");
      }
      // fall through to an HTTP fetch of the public URL
    }
  }
  const abs = absolutize(imageUrl);
  if (!abs) return null;
  try {
    const res = await fetch(abs, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, contentType: res.headers.get("content-type") };
  } catch (err) {
    logger.debug({ err, imageUrl }, "card-mirror: source fetch failed");
    return null;
  }
}

// Sniff a container from magic bytes so the mirrored object gets a sane
// extension + content type even when the source URL has none.
function sniff(buf: Buffer): { ext: string; contentType: string } {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return { ext: "png", contentType: "image/png" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { ext: "jpg", contentType: "image/jpeg" };
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46)
    return { ext: "gif", contentType: "image/gif" };
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return { ext: "webp", contentType: "image/webp" };
  return { ext: "img", contentType: "application/octet-stream" };
}

// Lower-res WebP thumbnail via sharp (same dependency the spawn reveal uses).
// Best-effort: null on any failure, and the full-res copy still stands alone.
async function makeThumb(buf: Buffer, width: number): Promise<Buffer | null> {
  try {
    const mod = await import("sharp");
    const sharp = (mod as unknown as { default: (input: Buffer, opts?: unknown) => {
      resize: (o: unknown) => { webp: (o: unknown) => { toBuffer: () => Promise<Buffer> } };
    } }).default;
    return await sharp(buf, { animated: false })
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (err) {
    logger.debug({ err }, "card-mirror: thumbnail generation failed");
    return null;
  }
}

// ── R2 upload ────────────────────────────────────────────────────────────────

class R2Uploader {
  constructor(
    private readonly client: S3Client,
    private readonly PutObjectCommand: new (input: unknown) => unknown,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new this.PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
  }
}

// ── The one-card unit of work ────────────────────────────────────────────────

interface CardRow { id: number; guild_id: string; image_url: string | null; }

async function mirrorCard(
  card: CardRow,
  cfg: MirrorConfig,
  svc: ObjectStorageService,
  up: R2Uploader,
): Promise<"ok" | "source_missing" | "error"> {
  if (!card.image_url) return "source_missing";

  const source = await readSource(card.image_url, svc);
  if (!source) {
    await recordBackup(card, cfg, { status: "source_missing", error: "source unreachable" });
    return "source_missing";
  }

  const checksum = createHash("sha256").update(source.buf).digest("hex");
  const kind = sniff(source.buf);
  const contentType = source.contentType || kind.contentType;
  const fullKey = `${cfg.prefix}/${card.guild_id}/${card.id}.${kind.ext}`;
  const thumbKey = `${cfg.prefix}/${card.guild_id}/thumb/${card.id}.webp`;

  try {
    await up.put(fullKey, source.buf, contentType);
    let thumbBytes: number | null = null;
    let storedThumbKey: string | null = null;
    const thumb = await makeThumb(source.buf, cfg.thumbWidth);
    if (thumb) {
      await up.put(thumbKey, thumb, "image/webp");
      thumbBytes = thumb.length;
      storedThumbKey = thumbKey;
    }
    await recordBackup(card, cfg, {
      status: "ok",
      fullKey,
      thumbKey: storedThumbKey,
      checksum,
      bytes: source.buf.length,
      thumbBytes,
      contentType,
    });
    return "ok";
  } catch (err) {
    logger.warn({ err, cardId: card.id }, "card-mirror: upload failed");
    await recordBackup(card, cfg, { status: "error", fullKey, error: errString(err) });
    return "error";
  }
}

function errString(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

interface BackupFields {
  status: "ok" | "source_missing" | "error";
  fullKey?: string;
  thumbKey?: string | null;
  checksum?: string | null;
  bytes?: number | null;
  thumbBytes?: number | null;
  contentType?: string | null;
  error?: string | null;
}

// Upsert the catalogue row. On a failure that never produced a key we still
// need a non-null full_key (the column is NOT NULL) — use the intended key so
// the row records the attempt and is retried next pass.
async function recordBackup(card: CardRow, cfg: MirrorConfig, f: BackupFields): Promise<void> {
  const fullKey = f.fullKey ?? `${cfg.prefix}/${card.guild_id}/${card.id}`;
  await pool.query(
    `INSERT INTO card_image_backups
       (card_id, guild_id, source_url, full_key, thumb_key, checksum, bytes, thumb_bytes, content_type, status, error, mirrored_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
     ON CONFLICT (card_id) DO UPDATE SET
       guild_id     = EXCLUDED.guild_id,
       source_url   = EXCLUDED.source_url,
       full_key     = EXCLUDED.full_key,
       thumb_key    = EXCLUDED.thumb_key,
       checksum     = EXCLUDED.checksum,
       bytes        = EXCLUDED.bytes,
       thumb_bytes  = EXCLUDED.thumb_bytes,
       content_type = EXCLUDED.content_type,
       status       = EXCLUDED.status,
       error        = EXCLUDED.error,
       updated_at   = NOW()`,
    [
      card.id, card.guild_id, card.image_url, fullKey, f.thumbKey ?? null,
      f.checksum ?? null, f.bytes ?? null, f.thumbBytes ?? null, f.contentType ?? null,
      f.status, f.error ?? null,
    ],
  );
}

// ── The pass ─────────────────────────────────────────────────────────────────

// Cards needing a mirror: never backed up, art changed since last backup, or a
// prior attempt errored (retried). 'ok' rows whose source_url still matches are
// skipped, so a steady-state pass does almost no work.
//
// KEYSET pagination by card id (`id > afterId`) — NOT a plain LIMIT. A failed
// or source-missing card stays "pending", so a LIMIT/offset scan would return
// the same unresolved rows forever within one pass. Advancing past the highest
// id we've seen guarantees each pass marches forward exactly once; failures are
// simply retried on the NEXT pass (next re-scan / next boot).
async function fetchPending(afterId: number, limit: number): Promise<CardRow[]> {
  const { rows } = await pool.query<CardRow>(
    `SELECT c.id, c.guild_id, c.image_url
       FROM cards c
       LEFT JOIN card_image_backups b ON b.card_id = c.id
      WHERE c.image_url IS NOT NULL
        AND c.is_archived = false
        AND c.id > $1
        AND (b.card_id IS NULL
             OR b.source_url IS DISTINCT FROM c.image_url
             OR b.status <> 'ok')
      ORDER BY c.id
      LIMIT $2`,
    [afterId, limit],
  );
  return rows;
}

let running = false;

async function runPass(cfg: MirrorConfig): Promise<void> {
  if (running) return;
  running = true;

  // Single-flight across Autoscale instances via a session advisory lock.
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked", [MIRROR_ADVISORY_LOCK_KEY],
    );
    if (!rows[0]?.locked) {
      logger.debug("card-mirror: another instance holds the mirror lock — skipping this pass");
      return;
    }

    const s3mod = await loadS3();
    if (!s3mod) return;
    const s3 = new s3mod.S3Client({
      region: "auto",
      endpoint: cfg.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
    const up = new R2Uploader(s3, s3mod.PutObjectCommand, cfg.bucket);
    const svc = new ObjectStorageService();

    let ok = 0, missing = 0, errored = 0, afterId = 0;
    for (;;) {
      const batch = await fetchPending(afterId, BATCH_SIZE);
      if (batch.length === 0) break;
      for (const card of batch) {
        const result = await mirrorCard(card, cfg, svc, up);
        if (result === "ok") ok++;
        else if (result === "source_missing") missing++;
        else errored++;
        afterId = card.id; // keyset cursor — always advances, never revisits
        await sleep(PER_CARD_DELAY_MS);
      }
    }
    if (ok || missing || errored) {
      logger.info({ ok, missing, errored }, "card-mirror: pass complete");
    }
  } finally {
    // Release the advisory lock on the same session before returning it.
    await client.query("SELECT pg_advisory_unlock($1)", [MIRROR_ADVISORY_LOCK_KEY]).catch(() => {});
    client.release();
    running = false;
  }
}

// ── Public entry ─────────────────────────────────────────────────────────────

let started = false;

/**
 * Start the background card-art mirror. No-op (and imports nothing) unless the
 * R2 secrets are present. Safe to call once at boot; it runs an initial pass
 * shortly after startup and re-scans periodically for new/changed art.
 */
export function startCardImageMirror(): void {
  if (started) return;
  const cfg = readConfig();
  if (!cfg) {
    logger.debug("card-mirror: R2 not configured — mirror disabled");
    return;
  }
  started = true;
  logger.info({ endpoint: cfg.endpoint, bucket: cfg.bucket, prefix: cfg.prefix }, "card-mirror: enabled");

  // Delay the first pass so it never competes with boot migrations / bot login.
  setTimeout(() => { void runPass(cfg).catch((err) => logger.error({ err }, "card-mirror: pass failed")); }, 30_000);
  const timer = setInterval(() => {
    void runPass(cfg).catch((err) => logger.error({ err }, "card-mirror: pass failed"));
  }, RESCAN_INTERVAL_MS);
  timer.unref?.();
}

// ── Status / on-demand trigger (for the admin hub) ───────────────────────────

export interface MirrorStatus {
  /** R2 secrets present — the mirror is on. */
  configured: boolean;
  /** A pass is running right now. */
  running: boolean;
  endpoint: string | null;
  bucket: string | null;
  /** Cards with art that are eligible to be mirrored (not archived). */
  totalWithImages: number;
  /** Fully backed up and current. */
  ok: number;
  /** Waiting to be mirrored (new, changed, or a prior error to retry). */
  pending: number;
  /** Last attempt failed to upload — retried on the next pass. */
  errored: number;
  /** Source image couldn't be read — retried on the next pass. */
  sourceMissing: number;
  /** Thumbnails stored. */
  thumbs: number;
  /** Total bytes of full-res copies in R2. */
  bytes: number;
  lastMirroredAt: Date | null;
}

export async function getMirrorStatus(): Promise<MirrorStatus> {
  const cfg = readConfig();
  const base: MirrorStatus = {
    configured: !!cfg, running,
    endpoint: cfg?.endpoint ?? null, bucket: cfg?.bucket ?? null,
    totalWithImages: 0, ok: 0, pending: 0, errored: 0, sourceMissing: 0,
    thumbs: 0, bytes: 0, lastMirroredAt: null,
  };
  try {
    const [total, byStatus, pending] = await Promise.all([
      pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM cards WHERE image_url IS NOT NULL AND is_archived = false`,
      ),
      pool.query<{ status: string; n: string; thumbs: string; bytes: string }>(
        `SELECT status,
                count(*)::text AS n,
                count(thumb_key)::text AS thumbs,
                COALESCE(sum(bytes), 0)::text AS bytes
           FROM card_image_backups GROUP BY status`,
      ),
      pool.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM cards c
           LEFT JOIN card_image_backups b ON b.card_id = c.id
          WHERE c.image_url IS NOT NULL
            AND c.is_archived = false
            AND (b.card_id IS NULL
                 OR b.source_url IS DISTINCT FROM c.image_url
                 OR b.status <> 'ok')`,
      ),
    ]);
    const last = await pool.query<{ t: Date | null }>(
      `SELECT max(mirrored_at) AS t FROM card_image_backups`,
    );
    base.totalWithImages = Number(total.rows[0]?.n ?? 0);
    base.pending = Number(pending.rows[0]?.n ?? 0);
    for (const r of byStatus.rows) {
      const n = Number(r.n);
      if (r.status === "ok") { base.ok = n; base.thumbs = Number(r.thumbs); base.bytes = Number(r.bytes); }
      else if (r.status === "error") base.errored = n;
      else if (r.status === "source_missing") base.sourceMissing = n;
    }
    base.lastMirroredAt = last.rows[0]?.t ?? null;
  } catch (err) {
    // Table may not exist yet on a brand-new DB before the first boot migration.
    logger.debug({ err }, "card-mirror: status query failed");
  }
  return base;
}

/**
 * Kick a mirror pass on demand (the admin hub's "Back up now"). Returns why it
 * couldn't start, if it didn't. The pass itself runs in the background.
 */
export function triggerMirrorPass(): { started: boolean; reason?: string } {
  const cfg = readConfig();
  if (!cfg) return { started: false, reason: "not_configured" };
  if (running) return { started: false, reason: "already_running" };
  void runPass(cfg).catch((err) => logger.error({ err }, "card-mirror: manual pass failed"));
  return { started: true };
}
