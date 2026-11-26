#!/usr/bin/env bash
# Free operator-run backup: encrypt, upload, download, restore locally, record evidence.
set -euo pipefail
umask 077

if [[ "${1:-}" == "--help" ]]; then
  echo 'Usage: CIVICFLOW_DRIVE_FOLDER_ID=<private folder ID> bash scripts/backup-local.sh'
  echo 'Requires macOS FileVault, Docker, Supabase CLI, PostgreSQL 17 client, age, rclone and Python 3.'
  exit 0
fi
[[ "$(uname -s)" == Darwin ]] || { echo "Run this on the authorized Mac." >&2; exit 2; }
for tool in supabase psql age age-keygen rclone docker python3 shasum fdesetup; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 2; }
done
fdesetup status | grep -q 'FileVault is On' || {
  echo "Enable FileVault before handling production records." >&2
  exit 2
}
docker info >/dev/null
: "${CIVICFLOW_DRIVE_FOLDER_ID:?Set the authorized private Google Drive folder ID}"
[[ "$CIVICFLOW_DRIVE_FOLDER_ID" =~ ^[A-Za-z0-9_-]+$ ]] || exit 2
rclone lsf civicflow: --drive-root-folder-id "$CIVICFLOW_DRIVE_FOLDER_ID" >/dev/null
ROOT="$HOME/.civicflow-backups"
IDENTITY="$ROOT/keys/backup.agekey"
mkdir -p "$ROOT/keys"
chmod 700 "$ROOT" "$ROOT/keys"
if [[ ! -f "$IDENTITY" ]]; then
  age-keygen -o "$IDENTITY"
  echo "Save an offline copy of $IDENTITY separately from the backups."
fi
chmod 600 "$IDENTITY"
RECIPIENT="$(age-keygen -y "$IDENTITY")"
read -r -p 'Confirm private Drive folder, authorized data, offline key copy, and no application writes during export (type YES): ' consent
[[ "$consent" == YES ]] || { echo "Backup cancelled."; exit 2; }
read -r -s -p 'Paste the production Session pooler database URL: ' DB_URL
echo
# Reject alternate projects, transaction poolers, redirecting query parameters,
# fragments and ambiguous targets. The URL stays on the operator's Mac.
DB_URL="$(printf '%s' "$DB_URL" | python3 -c '
import sys
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
u = urlsplit(sys.stdin.read())
ref = "imzdblvljdcbnxtwbmbw"
try:
    valid = (u.scheme in ("postgres", "postgresql") and u.port == 5432 and u.path == "/postgres"
        and bool(u.password) and not u.fragment
        and ((u.username == "postgres." + ref and (u.hostname or "").endswith(".pooler.supabase.com"))
             or (u.username == "postgres" and u.hostname == "db." + ref + ".supabase.co")))
except ValueError:
    valid = False
params = parse_qsl(u.query, keep_blank_values=True)
if not valid or any(k != "sslmode" or v not in ("require", "verify-ca", "verify-full") for k,v in params) or len(params)>1:
    sys.exit("Refusing an unexpected database URL. Copy the project Session pooler on port 5432.")
print(urlunsplit((u.scheme,u.netloc,u.path,urlencode(params or [("sslmode","require")]),"")))
')"
unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGDATABASE PGOPTIONS PGPASSWORD PGPASSFILE
source_sql() { psql -X -qAt -v ON_ERROR_STOP=1 --dbname "$DB_URL" "$@"; }
[[ "$(source_sql -c "select current_database()='postgres' and current_setting('server_version_num')::int / 10000=17")" == t ]] || {
  echo "Unexpected production PostgreSQL version." >&2; exit 2;
}
[[ "$(source_sql -c 'select count(*) from storage.objects')" == 0 ]] || {
  echo "Storage objects exist: arrange separate object backups before marking recovery verified." >&2; exit 2;
}

stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
name="snapshot-$stamp"
work="$(mktemp -d "$ROOT/.work.XXXXXX")"
out="$ROOT/$name"
mkdir "$out" "$work/download" "$work/local"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
local_started=0
cleanup() {
  unset DB_URL
  if [[ "$local_started" == 1 ]]; then
    if ! supabase stop --workdir "$work/local" --no-backup; then
      rm -f "$work/roles.sql" "$work/schema.sql" "$work/data.sql" "$work/counts.tsv"
      echo "Local database cleanup failed. Run supabase stop --workdir $work/local --no-backup before removing the work directory." >&2
      return
    fi
  fi
  rm -rf "$work"
}
trap cleanup EXIT
counts="select 'organizations',count(*) from public.organizations union all
select 'memberships',count(*) from public.organization_memberships union all
select 'opportunities',count(*) from public.opportunities union all
select 'shifts',count(*) from public.shifts union all
select 'users',count(*) from auth.users order by 1"
source_sql -F $'\t' -c "$counts" > "$work/counts.tsv"

# Supabase's supported logical export excludes managed schema definitions.
# Exclude live scheduler queues and Vault records; they must be reprovisioned.
help="$(supabase db dump --help)"
if [[ "$help" == *--remote* ]]; then
  remote=(--remote "$DB_URL")
else
  remote=(--db-url "$DB_URL")
fi
supabase db dump "${remote[@]}" --role-only -f "$work/roles.sql"
supabase db dump "${remote[@]}" -f "$work/schema.sql"
supabase db dump "${remote[@]}" --data-only --use-copy \
  -x storage.buckets_vectors -x storage.vector_indexes \
  -x cron.job -x cron.job_run_details -x net.http_request_queue \
  -x net._http_response -x vault.secrets -x private.reminder_scheduler_nonces \
  -f "$work/data.sql"
source_sql -F $'\t' -c "$counts" | cmp - "$work/counts.tsv" || {
  echo "Production counts changed during the export; stop writes and retry." >&2; exit 1;
}
finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
for file in roles.sql schema.sql data.sql counts.tsv; do
  age -r "$RECIPIENT" -o "$out/$file.age" "$work/$file"
  rm -f "$work/$file"
done
(cd "$out"; shasum -a 256 *.age > SHA256SUMS.txt; shasum -a 256 -c SHA256SUMS.txt)
rclone copy "$out" "civicflow:$name" --drive-root-folder-id "$CIVICFLOW_DRIVE_FOLDER_ID" --immutable
rclone copy "civicflow:$name" "$work/download" --drive-root-folder-id "$CIVICFLOW_DRIVE_FOLDER_ID"
cmp "$out/SHA256SUMS.txt" "$work/download/SHA256SUMS.txt"
(cd "$work/download"; shasum -a 256 -c SHA256SUMS.txt)

# Use a new project identity and a fresh Supabase local database. Never
# connect a restore client to a user-supplied destination.
supabase init --workdir "$work/local"
project="civicflow_restore_$(date +%s)_$$"
python3 - "$work/local/supabase/config.toml" "$project" <<'PY'
import pathlib,re,sys
p = pathlib.Path(sys.argv[1])
s,n = re.subn(r'(?m)^project_id\s*=.*$', 'project_id = "' + sys.argv[2] + '"', p.read_text())
if n != 1: sys.exit("Cannot identify the local project")
s,n = re.subn(r'(?m)^major_version\s*=\s*\d+.*$', 'major_version = 17', s)
if n != 1: sys.exit("Cannot pin the local PostgreSQL major version")
p.write_text(s)
PY
container="supabase_db_$project"
if docker container inspect "$container" >/dev/null 2>&1; then
  echo "Restore container already exists." >&2; exit 1
fi
if lsof -nP -iTCP:54322 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 54322 is in use; stop the other local instance first." >&2; exit 1
fi
local_started=1
supabase db start --workdir "$work/local"
docker container inspect "$container" >/dev/null
local_sql() { docker exec -i --user postgres "$container" psql -X -qAt -v ON_ERROR_STOP=1 -d postgres "$@"; }
[[ "$(local_sql -c "select current_database()='postgres' and inet_server_addr() is null and current_setting('server_version_num')::int / 10000=17")" == t ]] || {
  echo "Local isolation or version check failed." >&2; exit 1;
}
for file in roles.sql schema.sql data.sql counts.tsv; do
  age -d -i "$IDENTITY" -o "$work/$file" "$work/download/$file.age"
done
# Each SQL file is consumed in the same transaction. Only the disposable
# container receives SQL; never the production connection.
{
  cat "$work/roles.sql" "$work/schema.sql"
  printf '\nSET session_replication_role = replica;\n'
  cat "$work/data.sql"
  printf '\nSET session_replication_role = origin;\n'
  # This application-owned trigger lives in a managed Supabase schema.
  printf '%s\n' 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;'
  printf '%s\n' 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();'
} | local_sql --single-transaction --file=-
local_sql -F $'\t' -c "$counts" | cmp - "$work/counts.tsv"
local_sql <<'SQL'
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','sync') and c.relkind='r' and not c.relrowsecurity) then
    raise exception 'Application table without RLS';
  end if;
  if has_table_privilege('anon','public.organizations','SELECT')
      or not has_table_privilege('authenticated','public.organizations','SELECT') then
    raise exception 'Organization grants failed';
  end if;
  if exists (select 1 from public.shifts where confirmed > capacity or confirmed < 0 or waitlisted < 0) then
    raise exception 'Shift invariant failed';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relname='users'
      and t.tgname='on_auth_user_created' and t.tgenabled <> 'D') then
    raise exception 'Application authentication trigger missing';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='cron' and c.relname='job') then
    if exists (select 1 from cron.job) then
      raise exception 'Unexpected scheduled job in restored database';
    end if;
  end if;
end $$;
SQL
rm -f "$work/roles.sql" "$work/schema.sql" "$work/data.sql" "$work/counts.tsv"
supabase stop --workdir "$work/local" --no-backup
local_started=0

# The existing application health RPC reads this table. Record a success only
# after the downloaded copy is restored, checked and the local database removed.
digest="$(shasum -a 256 "$out/SHA256SUMS.txt" | awk '{print $1}')"
bytes="$(wc -c "$out/"*.age | awk 'END {print $1}')"
source_sql -v started="$started" -v finished="$finished" -v bytes="$bytes" \
  -v digest="$digest" -v location="drive:$name" <<'SQL'
insert into public.backup_runs
  (started_at,finished_at,status,size_bytes,sha256,storage_path,verified_at,detail)
values (:'started'::timestamptz,:'finished'::timestamptz,'succeeded',:'bytes'::bigint,
  :'digest',:'location',now(),'Downloaded encrypted Drive copy; isolated PostgreSQL restore, selected record counts, RLS, grants, auth trigger and shift invariants passed.');
SQL
echo "Verified database backup recorded. Encrypted local copy: $out"
echo "Managed Auth settings, Vault credentials, Edge Function secrets and storage objects are separate recovery requirements."
