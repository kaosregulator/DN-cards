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
