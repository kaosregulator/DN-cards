# Oracle Migration Safety Tooling

This project preserves gameplay by keeping Discord/card ownership data stable and validating it before and after database migration.

## What must not change

The migration must preserve:

- card IDs and card identity (`cards.id`, name, rarity, type)
- guild IDs and user IDs (Discord snowflakes)
- collection ownership rows (`guildId:userId:cardId`)
- normal and shiny card counts
- currency/stat rows (`shards`, `totalEarned`, `packsOpened`, `cardsBurned`)
- achievements unlocked
- set IDs and card memberships
- active set references in guild settings

Website-only presentation data can be migrated separately, but it must not drive gameplay behavior.

## Export a gameplay snapshot

Run this against the source database before migration:

```bash
DATABASE_URL=postgres://... pnpm --filter @workspace/scripts run migration:snapshot --   --out exports/pre-oracle-gameplay.json   --label pre-oracle   --pretty   --fail-on-integrity
```

The snapshot includes gameplay-critical tables plus summaries and integrity checks. It is read-only.

## Export a post-migration snapshot

After migrating to the target database, run the same command against the migrated database:

```bash
DATABASE_URL=<target-db-url> pnpm --filter @workspace/scripts run migration:snapshot --   --out exports/post-oracle-gameplay.json   --label post-oracle   --pretty   --fail-on-integrity
```

## Compare snapshots

```bash
pnpm --filter @workspace/scripts run migration:compare --   --before exports/pre-oracle-gameplay.json   --after exports/post-oracle-gameplay.json   --out exports/oracle-compare-report.json
```

The compare step fails if it detects:

- missing cards
- changed card identity fields
- missing collection rows
- changed normal/shiny ownership counts
- missing currency rows
- changed shard/stat counters
- missing achievements
- missing set memberships
- missing guild settings or active set references
- mismatched aggregate ownership/currency totals

Use `--allow-extra` only when the target database is expected to contain new rows created after the source snapshot.

## Current scope

The tools intentionally focus on gameplay preservation first. They do not yet validate every website-only table in detail.

Covered as gameplay-critical:

- `cards`
- `collections`
- `user_currency`
- `achievements_unlocked`
- `daily_claims`
- `guild_settings`
- `sets`
- `card_set_memberships`
- `wishlists`
- `trades`
- rarity/runtime compatibility tables

Included but treated as lower-risk/reference data:

- admin users
- embed overrides
- card display overrides
- card events

## Migration rule

Do not proceed with cutover if snapshot comparison reports errors. Fix the data mapping first.
