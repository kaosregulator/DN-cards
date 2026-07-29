#!/usr/bin/env bash
#
# Restore a backup produced by scripts/backup-full.sh into a fresh Postgres —
# Railway, Oracle, or a local instance — and verify the result matches the
# inventory that was captured at dump time.
#
#   bash scripts/restore-full.sh --from backups/20260729-120000Z --to "$TARGET_DATABASE_URL"
#   bash scripts/restore-full.sh --from backups/20260729-120000Z --to "$TARGET_DATABASE_URL" --force
#
# Refuses to touch a target that already has tables unless --force is passed.

set -euo pipefail

FROM=""
TO=""
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="${2:?--from needs a value}"; shift 2 ;;
    --to) TO="${2:?--to needs a value}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

[ -n "${FROM}" ] || { echo "ERROR: --from is required." >&2; exit 1; }
[ -n "${TO}" ] || { echo "ERROR: --to is required (target DATABASE_URL)." >&2; exit 1; }
[ -f "${FROM}/database.dump" ] || { echo "ERROR: ${FROM}/database.dump not found." >&2; exit 1; }

command -v pg_restore >/dev/null 2>&1 || { echo "ERROR: pg_restore not found on PATH." >&2; exit 1; }

# Never restore from a backup that failed in transit.
if [ -f "${FROM}/SHA256SUMS" ]; then
  echo "==> Verifying checksums"
  ( cd "${FROM}" && sha256sum -c SHA256SUMS --quiet ) || {
    echo "ERROR: checksum mismatch — this backup is corrupt. Aborting." >&2
    exit 1
  }
  echo "    OK"
else
  echo "    WARNING: no SHA256SUMS in ${FROM}; cannot verify integrity." >&2
fi

TARGET_LABEL="$(printf '%s' "${TO}" | sed -E 's#^(postgres(ql)?://)[^@]*@#\1***@#')"
echo "==> Target: ${TARGET_LABEL}"

EXISTING="$(psql "${TO}" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")"
echo "    Target currently has ${EXISTING} table(s) in public schema"

if [ "${EXISTING}" -gt 0 ] && [ "${FORCE}" -ne 1 ]; then
  cat >&2 <<EOF
ERROR: target database is not empty (${EXISTING} tables).

Restoring would overwrite live data. If that is genuinely what you want,
re-run with --force. Otherwise point --to at an empty database.
EOF
  exit 1
fi

if [ "${EXISTING}" -gt 0 ]; then
  echo "==> --force: dropping and recreating public schema"
  psql "${TO}" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
fi

echo "==> Restoring"
# --no-owner/--no-privileges: managed providers hand out a role that does not
# match the Replit dump's owner, and role grants would otherwise fail.
# pg_restore continues past individual statement errors by default (there is no
# --exit-on-error=false form — the flag takes no argument), so one benign
# extension warning does not abort a multi-table restore. The table-count check
# below is what actually decides whether the restore succeeded.
set +e
pg_restore \
  --dbname="${TO}" \
  --no-owner \
  --no-privileges \
  --verbose \
  "${FROM}/database.dump" > "${FROM}/restore.log" 2>&1
RESTORE_RC=$?
set -e

# Match any pg_restore diagnostic, not just lines starting with "error" — a
# bad invocation reports "pg_restore: option ..." and would otherwise look clean.
RESTORE_ERRORS="$(grep -cE '^pg_restore: (error|option|hint)' "${FROM}/restore.log" || true)"
echo "    Restore log: ${FROM}/restore.log (exit ${RESTORE_RC}, ${RESTORE_ERRORS} diagnostic line(s))"
if [ "${RESTORE_RC}" -ne 0 ] && [ "${RESTORE_ERRORS}" -gt 0 ]; then
  echo "    pg_restore reported problems:" >&2
  grep -E '^pg_restore: (error|option|hint)' "${FROM}/restore.log" | head -5 >&2
fi

echo "==> Verifying against inventory taken at dump time"
NEW_TABLES="$(psql "${TO}" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")"
echo "    Tables now present: ${NEW_TABLES}"

if [ -f "${FROM}/inventory.json" ] && command -v node >/dev/null 2>&1; then
  EXPECTED_TABLES="$(node -pe "JSON.parse(require('fs').readFileSync('${FROM}/inventory.json','utf8')).totals.tables" 2>/dev/null || echo "")"
  EXPECTED_ROWS="$(node -pe "JSON.parse(require('fs').readFileSync('${FROM}/inventory.json','utf8')).totals.rows" 2>/dev/null || echo "")"
  if [ -n "${EXPECTED_TABLES}" ]; then
    echo "    Expected tables: ${EXPECTED_TABLES}"
    if [ "${NEW_TABLES}" != "${EXPECTED_TABLES}" ]; then
      echo "    MISMATCH: expected ${EXPECTED_TABLES} tables, got ${NEW_TABLES}." >&2
      echo "    Inspect ${FROM}/restore.log before pointing the bot at this database." >&2
      exit 1
    fi
  fi
  [ -n "${EXPECTED_ROWS}" ] && echo "    Expected total rows at dump time: ${EXPECTED_ROWS}"
fi

echo ""
echo "==> Restore complete."
echo "    Re-run the inventory against the new database to compare row counts:"
echo "      DATABASE_URL=\"\$TARGET_DATABASE_URL\" pnpm --filter @workspace/scripts run db:inventory"
echo ""
echo "    Card art in ${FROM}/objects/ still needs uploading to the new host's"
echo "    object storage, and image_url values rewritten to match."
