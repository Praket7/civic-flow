#!/usr/bin/env bash
# Synthetic recovery exercise only. Never use a hosted connection.
set -euo pipefail
umask 077
if [[ "${PGHOST:-}" != "127.0.0.1" || "${PGPORT:-}" != "5432" || "${PGUSER:-}" != "postgres" ]]; then
  echo "Recovery drill requires the local CI PostgreSQL service." >&2
  exit 2
fi
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGDATABASE PGOPTIONS
if [[ "$(psql -XAt -d postgres -c "select inet_server_addr() = '127.0.0.1'::inet")" != "t" ]]; then
  echo "Recovery drill did not establish a local connection." >&2
  exit 2
fi
source_db=civicflow_fixture_${BASHPID}
target_db=civicflow_restore_${BASHPID}
archive=$(mktemp)
trap 'rm -f "$archive"; dropdb --if-exists "$source_db"; dropdb --if-exists "$target_db"' EXIT
createdb "$source_db"
createdb "$target_db"
psql -X -v ON_ERROR_STOP=1 -d "$source_db" -f supabase/tests/prelude.sql
for migration in supabase/migrations/*.sql; do
  psql -X -v ON_ERROR_STOP=1 -d "$source_db" -f "$migration"
done
psql -X -v ON_ERROR_STOP=1 -d "$source_db" <<'SQL'
insert into public.organizations (id, name, initials, mission, city, state, timezone)
values ('11111111-1111-4111-8111-111111111111', 'Recovery fixture', 'RF', 'Synthetic test', 'Buffalo', 'NY', 'America/New_York');
SQL
pg_dump --format=custom --no-owner --file="$archive" "$source_db"
pg_restore --exit-on-error --single-transaction --no-owner --dbname="$target_db" "$archive"
for database in "$source_db" "$target_db"; do
  psql -X -v ON_ERROR_STOP=1 -d "$database" <<'SQL'
do $$
begin
  if (select count(*) from public.organizations where name = 'Recovery fixture') <> 1 then
    raise exception 'Recovery fixture is missing';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) then
    raise exception 'Restored public table is missing RLS';
  end if;
  if has_table_privilege('anon', 'public.organizations', 'SELECT') then
    raise exception 'Anonymous access unexpectedly granted';
  end if;
  if not has_table_privilege('authenticated', 'public.organizations', 'SELECT') then
    raise exception 'Authenticated read grant was lost';
  end if;
end $$;
SQL
done
echo "Synthetic database restored with fixture, RLS, and representative grants intact."
