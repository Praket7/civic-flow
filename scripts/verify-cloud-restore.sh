#!/usr/bin/env bash
# Restore verification is DESTRUCTIVE to its target. Require a disposable
# local database explicitly named civicflow_restore_*; never target production.
set -euo pipefail
umask 077

for executable in psql pg_restore age aws python3; do
  command -v "$executable" >/dev/null 2>&1 || { echo "Missing $executable" >&2; exit 2; }
done
: "${CIVICFLOW_RESTORE_DATABASE_URL:?Set URL of a disposable local Postgres database}"
: "${CIVICFLOW_BACKUP_OBJECT_URI:?Set the private s3://...pgdump.age object to verify}"
: "${CIVICFLOW_BACKUP_AGE_IDENTITY_FILE:?Set the path to a privately held age identity file}"

if [[ ! "$CIVICFLOW_BACKUP_OBJECT_URI" =~ ^s3://[a-zA-Z0-9.-]+/[a-zA-Z0-9/_-]+\.pgdump\.age$ ]]; then
  echo "Restore object must be an encrypted .pgdump.age file in S3." >&2
  exit 2
fi
if [[ ! -r "$CIVICFLOW_BACKUP_AGE_IDENTITY_FILE" ]]; then
  echo "Age private key file is unavailable or unreadable." >&2
  exit 2
fi

# The connection string is not printed; the hostname and database name are
# checked before pg_restore ever gets access to it.
CIVICFLOW_URL_CHECK="$CIVICFLOW_RESTORE_DATABASE_URL" python3 - <<'PY'
import os, sys
from urllib.parse import urlparse
parsed = urlparse(os.environ["CIVICFLOW_URL_CHECK"])
db = parsed.path.removeprefix("/")
if (
    parsed.scheme not in ("postgres", "postgresql")
    or parsed.hostname not in ("localhost", "127.0.0.1", "::1")
    or parsed.query
    or parsed.params
    or parsed.fragment
    or not db.startswith("civicflow_restore_")
    or len(db) < len("civicflow_restore_") + 1
):
    sys.exit("Refusing restore: use a disposable localhost civicflow_restore_* database only.")
PY

if [[ "${CIVICFLOW_ALLOW_DESTRUCTIVE_RESTORE_TEST:-}" != "isolated-only" ]]; then
  echo "Restore blocked: set CIVICFLOW_ALLOW_DESTRUCTIVE_RESTORE_TEST=isolated-only." >&2
  exit 2
fi

# The cleartext archive flows only through pipes; it is never copied to disk
# or to a CI artifact. Test of the restored *schema* is a separate gate from
# merely observing that an S3 object exists.
aws s3 cp "$CIVICFLOW_BACKUP_OBJECT_URI" - --only-show-errors --no-progress \
  | age --decrypt --identity "$CIVICFLOW_BACKUP_AGE_IDENTITY_FILE" \
  | PGDATABASE="$CIVICFLOW_RESTORE_DATABASE_URL" pg_restore \
      --clean --if-exists --no-owner --no-acl --exit-on-error

PGDATABASE="$CIVICFLOW_RESTORE_DATABASE_URL" psql --no-psqlrc \
  --set ON_ERROR_STOP=1 --tuples-only --no-align \
  --command="DO \$\$ BEGIN
    IF to_regclass('public.organization_memberships') IS NULL
       OR to_regclass('public.opportunities') IS NULL
       OR to_regclass('public.shifts') IS NULL
       OR to_regclass('auth.users') IS NULL THEN
      RAISE EXCEPTION 'Restored CivicFlow schema is incomplete';
    END IF;
  END \$\$;"

echo "Encrypted archive restored and critical application tables verified in an isolated database."
echo "Human migration, RLS, sign-in and data-integrity review is still required before release."
