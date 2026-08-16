# Card Image Mirror (off-site R2 backup)

A durable, off-site backup of every card's art. The primary card image lives in
one Replit Object Storage bucket — a single copy. This mirror copies each card's
image **plus a lower-res WebP thumbnail** into a second store you own
(Cloudflare R2), so the art survives anything happening to the primary bucket,
is browsable in a dashboard you control, and can be served at low res.

## Safety

- **Read-only on the source.** It downloads originals; it never writes, moves, or
  deletes them. The primary bucket and the home guild's images are untouched.
- **Additive.** It only writes new objects into R2 and new rows into the
  `card_image_backups` catalogue table. No existing table or object changes.
- **Inert until configured.** With no `R2_*` secrets set, the mirror does nothing
  and imports nothing — deploying this changes behaviour only once you opt in.
- **Idempotent + resumable.** It runs on boot and re-scans every 30 min. It only
  mirrors cards that are new or whose art changed; a crash mid-pass resumes next
  time. Only one instance mirrors at a time (Postgres advisory lock).

## Turn it on (Replit → Tools → Secrets)

Create an R2 bucket in the Cloudflare dashboard, then add these secrets:

| Secret | Required | Notes |
| --- | --- | --- |
| `R2_ACCESS_KEY_ID` | yes | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | yes | R2 API token secret |
| `R2_BUCKET` | yes | the bucket name |
| `R2_ACCOUNT_ID` | yes* | your Cloudflare account id (*or set `R2_ENDPOINT`) |
| `R2_ENDPOINT` | no | overrides the endpoint (default `https://<account>.r2.cloudflarestorage.com`) |
| `R2_PUBLIC_BASE_URL` | no | public base URL for a mirrored object (if the bucket has a public domain) |
| `CARD_MIRROR_THUMB_WIDTH` | no | thumbnail width in px (default `512`) |
| `CARD_MIRROR_PREFIX` | no | key prefix (default `card-archive`) |
| `CARD_MIRROR_ENABLED` | no | set to `false` to hard-disable even with keys present |

On the next boot the mirror backs up every card (home guild included), a few
hundred cards at a gentle pace. Nothing else changes.

## Where things land in R2

```
card-archive/<guildId>/<cardId>.<ext>        # full-res durable copy
card-archive/<guildId>/thumb/<cardId>.webp   # lower-res thumbnail
```

## What's stored in the DB

The `card_image_backups` table is a catalogue only (the game does not read it
yet): one row per mirrored card with its R2 keys, source URL, checksum, byte
sizes, and status (`ok` / `source_missing` / `error`). `error` rows are retried
on the next pass; `ok` rows are skipped until the card's art changes.
