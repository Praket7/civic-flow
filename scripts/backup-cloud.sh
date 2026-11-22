#!/usr/bin/env bash
# CivicFlow logical backup. This does not replace a PITR-capable managed backup.
# No plaintext database dump is ever written to local disk or a CI artifact.
set -euo pipefail
umask 077

for executable in pg_dump age aws python3; do
  command -v "$executable" >/dev/null 2>&1 || {
    printf 'Backup unavailable: missing tool %s\n' "$executable" >&2
    exit 2
  }
done
: "${CIVICFLOW_DATABASE_URL:?Set a private, read-only-capable PostgreSQL connection string}"
: "${CIVICFLOW_BACKUP_AGE_RECIPIENT:?Set an age X25519 recipient public key}"
: "${CIVICFLOW_BACKUP_S3_URI:?Set a private s3://bucket/prefix destination}"

# Never connect to an unexpected destination or ship an unencrypted archive.
if [[ ! "$CIVICFLOW_BACKUP_AGE_RECIPIENT" =~ ^age1[a-z0-9]{58}$ ]]; then
  echo "Invalid age public recipient. Refusing to export sensitive data." >&2
  exit 2
fi
if [[ ! "$CIVICFLOW_BACKUP_S3_URI" =~ ^s3://[a-zA-Z0-9.-]+/[a-zA-Z0-9/_-]+/?$ ]]; then
  echo "Backup destination must be a scoped s3://bucket/prefix path." >&2
  exit 2
fi
bucket="${CIVICFLOW_BACKUP_S3_URI#s3://}"
bucket="${bucket%%/*}"
# Require bucket-level public-access block, not just a promise in docs.
config="$(aws s3api get-public-access-block --bucket "$bucket" --query PublicAccessBlockConfiguration --output json)"
BACKUP_PUBLIC_BLOCK="$config" python3 - <<'PY'
import json, os, sys
settings = json.loads(os.environ["BACKUP_PUBLIC_BLOCK"])
required = ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")
if not all(settings.get(key) is True for key in required):
    sys.exit("Offsite bucket is not configured to block all forms of public access.")
PY

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
key="${CIVICFLOW_BACKUP_S3_URI%/}/civicflow-${timestamp}.pgdump.age"
# pg_dump is a logical snapshot and remains consistent during normal writes.
# Store only authenticated data schemas; shared owner/admin schemas may exist
# outside public, which is why auth/storage/sync are included explicitly.
pg_dump --dbname "$CIVICFLOW_DATABASE_URL" \
  --format=custom --no-owner --no-acl \
  --schema=public --schema=auth --schema=storage --schema=sync \
  | age --recipient "$CIVICFLOW_BACKUP_AGE_RECIPIENT" \
  | aws s3 cp - "$key" --sse AES256 --no-progress --only-show-errors

# An uploaded object is NOT a verified restorable backup, but a missing or
# zero-byte object must fail the scheduled job rather than report success.
object="${key#s3://$bucket/}"
size="$(aws s3api head-object --bucket "$bucket" --key "$object" --query ContentLength --output text)"
if [[ ! "$size" =~ ^[0-9]+$ ]] || (( size < 1024 )); then
  echo "Encrypted backup upload could not be verified by storage HEAD." >&2
  exit 1
fi
echo "Encrypted database snapshot uploaded to private storage; restore verification remains required."
