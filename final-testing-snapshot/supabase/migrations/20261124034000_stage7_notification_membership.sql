-- All notification reads require an active membership, even broadcasts.
alter policy notifications_own_or_coordinator on public.notifications
using (
    private.is_member(organization_id)
    and (
        private.is_staff(organization_id)
        or (audience in ('volunteer', 'all')
            and (volunteer_id is null
                 or volunteer_id = private.own_volunteer_id(organization_id)))
    )
);

alter policy notification_preferences_own on public.notification_preferences
using (private.is_member(organization_id) and user_id = auth.uid());

alter policy push_subscriptions_own on public.push_subscriptions
using (private.is_member(organization_id) and user_id = auth.uid());

alter policy notification_deliveries_own_or_staff on public.notification_deliveries
using (
    private.is_member(organization_id)
    and (user_id = auth.uid() or private.is_staff(organization_id))
);

alter policy organization_update_reads_own on public.organization_update_reads
using (private.is_member(organization_id) and user_id = auth.uid());
