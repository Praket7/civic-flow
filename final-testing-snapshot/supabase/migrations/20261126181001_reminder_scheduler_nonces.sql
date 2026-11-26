-- One-time, short-lived credentials for the database-owned reminder scheduler.
-- The operator provisions pg_cron separately; normal migrations remain portable.
create table private.reminder_scheduler_nonces (
  digest bytea primary key,
  expires_at timestamptz not null
);

alter table private.reminder_scheduler_nonces enable row level security;
revoke all on private.reminder_scheduler_nonces from public, anon, authenticated, service_role;

create or replace function private.issue_reminder_scheduler_nonce()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_nonce text := replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '');
begin
  delete from private.reminder_scheduler_nonces where expires_at <= clock_timestamp();
  insert into private.reminder_scheduler_nonces (digest, expires_at)
  values (sha256(convert_to(v_nonce, 'UTF8')), clock_timestamp() + interval '5 minutes');
  return v_nonce;
end;
$$;

revoke all on function private.issue_reminder_scheduler_nonce() from public, anon, authenticated, service_role;

create or replace function public.consume_reminder_scheduler_nonce(p_nonce text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_nonce is null or p_nonce !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  delete from private.reminder_scheduler_nonces
  where digest = sha256(convert_to(p_nonce, 'UTF8'))
    and expires_at > clock_timestamp();
  return found;
end;
$$;

revoke all on function public.consume_reminder_scheduler_nonce(text) from public, anon, authenticated;
grant execute on function public.consume_reminder_scheduler_nonce(text) to service_role;
