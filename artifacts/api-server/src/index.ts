import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./bot/index";
import { pool } from "@workspace/db";
import { SEED_SQL } from "./lib/seedData.js";

// Idempotent runtime migrations. Drizzle `db push` only runs against dev;
// production gets schema changes applied here on boot. Each statement uses
// `IF NOT EXISTS` so reruns are safe.
async function runBootMigrations() {
  await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS podium_place integer`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS cards_podium_place_uniq ON cards (podium_place) WHERE podium_place IS NOT NULL`);
  await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS preview_animation text`);
  await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS preview_bg_color text`);
  await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS display_orientation text`);
  await pool.query(`ALTER TABLE card_display_overrides ADD COLUMN IF NOT EXISTS display_category text`);

  // Convert card_type from enum → text so admins can use any free-form label.
  // Idempotent: only runs while the column still has the enum type.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cards' AND column_name = 'card_type'
          AND data_type = 'USER-DEFINED'
      ) THEN
        ALTER TABLE cards ALTER COLUMN card_type TYPE text USING card_type::text;
        ALTER TABLE cards ALTER COLUMN card_type SET DEFAULT 'vehicle';
      END IF;
    END $$;
  `);

  // One-time data fix: when the dashboard moved from /dashboard/ to / (May 2026),
  // seed event card images stored as "https://<host>/dashboard/<file>" stopped
  // resolving. Convert any such absolute URL to a relative "/<file>" so they
  // load from whichever domain the user is on. Idempotent — only matches rows
  // that still have the old prefix.
  await pool.query(`
    UPDATE cards
       SET image_url = regexp_replace(image_url, '^https?://[^/]+/dashboard/', '/')
     WHERE image_url ~ '^https?://[^/]+/dashboard/'
  `);

  // Legacy rarity assignment cleanup: early Setup Hub builds could persist a
  // built-in rarity name in card_rarity_overrides.custom_rarity_slug. That row
  // does not join to custom_rarities, so resolvers fell back to cards.rarity
  // (often "common"). Promote those orphan built-in assignments into cards.rarity
  // and remove only the orphan rows. Real custom tiers with the same slug are
  // preserved by the NOT EXISTS guard.
  await pool.query(`
    WITH legacy_builtin AS (
      SELECT o.guild_id, o.card_id, o.custom_rarity_slug
      FROM card_rarity_overrides o
      WHERE o.custom_rarity_slug IN ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic')
        AND NOT EXISTS (
          SELECT 1
          FROM custom_rarities c
          WHERE c.guild_id = o.guild_id
            AND c.slug = o.custom_rarity_slug
        )
    )
    UPDATE cards
       SET rarity = legacy_builtin.custom_rarity_slug::rarity
      FROM legacy_builtin
     WHERE cards.id = legacy_builtin.card_id
       AND cards.rarity::text <> legacy_builtin.custom_rarity_slug
  `);
  await pool.query(`
    DELETE FROM card_rarity_overrides o
    WHERE o.custom_rarity_slug IN ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic')
      AND NOT EXISTS (
        SELECT 1
        FROM custom_rarities c
        WHERE c.guild_id = o.guild_id
          AND c.slug = o.custom_rarity_slug
      )
  `);

  // One-time backfill: if no card currently holds a podium slot, seed it from
  // the old name-based heuristic (1st/2nd/3rd in the name of an event card).
  // Idempotent — once any card has podium_place set, the inner NOT EXISTS
  // guard makes this a no-op so admin picks are never overwritten. DISTINCT ON
  // picks a single winner per slot deterministically (lowest id).
  const { rows: existing } = await pool.query(`SELECT 1 FROM cards WHERE podium_place IS NOT NULL LIMIT 1`);
  if (existing.length === 0) {
    await pool.query(`
      UPDATE cards
      SET podium_place = sub.place
      FROM (
        SELECT DISTINCT ON (place) id, place FROM (
          SELECT id,
            CASE
              WHEN name ~* '\\m1st\\M' THEN 1
              WHEN name ~* '\\m2nd\\M' THEN 2
              WHEN name ~* '\\m3rd\\M' THEN 3
            END AS place
          FROM cards
          WHERE is_event_exclusive = true AND is_archived = false
        ) ranked
        WHERE place IS NOT NULL
        ORDER BY place, id
      ) sub
      WHERE cards.id = sub.id
    `);
    logger.info("Podium backfill applied from card-name heuristic");
  }

  // One-time production data seed — runs only when cards table is empty.
  // Idempotent: every statement uses ON CONFLICT DO UPDATE / DO NOTHING.
  const { rows: cardCheck } = await pool.query(`SELECT 1 FROM cards LIMIT 1`);
  if (cardCheck.length === 0) {
    logger.info("Cards table empty — running production data seed");
    for (const stmt of SEED_SQL) {
      await pool.query(stmt);
    }
    logger.info({ count: SEED_SQL.length }, "Production seed complete");
  }

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
  // Listen FIRST so the Autoscale startup probe (GET /api/healthz) can respond
  // immediately. Migrations and bot startup happen after the server is ready.
  // Autoscale creates the new instance while the old one is still running;
  // awaiting DDL migrations before listen caused ALTER TABLE to block on
  // the old instance's connections, making the probe time out.
  await new Promise<void>((resolve, reject) => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        reject(err);
        return;
      }
      logger.info({ port }, "Server listening");
      resolve();
    });
  });

  // Run idempotent boot migrations after the server is accepting traffic.
  // Failures are logged but non-fatal: every statement uses IF NOT EXISTS /
  // conditional guards, so a lock-timeout on a contested table just means the
  // column was already added by a prior deployment.
  runBootMigrations().catch((err) => {
    logger.error({ err }, "Boot migrations failed — server continues");
  });

  // Start Discord bot alongside the API server
  startBot().catch((err) => {
    logger.error({ err }, "Bot startup failed");
  });
}

main();
