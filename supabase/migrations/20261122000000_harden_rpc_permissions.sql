-- Restrict direct RPC access to application entry points.
-- Prior migrations grant authenticated users blanket EXECUTE privileges in
-- private and leave internal sync functions callable through PUBLIC.
-- In particular, sync.cmd_* accepts a claimed role and must never be a client RPC.
begin;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC unless default
-- privileges have been changed for the creating role.
alter default privileges revoke execute on functions from public;
-- Supabase may also configure schema-specific grants to its API roles.
-- Remove those for functions created by the migration role as well.
alter default privileges in schema public, private, sync
    revoke execute on functions from anon, authenticated;

-- Lock down internal helpers and all application RPCs, then allowlist the
-- small client-facing surface below. Function owners retain their rights.
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all functions in schema sync from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- RLS policies execute these helpers as the requesting account.
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.is_staff(uuid) to authenticated;
grant execute on function private.is_own_volunteer(uuid, uuid) to authenticated;
grant execute on function private.own_volunteer_id(uuid) to authenticated;

-- pull_changes is SECURITY INVOKER. Its row resolver also runs under the
-- caller's RLS policies and therefore needs explicit EXECUTE.
grant execute on function sync.change_row(text, uuid, text, integer, bigint)
    to authenticated;

-- Clients can SELECT the change log for replication; restrict that SELECT
-- to organizations in which the current user is an active member.
alter table sync.sync_changes enable row level security;
create policy sync_changes_active_members
    on sync.sync_changes for select to authenticated
    using (private.is_member(organization_id));

-- Client RPCs: membership/role checks remain inside each implementation.
grant execute on function public.apply_command(uuid, uuid, uuid, text, bigint, jsonb, jsonb, timestamptz) to authenticated;
grant execute on function public.pull_changes(uuid, bigint, integer) to authenticated;
grant execute on function public.my_workspaces() to authenticated;
grant execute on function public.bootstrap_workspace(uuid) to authenticated;
grant execute on function public.register_device(uuid, uuid, text, text) to authenticated;
grant execute on function public.report_device_state(uuid, uuid, bigint, integer, timestamptz, text) to authenticated;
grant execute on function public.save_notification_preferences(uuid, boolean, boolean, boolean, boolean, time, time, integer) to authenticated;
grant execute on function public.register_push_subscription(uuid, text, text, text, text) to authenticated;
grant execute on function public.revoke_push_subscription(text) to authenticated;
grant execute on function public.ensure_profile(text) to authenticated;
grant execute on function public.health_snapshot(uuid) to authenticated;
grant execute on function public.my_notification_preferences(uuid) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;
grant execute on function public.delivery_health(uuid) to authenticated;

-- The public VAPID key is intentionally available before sign-in.
grant execute on function public.vapid_public_key() to anon, authenticated;

-- Trusted server-side dispatch and VAPID key management use the service key,
-- not an ordinary signed-in or anonymous client's token. A service role is
-- allowed to call other public RPCs for administrative jobs as well.
grant execute on all functions in schema public to service_role;

commit;
