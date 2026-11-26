-- Run only on the intended hosted project as its database administrator.
-- Before running, store the public legacy anon JWT and project HTTPS URL in
-- Vault under the two names below. Never store a service-role key here.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function private.enqueue_reminder_dispatch()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_nonce text;
begin
  select decrypted_secret into strict v_url from vault.decrypted_secrets
    where name = 'civicflow_reminder_project_url';
  select decrypted_secret into strict v_key from vault.decrypted_secrets
    where name = 'civicflow_reminder_gateway_anon_jwt';
  if v_url !~ '^https://[a-z0-9]+\.supabase\.co$'
    or v_key !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
    raise exception 'Invalid reminder gateway configuration';
  end if;
  v_nonce := private.issue_reminder_scheduler_nonce();
  perform net.http_post(
    url := v_url || '/functions/v1/dispatch-reminders?limit=25',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key,
      'Content-Type', 'application/json',
      'x-civicflow-cron', v_nonce
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function private.enqueue_reminder_dispatch() from public, anon, authenticated, service_role;

-- cron.schedule with the same name updates the existing job.
select cron.schedule(
  'civicflow-reminders',
  '7,22,37,52 * * * *',
  'select private.enqueue_reminder_dispatch()'
);
