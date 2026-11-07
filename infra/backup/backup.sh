#!/bin/sh
# Daily encrypted PostgreSQL backup to object storage, 30-day retention (spec, section 12).
#
# Required environment: PGHOST PGUSER PGPASSWORD PGDATABASE
#   S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY BACKUP_PASSPHRASE
# Optional: S3_REGION (us-east-1), BACKUP_PREFIX (backups/), BACKUP_RETENTION_DAYS (30)
#
# The dump is encrypted before it leaves the machine (AES-256-CBC, PBKDF2): the storage
# provider never sees clear data. Keep BACKUP_PASSPHRASE somewhere else than the server.
set -eu
set -o pipefail 2>/dev/null || true

: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"
: "${S3_ENDPOINT:?}" "${S3_BUCKET:?}" "${S3_ACCESS_KEY:?}" "${S3_SECRET_KEY:?}" "${BACKUP_PASSPHRASE:?}"
PREFIX="${BACKUP_PREFIX:-backups/}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
export AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}"
# Non-AWS S3 implementations reject the newer default checksum headers.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
s3() { aws --endpoint-url "$S3_ENDPOINT" "$@"; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
key="${PREFIX}manga-${stamp}.dump.enc"

echo "backup: dumping $PGDATABASE to $key"
pg_dump --format=custom --no-owner --no-privileges \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE \
  | s3 s3 cp - "s3://${S3_BUCKET}/${key}" --only-show-errors

size="$(s3 s3api head-object --bucket "$S3_BUCKET" --key "$key" --query ContentLength --output text)"
if [ "${size:-0}" -lt 100 ]; then
  echo "backup: FAILED, uploaded object is empty ($size bytes)" >&2
  exit 1
fi
echo "backup: uploaded $size bytes"

# Retention: names carry their UTC date, so they compare as plain strings.
cutoff="$(date -u -d "@$(( $(date +%s) - RETENTION_DAYS * 86400 ))" +%Y%m%dT%H%M%SZ)"
s3 s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "$PREFIX" --query 'Contents[].Key' --output text \
  | tr '\t' '\n' | grep -E "manga-[0-9]{8}T[0-9]{6}Z\.dump\.enc$" | while read -r old; do
    name="${old##*manga-}"; name="${name%.dump.enc}"
    if [ "$name" \< "$cutoff" ]; then
      echo "backup: deleting expired $old"
      s3 s3 rm "s3://${S3_BUCKET}/${old}" --only-show-errors
    fi
  done
echo "backup: done"
