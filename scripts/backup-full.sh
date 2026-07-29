#!/usr/bin/env bash
#
# Full, restorable backup of the live DN-cards deployment.
#
# Captures the three things that are actually needed to stand this bot up
# somewhere else:
#   1. the complete Postgres database (schema + data, every table)
#   2. every object in Replit Object Storage (the card art)
#   3. a read-only inventory taken at the same moment, to verify the restore
#
# Run this from the repo root INSIDE the Replit shell, where DATABASE_URL and
# the Object Storage env vars exist:
#
#   bash scripts/backup-full.sh
#   bash scripts/backup-full.sh --out backups --skip-storage
#
# The output directory is gitignored on purpose: the dump contains password
# hashes and setup tokens and must not be committed.

set -euo pipefail

OUT_ROOT="backups"
SKIP_STORAGE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT_ROOT="${2:?--out needs a value}"; shift 2 ;;
    --skip-storage) SKIP_STORAGE=1; shift ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Run this in the Replit shell." >&2
  exit 1
fi

command -v pg_dump >/dev/null 2>&1 || { echo "ERROR: pg_dump not found on PATH." >&2; exit 1; }

STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
DEST="${OUT_ROOT}/${STAMP}"
mkdir -p "${DEST}"

echo "==> Backup ${STAMP}"
echo "    Destination: ${DEST}"

# Refuse to run a pg_dump older than the server. A newer server with an older
# client produces an error, but the reverse can silently omit newer constructs.
SERVER_VERSION="$(psql "${DATABASE_URL}" -tAc 'SHOW server_version;' 2>/dev/null | cut -d. -f1 || echo "?")"
CLIENT_VERSION="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
echo "    Postgres server ${SERVER_VERSION}, pg_dump client ${CLIENT_VERSION}"
if [ "${SERVER_VERSION}" != "?" ] && [ "${CLIENT_VERSION}" -lt "${SERVER_VERSION}" ]; then
  echo "ERROR: pg_dump ${CLIENT_VERSION} is older than server ${SERVER_VERSION}. Upgrade the client." >&2
  exit 1
fi

# 1. Inventory first, so the manifest describes the database as it was at the
#    moment of the dump rather than whatever it looks like later.
echo "==> Inventory"
if ! pnpm --filter @workspace/scripts run --silent db:inventory -- --json > "${DEST}/inventory.json" 2>"${DEST}/inventory.err"; then
  echo "    WARNING: inventory failed; see ${DEST}/inventory.err" >&2
else
  rm -f "${DEST}/inventory.err"
  echo "    Wrote inventory.json"
fi

# 2. Two dump formats on purpose.
#    - custom (.dump)  : what you restore from; supports parallel + selective restore
#    - plain  (.sql)   : greppable, diffable, readable without pg_restore
echo "==> pg_dump (custom format)"
pg_dump "${DATABASE_URL}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="${DEST}/database.dump"

echo "==> pg_dump (plain SQL)"
pg_dump "${DATABASE_URL}" \
  --format=plain \
  --no-owner \
  --no-privileges \
  --file="${DEST}/database.sql"
gzip -9 -f "${DEST}/database.sql"

# Schema alone, so schema drift between environments is easy to diff.
pg_dump "${DATABASE_URL}" --schema-only --no-owner --no-privileges --file="${DEST}/schema.sql"

TABLE_COUNT="$(psql "${DATABASE_URL}" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")"
echo "    Dumped ${TABLE_COUNT} table(s)"

# 3. Object storage — the part a database backup always misses.
if [ "${SKIP_STORAGE}" -eq 1 ]; then
  echo "==> Object storage: skipped (--skip-storage)"
else
  echo "==> Object storage export"
  if ! pnpm --filter @workspace/scripts run --silent storage:export -- --out "${DEST}/objects"; then
    echo "    WARNING: object storage export failed or was incomplete." >&2
    echo "    The database dump is still valid, but card art is NOT fully backed up." >&2
  fi
fi

# 4. README before checksums, so the checksum file covers every other file in
#    the directory including this one.
cat > "${DEST}/README.txt" <<EOF
DN-cards backup ${STAMP}

Contents
  database.dump    pg_dump custom format  <- restore from this
  database.sql.gz  plain SQL dump (same data, human readable)
  schema.sql       schema only, for diffing
  inventory.json   read-only census taken at dump time
  objects/         Replit Object Storage contents + manifest.json
  SHA256SUMS       checksums for every file above

Restore into a new Postgres (Railway, Oracle, local):
  bash scripts/restore-full.sh --from ${DEST} --to "\$TARGET_DATABASE_URL"

Verify before trusting it:
  sha256sum -c SHA256SUMS

SENSITIVE: contains dashboard_users.password_hash and setup_tokens.token.
Do not commit this directory or paste it anywhere public.
EOF

# 5. Checksums, so a corrupted transfer is detectable rather than discovered
#    during a restore you are relying on.
echo "==> Checksums"
( cd "${DEST}" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS )

SIZE="$(du -sh "${DEST}" | cut -f1)"

echo ""
echo "==> Done. ${DEST} (${SIZE})"
echo "    Verify:  ( cd ${DEST} && sha256sum -c SHA256SUMS )"
echo "    Restore: bash scripts/restore-full.sh --from ${DEST} --to \"\$TARGET_DATABASE_URL\""
echo ""
echo "    Download it off Replit now — this container is not a backup location."
