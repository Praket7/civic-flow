-- Evaluate request-constant identity once per statement; tenant-dependent
-- membership predicates must remain correlated to the row.
alter policy profiles_own on public.profiles
    using (id = (select auth.uid()));
alter policy memberships_self_or_staff on public.organization_memberships
    using (user_id = (select auth.uid()) or private.is_staff(organization_id));
alter policy notification_preferences_own on public.notification_preferences
    using (private.is_member(organization_id) and user_id = (select auth.uid()));
alter policy push_subscriptions_own on public.push_subscriptions
    using (private.is_member(organization_id) and user_id = (select auth.uid()));
alter policy notification_deliveries_own_or_staff on public.notification_deliveries
    using (private.is_member(organization_id)
           and (user_id = (select auth.uid()) or private.is_staff(organization_id)));
alter policy organization_update_reads_own on public.organization_update_reads
    using (private.is_member(organization_id) and user_id = (select auth.uid()));

-- Global operator diagnostics are not tenant data. Stage 7 revoked SELECT;
-- also deny at the policy layer if an accidental grant is added in the future.
alter policy backup_runs_staff on public.backup_runs using (false);
alter policy server_job_runs_staff on public.server_job_runs using (false);

-- Support user-scoped RLS reads and auth-user FK cleanup. Existing composite
-- indexes lead with organization_id, update_id, or device id instead.
create index if not exists notification_preferences_user_id_idx
    on public.notification_preferences (user_id);
create index if not exists organization_update_reads_user_id_idx
    on public.organization_update_reads (user_id);
create index if not exists devices_user_id_idx
    on sync.devices (user_id);
