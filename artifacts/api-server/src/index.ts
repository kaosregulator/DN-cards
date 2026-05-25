import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./bot/index";
import { pool } from "@workspace/db";

// Idempotent runtime migrations. Drizzle `db push` only runs against dev;
// production gets schema changes applied here on boot. Each statement uses
// `IF NOT EXISTS` so reruns are safe.
async function runBootMigrations() {
  await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS podium_place integer`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS cards_podium_place_uniq ON cards (podium_place) WHERE podium_place IS NOT NULL`);
  logger.info("Boot migrations applied");
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  // Fail fast on migration errors: serving with a mismatched schema causes
  // confusing runtime failures (missing columns) or — worse for the podium
  // feature — duplicate slot assignments if the unique index didn't apply.
  try {
    await runBootMigrations();
  } catch (err) {
    logger.error({ err }, "Boot migrations failed — refusing to start");
    process.exit(1);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });

  // Start Discord bot alongside the API server
  startBot().catch((err) => {
    logger.error({ err }, "Bot startup failed");
  });
}

main();
