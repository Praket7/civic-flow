-- Preserve policy roles and predicates while evaluating the request identity once.
set lock_timeout = '5s';

create index if not exists cf_fk_devices_user_id on sync.devices (user_id);

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
alter policy backup_runs_staff on public.backup_runs
  using (exists (
    select 1 from public.organization_memberships m
    where m.user_id = (select auth.uid())
      and m.status = 'active' and m.role in ('owner', 'coordinator')
  ));
alter policy server_job_runs_staff on public.server_job_runs
  using (exists (
    select 1 from public.organization_memberships m
    where m.user_id = (select auth.uid())
      and m.status = 'active' and m.role in ('owner', 'coordinator')
  ));

reset lock_timeout;
