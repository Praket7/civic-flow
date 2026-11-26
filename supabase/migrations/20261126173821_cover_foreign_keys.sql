-- Cover foreign keys identified in the hosted catalog.
-- No changes to table contents, grants, or scheduling policy.
set lock_timeout = '5s';
create index if not exists cf_fk_activity_events_volunteer_id
  on public.activity_events (volunteer_id);
create index if not exists cf_fk_applications_organization_id
  on public.applications (organization_id);
create index if not exists cf_fk_attendance_events_organization_id
  on public.attendance_events (organization_id);
create index if not exists cf_fk_attendance_ledger_organization_id
  on public.attendance_ledger (organization_id);
create index if not exists cf_fk_attendance_ledger_volunteer_id
  on public.attendance_ledger (volunteer_id);
create index if not exists cf_fk_availability_rules_organization_id
  on public.availability_rules (organization_id);
create index if not exists cf_fk_checkin_codes_created_by
  on public.checkin_codes (created_by);
create index if not exists cf_fk_checkin_codes_organization_id
  on public.checkin_codes (organization_id);
create index if not exists cf_fk_checkin_codes_shift_id
  on public.checkin_codes (shift_id);
create index if not exists cf_fk_hour_entries_opportunity_id
  on public.hour_entries (opportunity_id);
create index if not exists cf_fk_hour_entries_source_shift_id
  on public.hour_entries (source_shift_id);
create index if not exists cf_fk_hour_entries_verification_id
  on public.hour_entries (verification_id);
create index if not exists cf_fk_impact_metric_definitions_organization_id
  on public.impact_metric_definitions (organization_id);
create index if not exists cf_fk_impact_results_definition_id
  on public.impact_results (definition_id);
create index if not exists cf_fk_impact_results_organization_id
  on public.impact_results (organization_id);
create index if not exists cf_fk_impact_results_shift_id
  on public.impact_results (shift_id);
create index if not exists cf_fk_notification_deliveries_notification_id
  on public.notification_deliveries (notification_id);
create index if not exists cf_fk_notification_deliveries_organization_id
  on public.notification_deliveries (organization_id);
create index if not exists cf_fk_notification_preferences_user_id
  on public.notification_preferences (user_id);
create index if not exists cf_fk_notifications_rule_id
  on public.notifications (rule_id);
create index if not exists cf_fk_organization_invites_created_by
  on public.organization_invites (created_by);
create index if not exists cf_fk_organization_invites_organization_id
  on public.organization_invites (organization_id);
create index if not exists cf_fk_organization_invites_redeemed_by
  on public.organization_invites (redeemed_by);
create index if not exists cf_fk_organization_memberships_volunteer_id
  on public.organization_memberships (volunteer_id);
create index if not exists cf_fk_organization_roster_policies_updated_by
  on public.organization_roster_policies (updated_by);
create index if not exists cf_fk_organization_update_reads_organization_id
  on public.organization_update_reads (organization_id);
create index if not exists cf_fk_organization_update_reads_user_id
  on public.organization_update_reads (user_id);
create index if not exists cf_fk_organization_updates_author_user_id
  on public.organization_updates (author_user_id);
create index if not exists cf_fk_organization_updates_organization_id
  on public.organization_updates (organization_id);
create index if not exists cf_fk_organizations_created_by
  on public.organizations (created_by);
create index if not exists cf_fk_push_subscriptions_organization_id
  on public.push_subscriptions (organization_id);
create index if not exists cf_fk_registrations_locked_by
  on public.registrations (locked_by);
create index if not exists cf_fk_registrations_organization_id
  on public.registrations (organization_id);
create index if not exists cf_fk_report_saved_views_owner_id
  on public.report_saved_views (owner_id);
create index if not exists cf_fk_role_requirements_credential_type_id
  on public.role_requirements (credential_type_id);
create index if not exists cf_fk_role_requirements_organization_id
  on public.role_requirements (organization_id);
create index if not exists cf_fk_saved_opportunities_opportunity_id
  on public.saved_opportunities (opportunity_id);
create index if not exists cf_fk_saved_opportunities_organization_id
  on public.saved_opportunities (organization_id);
create index if not exists cf_fk_service_verifications_organization_id
  on public.service_verifications (organization_id);
create index if not exists cf_fk_service_verifications_volunteer_id
  on public.service_verifications (volunteer_id);
create index if not exists cf_fk_shift_roles_organization_id
  on public.shift_roles (organization_id);
create index if not exists cf_fk_shift_series_opportunity_id
  on public.shift_series (opportunity_id);
create index if not exists cf_fk_shift_series_organization_id
  on public.shift_series (organization_id);
create index if not exists cf_fk_shift_series_roles_organization_id
  on public.shift_series_roles (organization_id);
create index if not exists cf_fk_shifts_opportunity_id
  on public.shifts (opportunity_id);
create index if not exists cf_fk_volunteer_credentials_credential_type_id
  on public.volunteer_credentials (credential_type_id);
create index if not exists cf_fk_volunteer_skills_organization_id
  on public.volunteer_skills (organization_id);
create index if not exists cf_fk_volunteer_stage_history_application_id
  on public.volunteer_stage_history (application_id);
create index if not exists cf_fk_volunteer_stage_history_organization_id
  on public.volunteer_stage_history (organization_id);
create index if not exists cf_fk_waitlist_entries_organization_id
  on public.waitlist_entries (organization_id);
create index if not exists cf_fk_waitlist_entries_volunteer_id
  on public.waitlist_entries (volunteer_id);
reset lock_timeout;
