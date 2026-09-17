import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Ensure the Drizzle base schema exists before the bot queries it.
 *
 * Boot migrations only ALTER existing tables — a fresh Railway Postgres has
 * none. When `guild_settings` is missing we run `drizzle-kit push` once
 * (unless AUTO_DB_PUSH=0).
 */
export async function ensureBaseSchema(): Promise<void> {
  const mode = (process.env["AUTO_DB_PUSH"] ?? "").trim();
  if (mode === "0") return;

  let missing = mode === "1";
  if (!missing) {
    try {
      await pool.query("SELECT 1 FROM guild_settings LIMIT 1");
      return;
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code ?? "")
          : "";
      if (code !== "42P01") throw err;
      missing = true;
    }
  }

  if (!missing) return;

  logger.warn("Base tables missing — applying Drizzle schema (drizzle-kit push)…");
  runDrizzlePush();

  // Confirm before callers proceed.
  await pool.query("SELECT 1 FROM guild_settings LIMIT 1");
  logger.info("Base schema is present");
}

function runDrizzlePush(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  // Bundled: .../artifacts/api-server/dist/...  Source: .../artifacts/api-server/src/lib
  const candidates = [
    resolve(here, "../../.."), // dist → api-server → artifacts → repo
    resolve(here, "../../../.."), // src/lib → api-server → artifacts → repo
    process.cwd(),
  ];

  let repoRoot = process.cwd();
  for (const c of candidates) {
    if (existsSync(resolve(c, "lib/db/drizzle.config.ts"))) {
      repoRoot = c;
      break;
    }
  }

  const env = {
    ...process.env,
    CI: "true", // drizzle-kit: non-interactive
  };

  const result = spawnSync(
    "pnpm",
    ["--filter", "@workspace/db", "run", "push-force"],
    { cwd: repoRoot, stdio: "inherit", env },
  );

  if (result.error) {
    throw new Error(`Failed to spawn schema push: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Schema push failed with exit code ${result.status ?? 1}`);
  }
}
