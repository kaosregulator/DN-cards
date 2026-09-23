#!/usr/bin/env node
/**
 * Production start wrapper for Railway (and similar hosts).
 *
 * 1. Applies the Drizzle schema when the DB is empty / AUTO_DB_PUSH=1
 * 2. Starts the bundled API + Discord bot
 *
 * Env:
 *   AUTO_DB_PUSH=1  — always run `drizzle-kit push` before start (first deploy)
 *   AUTO_DB_PUSH=0  — never push; only start
 *   (unset)         — push only when `guild_settings` is missing
 *
 * Also ensures Quiet Mode (`quiet_*`) tables exist on already-provisioned DBs
 * (guild_settings present → drizzle push is skipped, so we CREATE IF NOT EXISTS).
 *
 * This is the default `pnpm start` for @workspace/api-server so Railway
 * custom start commands that call package start still bootstrap schema.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const serverEntry = resolve(repoRoot, "artifacts/api-server/dist/index.mjs");
const localEntry = resolve(__dirname, "../dist/index.mjs");

function buildPoolConfig(connectionString) {
  const sslMode = (process.env.DATABASE_SSL ?? "").trim().toLowerCase();
  const forceOff = sslMode === "0" || sslMode === "false" || sslMode === "disable";
  const forceOn =
    sslMode === "1" ||
    sslMode === "true" ||
    sslMode === "require" ||
    sslMode === "prefer";
  const looksLocal = /@(localhost|127\.0\.0\.1)([:/]|$)/i.test(connectionString);
  const looksManaged =
    /railway\.(app|internal)|rlwy\.net|neon\.tech|supabase\.(co|com)|amazonaws\.com|azure\.com|render\.com/i.test(
      connectionString,
    ) || /[?&]sslmode=require\b/i.test(connectionString);
  const useSsl = forceOn || (!forceOff && !looksLocal && looksManaged);
  return {
    connectionString,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

async function baseSchemaMissing() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new pg.Pool(buildPoolConfig(url));
  try {
    await pool.query("SELECT 1 FROM guild_settings LIMIT 1");
    return false;
  } catch (err) {
    if (err && typeof err === "object" && err.code === "42P01") return true;
    console.error("Database check failed:", err?.message ?? err);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

/** Quiet Mode tables — create when missing on an already-provisioned DB. */
async function ensureQuietTables() {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const pool = new pg.Pool(buildPoolConfig(url));
  try {
    await pool.query("SELECT 1 FROM quiet_state LIMIT 1");
    return;
  } catch (err) {
    if (!(err && typeof err === "object" && err.code === "42P01")) {
      console.warn("Quiet schema check skipped:", err?.message ?? err);
      return;
    }
  }

  console.log("Quiet Mode tables missing — creating quiet_* schema…");
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiet_guild_settings (
        id                 SERIAL PRIMARY KEY,
        guild_id           TEXT NOT NULL UNIQUE,
        enabled            BOOLEAN NOT NULL DEFAULT TRUE,
        quiet_channel_id   TEXT,
        quiet_category_id  TEXT,
        whitelist_role_id  TEXT,
        blacklist_role_id  TEXT,
        audio_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiet_state (
        id                 SERIAL PRIMARY KEY,
        guild_id           TEXT NOT NULL,
        user_id            TEXT NOT NULL,
        entered_at         TIMESTAMP NOT NULL DEFAULT NOW(),
        entered_by         TEXT NOT NULL,
        theme              TEXT,
        quote_id           TEXT,
        quote_text         TEXT,
        audio_id           TEXT,
        last_channel_id    TEXT,
        room_message_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
        overwrite_targets  JSONB NOT NULL DEFAULT '[]'::jsonb,
        needs_recovery     BOOLEAN NOT NULL DEFAULT FALSE,
        admin_bypass       BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS quiet_state_guild_user_uniq ON quiet_state (guild_id, user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS quiet_state_guild_idx ON quiet_state (guild_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS quiet_state_recovery_idx ON quiet_state (needs_recovery)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiet_user_prefs (
        id                 SERIAL PRIMARY KEY,
        guild_id           TEXT NOT NULL,
        user_id            TEXT NOT NULL,
        recent_audio_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
        recent_quote_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS quiet_user_prefs_guild_user_uniq ON quiet_user_prefs (guild_id, user_id)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiet_audio_config (
        id          SERIAL PRIMARY KEY,
        audio_id    TEXT NOT NULL UNIQUE,
        enabled     BOOLEAN NOT NULL DEFAULT TRUE,
        weight      INTEGER NOT NULL DEFAULT 1,
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("Quiet Mode tables ready");
  } catch (err) {
    console.error("Failed to create Quiet Mode tables:", err?.message ?? err);
    // Non-fatal here — boot migrations in the app also try; start anyway.
  } finally {
    await pool.end().catch(() => {});
  }
}

function runDbPush() {
  console.log("Applying database schema (drizzle-kit push-force)…");
  const result = spawnSync(
    "pnpm",
    ["--filter", "@workspace/db", "run", "push-force"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        CI: "true",
        // Match runtime Pool: never hard-fail on managed Postgres certs.
        NODE_TLS_REJECT_UNAUTHORIZED:
          process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? "0",
      },
    },
  );
  if (result.status !== 0) {
    console.error(
      "Schema push failed — aborting start.\n" +
        "This usually means DATABASE_URL cannot be reached with TLS. " +
        "Confirm the Postgres plugin is linked, then redeploy. " +
        "You can also set DATABASE_SSL=disable for railway.internal URLs.",
    );
    process.exit(result.status ?? 1);
  }
}

async function main() {
  const entry = existsSync(serverEntry)
    ? serverEntry
    : existsSync(localEntry)
      ? localEntry
      : null;
  if (!entry) {
    console.error(
      `Built server not found at ${serverEntry} (or ${localEntry}). Run the Railway build first.`,
    );
    process.exit(1);
  }

  const mode = (process.env.AUTO_DB_PUSH ?? "").trim();
  if (mode === "1") {
    runDbPush();
  } else if (mode !== "0") {
    if (await baseSchemaMissing()) {
      console.log("Base tables missing — running one-time schema push…");
      runDbPush();
    }
  }

  // Existing Railway DBs skip drizzle push (guild_settings already present).
  // Quiet Mode was added later — ensure its tables exist before the bot starts.
  if (mode !== "0") {
    await ensureQuietTables();
  }

  const child = spawnSync(process.execPath, ["--enable-source-maps", entry], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  process.exit(child.status ?? 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
