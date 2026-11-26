-- The public VAPID key does not need an elevated function.
-- Grant only the public column, never the private signing material.
alter table private.push_keys enable row level security;
create policy push_public_key_read on private.push_keys
    for select to anon, authenticated, service_role using (true);
grant select (public_key) on private.push_keys to anon, authenticated, service_role;

create view public.vapid_public_config
with (security_invoker = true)
as select public_key from private.push_keys;

revoke all on public.vapid_public_config from public, anon, authenticated;
grant select on public.vapid_public_config to anon, authenticated, service_role;

create or replace function public.vapid_public_key()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
    select public_key from public.vapid_public_config
$$;
