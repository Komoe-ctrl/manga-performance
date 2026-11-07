#!/bin/sh
# Restores a backup made by backup.sh.
#
#   restore.sh <object-key | latest> [--into-production]
#
# By default the dump is restored into a SCRATCH database (RESTORE_DATABASE, default
# "manga_restore"), which is created fresh: use it to check a backup, or to extract data.
# `--into-production` restores over $PGDATABASE (drops and recreates its objects): stop the
# web, worker and scraper first, see docs/runbook.md.
#
# Required environment: PGHOST PGUSER PGPASSWORD PGDATABASE
#   S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY BACKUP_PASSPHRASE
set -eu
set -o pipefail 2>/dev/null || true

target="${1:?usage: restore.sh <object-key|latest> [--into-production]}"
mode="${2:-scratch}"
: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"
: "${S3_ENDPOINT:?}" "${S3_BUCKET:?}" "${S3_ACCESS_KEY:?}" "${S3_SECRET_KEY:?}" "${BACKUP_PASSPHRASE:?}"
PREFIX="${BACKUP_PREFIX:-backups/}"

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
export AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}"
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
s3() { aws --endpoint-url "$S3_ENDPOINT" "$@"; }

if [ "$target" = "latest" ]; then
  target="$(s3 s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "$PREFIX" --query 'Contents[].Key' --output text \
    | tr '\t' '\n' | grep -E "\.dump\.enc$" | sort | tail -n 1)"
  [ -n "$target" ] || { echo "restore: no backup found" >&2; exit 1; }
fi
echo "restore: using $target"

if [ "$mode" = "--into-production" ]; then
  db="$PGDATABASE"
  echo "restore: RESTORING OVER $db"
else
  db="${RESTORE_DATABASE:-manga_restore}"
  psql -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db\"" -c "CREATE DATABASE \"$db\""
fi

# A wrong passphrase makes openssl fail: the pipeline stops before touching anything else.
s3 s3 cp "s3://${S3_BUCKET}/${target}" - --only-show-errors \
  | openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE \
  | pg_restore --no-owner --no-privileges --clean --if-exists --exit-on-error -d "$db"

echo "restore: done into database $db"
echo "restore: tables with rows:"
psql -d "$db" -At -c "SELECT relname || ' ' || n_live_tup FROM pg_stat_user_tables WHERE n_live_tup > 0 ORDER BY relname"
