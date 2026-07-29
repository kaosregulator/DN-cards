# Backup and migration runbook

How to take a complete, verified backup of the live deployment, and how to
restore it onto Railway, Oracle, or anywhere else that speaks Postgres.

## What actually needs backing up

Three separate stores, and a database dump only covers the first:

| Store | Contains | Captured by |
| --- | --- | --- |
| Postgres | cards, collections, currency, progression, battles, raids, quests, squads, market — all gameplay state | `pg_dump` |
| Replit Object Storage | card art uploaded through the dashboard (`/objects/...` paths) | `storage:export` |
| External image hosts | any card whose `image_url` is an absolute URL on someone else's server | **nothing — see below** |

The third row is the dangerous one. `cards.image_url` is a plain text column,
so art hosted elsewhere is referenced, never stored. If that host disappears,
the cards render broken and no database backup will bring them back. Run the
inventory to see how many cards are in that state.

## Step 1 — verify what is there (read-only)

Run this first. It only issues SELECTs.

```bash
pnpm --filter @workspace/scripts run db:inventory
```

It reports every table with an exact row count, a per-guild breakdown, how many
distinct users have collections, cards by rarity, and where card images live.
Check specifically that:

- the guild IDs listed match the servers you expect
- the card count matches what you believe you have
- the "Card image sources" section is mostly object storage, not external URLs

Machine-readable form, for diffing before and after a migration:

```bash
pnpm --filter @workspace/scripts run db:inventory -- --json > exports/inventory.json
```

## Step 2 — take the backup

From the repo root, in the Replit shell (needs `DATABASE_URL` and the Object
Storage env vars):

```bash
bash scripts/backup-full.sh
```

This writes `backups/<UTC timestamp>/` containing:

| File | Purpose |
| --- | --- |
| `database.dump` | pg_dump custom format — restore from this |
| `database.sql.gz` | same data as plain SQL, greppable |
| `schema.sql` | schema only, for diffing environments |
| `inventory.json` | census taken at dump time, used to verify the restore |
| `objects/` | every object storage file, plus `manifest.json` |
| `SHA256SUMS` | checksums for everything above |
| `README.txt` | restore instructions |

Then verify and get it off Replit — the container is not a backup location:

```bash
cd backups/<timestamp> && sha256sum -c SHA256SUMS
```

`backups/` is gitignored. Keep it that way: the dump contains
`dashboard_users.password_hash` and `setup_tokens.token`.

## Step 3 — restore onto the new host

Point `--to` at an empty database on the target:

```bash
bash scripts/restore-full.sh \
  --from backups/<timestamp> \
  --to "$TARGET_DATABASE_URL"
```

The script verifies checksums before touching anything, refuses to run against
a database that already has tables unless `--force` is passed, then compares
the resulting table count against `inventory.json` and fails loudly on a
mismatch. Re-run the inventory against the new database and diff the row counts
against the ones captured at dump time:

```bash
DATABASE_URL="$TARGET_DATABASE_URL" pnpm --filter @workspace/scripts run db:inventory
```

## Step 4 — the part that is not automated

Restoring the database does not finish a migration off Replit. Two things are
still wired to Replit specifically:

- **Object storage.** `artifacts/api-server/src/lib/objectStorage.ts` authenticates
  through the Replit sidecar at `127.0.0.1:1106`, which does not exist anywhere
  else. Moving hosts means swapping that client for an S3-compatible one
  (Cloudflare R2, Oracle Object Storage, plain S3) and re-uploading the contents
  of `objects/`.
- **Image URL resolution.** `artifacts/api-server/src/bot/image-url.ts` builds
  absolute URLs from `REPLIT_DOMAINS`. That needs to become the new public
  hostname, and stored `/objects/...` paths need to keep resolving.

Environment variables the app requires on any host: `DATABASE_URL`,
`DISCORD_BOT_TOKEN`, `ENCRYPTION_KEY`, `HOME_GUILD_ID`, `PORT`, plus whatever
replaces `PRIVATE_OBJECT_DIR` / `PUBLIC_OBJECT_SEARCH_PATHS`.

## Choosing a host

Both work; they trade money against time.

**Railway** — managed Postgres, `restore-full.sh` points straight at the
provided `DATABASE_URL`, backups and TLS are handled. No meaningful free tier;
budget a few dollars a month. Fastest path.

**Oracle Cloud Always Free** — genuinely free ARM instances and 20 GB of
S3-compatible object storage, but you install and patch Postgres, terminate TLS,
and own your own backups. Free-tier ARM capacity is frequently unavailable in
popular regions.

Either way the object storage rewrite in step 4 is the real work; the database
move itself is small.

## Scheduling

Backups only help if they are recent. Once the app is off Replit, run
`backup-full.sh` on a cron and copy the output somewhere durable. Verifying a
restore into a scratch database occasionally is the only way to know the
backups are good.
