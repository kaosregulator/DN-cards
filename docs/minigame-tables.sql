-- ─────────────────────────────────────────────────────────────────────────────
-- Wild Mini-Games schema — apply this to any database that is missing the
-- mini-game columns/table (dev AND prod). It is IDEMPOTENT (IF NOT EXISTS
-- everywhere), so it is safe to run more than once.
--
-- Preferred method (matches the repo's normal flow):
--     pnpm --filter db push          # (aka: pnpm --filter @workspace/db push)
--   This diffs lib/db/src/schema against the DB and adds exactly these objects.
--   The Replit postMerge hook (scripts/post-merge.sh) already runs it on merge;
--   run it manually if that hook did not fire.
--
-- Direct method (fallback if you can't run drizzle-kit): run this SQL against
-- each database, e.g.  psql "$DATABASE_URL" -f docs/minigame-tables.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- guild_settings: seven mini-game columns.
ALTER TABLE guild_settings
  ADD COLUMN IF NOT EXISTS mini_game_enabled            boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mini_game_cadence            text      NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS mini_game_interval_minutes   integer   NOT NULL DEFAULT 1440,
  ADD COLUMN IF NOT EXISTS mini_game_selection          text      NOT NULL DEFAULT 'shuffle',
  ADD COLUMN IF NOT EXISTS mini_game_next_arm_at        timestamp,
  ADD COLUMN IF NOT EXISTS mini_game_armed              boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mini_game_animation_enabled  boolean   NOT NULL DEFAULT true;

-- mini_game_log: one row per wild mini-game encounter.
CREATE TABLE IF NOT EXISTS mini_game_log (
  id          serial PRIMARY KEY,
  guild_id    text      NOT NULL,
  channel_id  text      NOT NULL,
  user_id     text      NOT NULL,
  card_id     integer   NOT NULL REFERENCES cards(id),
  game_key    text      NOT NULL,
  result      text      NOT NULL,
  started_at  timestamp NOT NULL DEFAULT now(),
  resolved_at timestamp
);
