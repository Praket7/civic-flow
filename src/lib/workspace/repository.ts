import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  Account,
  AccountRole,
  AuthSession,
  BackupRestoreResult,
  BackupSnapshot,
  CandidateAnswer,
  CheckinCode,
  CheckinWindow,
  CreateOpportunityResult,
  CredentialReadiness,
  DisruptionReport,
  EngagementMetrics,
  EncryptedBackupReceipt,
  ExportFormat,
  ExportReceipt,
  HoursDecision,
  InstallationAccess,
  MissionControlSummary,
  NewOpportunityInput,
  NotificationItem,
  NotificationRule,
  NotificationRulePatch,
  Opportunity,
  RecoveryChangeRequest,
  RecoveryPlan,
  RecurrenceRule,
  ReportDocument,
  ReportRequest,
  ReplacementRecommendation,
  RetentionSignal,
  RosterApplyAssignment,
  RosterEvaluation,
  RosterOptions,
  RosterPlan,
  RosterPolicy,
  RosterPolicyView,
  SeriesResult,
  SeriesRole,
  SessionSnapshot,
  ShiftSeriesRecord,
  VolunteerInsight,
  VolunteerImportPreview,
  VolunteerImportSummary,
  WeeklyAssignment,
  WorkspaceSettings,
} from "../../types/domain";
import { currentHostedSession, type HostedIdentity } from "../auth/hosted";
import { supabaseAnonKey } from "../sync/config";
import type {
  IssuedInvite,
  NewOrganizationInput,
  OrganizationAccess,
  OrganizationDetailsPatch,
  OrganizationMember,
  OrganizationProfile,
  PendingInvite,
} from "../organizations/types";
import { isTauri } from "../platform";
import { invokeAuthed } from "../nativeSession";
import { previewRepository } from "./previewRepository";

/**
 * The single data boundary: desktop invokes Rust commands that own SQLite and
 * the audit log; the preview repository mirrors the same contract.
 */
export interface WorkspaceRepository {
  readonly source: "desktop" | "preview";
  signIn(email: string, password: string, remember: boolean): Promise<AuthSession>;
  /** Creates the bundled demo workspace on request and signs in as its coordinator. */
  openDemoWorkspace(role?: "coordinator" | "volunteer"): Promise<AuthSession>;
  createAccount(name: string, email: string, password: string): Promise<AuthSession>;
  /** Resumes the local workspace behind an email the hosted provider verified. */
  signInWithHosted(identity: HostedIdentity): Promise<AuthSession>;
  signOut(token: string): Promise<void>;
  currentUser(token: string): Promise<Account | null>;
  listAccounts(token: string): Promise<Account[]>;
  resetPassword(token: string, userId: string, newPassword: string): Promise<void>;

  /** Organization access comes from membership rows, never from the screen. */
  listOrganizations(): Promise<OrganizationAccess[]>;
  listPublicOrganizations(): Promise<OrganizationProfile[]>;
  /** `null` parks the workspace while an identity has no membership yet. */
  selectOrganization(organizationId: string | null): Promise<void>;
  createOrganization(input: NewOrganizationInput): Promise<OrganizationAccess>;
  updateOrganization(
    organizationId: string,
    patch: OrganizationDetailsPatch,
  ): Promise<OrganizationProfile>;
  listOrganizationMembers(organizationId: string): Promise<OrganizationMember[]>;
  listOrganizationInvites(organizationId: string): Promise<PendingInvite[]>;
  createOrganizationInvite(
    organizationId: string,
    role: "coordinator" | "volunteer",
    email: string,
  ): Promise<IssuedInvite>;
  revokeOrganizationInvite(organizationId: string, inviteId: string): Promise<void>;
  redeemOrganizationInvite(code: string): Promise<OrganizationAccess>;
  joinPublicOrganization(organizationId: string): Promise<OrganizationAccess>;
  setOrganizationMemberRole(
    organizationId: string,
    userId: string,
    role: "coordinator" | "volunteer",
  ): Promise<OrganizationMember[]>;
  setOrganizationMemberStatus(
    organizationId: string,
    userId: string,
    status: "active" | "disabled",
  ): Promise<OrganizationMember[]>;
  transferOrganizationOwnership(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember[]>;
  getSnapshot(): Promise<SessionSnapshot>;
  setSaved(opportunityId: string, saved: boolean): Promise<SessionSnapshot>;
  setApplicationStage(applicationId: string, stage: string): Promise<SessionSnapshot>;
  /** Self check-in; the rotating code is what proves the volunteer is present. */
  checkIn(shiftId: string, volunteerId: string, code: string): Promise<SessionSnapshot>;
  /** A coordinator recording an arrival by hand, with a reason on the record. */
  manualCheckIn(shiftId: string, volunteerId: string, reason: string): Promise<SessionSnapshot>;
  checkOut(shiftId: string, volunteerId: string): Promise<SessionSnapshot>;
  markNoShow(shiftId: string, volunteerId: string): Promise<SessionSnapshot>;
  cancelRegistration(
    shiftId: string,
    volunteerId: string,
    reason?: string,
  ): Promise<SessionSnapshot>;
  joinWaitlist(
    shiftId: string,
    volunteerId: string,
    role: string,
    requestReview?: boolean,
  ): Promise<SessionSnapshot>;
  getCheckinCode(shiftId: string): Promise<CheckinCode>;
  checkinWindow(shiftId: string): Promise<CheckinWindow>;
  installationAccess(): Promise<InstallationAccess>;
  autoRoster(shiftIds: string[], options: RosterOptions): Promise<RosterPlan>;
  /** The plan plus the evaluation; screens format these values, never derive them. */
  evaluateRoster(shiftIds: string[], options: RosterOptions): Promise<RosterEvaluation>;
  /** Applies a reviewed plan across every shift in one transaction. */
  applyRosterWeek(
    expectedRevision: number | null,
    expectedPolicyVersion: number | null,
    assignments: WeeklyAssignment[],
  ): Promise<SessionSnapshot>;
  /** The matching policy in force, with the priority levels the screen offers. */
  getRosterPolicy(): Promise<RosterPolicyView>;
  updateRosterPolicy(policy: RosterPolicy): Promise<RosterPolicyView>;
  /** Why this person, or why not that one, from the planner's own rules. */
  explainRosterChoice(
    shiftIds: string[],
    options: RosterOptions,
    candidateId: string,
    slotId: string,
  ): Promise<CandidateAnswer>;
  applyRoster(shiftId: string, assignments: RosterApplyAssignment[]): Promise<SessionSnapshot>;
  /**
   * What is wrong with the roster right now: required seats with nobody in them,
   * and credentials that will not be valid when an assigned shift starts.
   */
  detectDisruptions(): Promise<DisruptionReport>;
  /**
   * A minimal repair for the chosen shifts. Coverage comes first, then how few
   * assignments the plan disturbs, then match quality. A locked assignment is
   * never moved.
   */
  planRecovery(shiftIds: string[], options: RosterOptions): Promise<RecoveryPlan>;
  /** Applies the approved changes in one transaction, one audit event each. */
  applyRecovery(shiftId: string, changes: RecoveryChangeRequest[]): Promise<SessionSnapshot>;
  /** Holds an assignment still so recovery and AutoRoster cannot move it. */
  setAssignmentLock(
    shiftId: string,
    volunteerId: string,
    locked: boolean,
  ): Promise<SessionSnapshot>;
  /** Schedules a repeating shift series and every instance it produces. */
  createShiftSeries(
    opportunityId: string,
    rule: RecurrenceRule,
    roles: SeriesRole[],
  ): Promise<SeriesResult>;
  listShiftSeries(opportunityId?: string): Promise<ShiftSeriesRecord[]>;
  /** Adds the occurrences the rule asks for that the series has not produced. */
  generateSeriesInstances(seriesId: string): Promise<SeriesResult>;
  /** Retimes one shift of the series, or the rule and every shift it made. */
  retimeShiftSeries(
    seriesId: string,
    startsLocalTime: string,
    durationMinutes: number,
    scope: "instance" | "series",
  ): Promise<SessionSnapshot>;
  deleteShiftSeries(seriesId: string): Promise<SessionSnapshot>;
  /** Who should take an opened seat, and why the people ahead were skipped. */
  recommendReplacement(shiftId: string, role: string): Promise<ReplacementRecommendation>;
  listNotificationRules(): Promise<NotificationRule[]>;
  updateNotificationRule(ruleId: string, patch: NotificationRulePatch): Promise<NotificationRule[]>;
  /** Queues every reminder that is due, and returns how many it wrote. */
  queueDueReminders(): Promise<number>;
  /** The transparent rules behind who might need attention. */
  retentionSignals(): Promise<RetentionSignal[]>;
  /** One volunteer's verified hours, completed shifts, and milestones. */
  volunteerInsight(volunteerId: string): Promise<VolunteerInsight>;
  engagementMetrics(): Promise<EngagementMetrics>;
  credentialReadiness(): Promise<CredentialReadiness>;
  promoteWaitlist(shiftId: string, volunteerId: string): Promise<SessionSnapshot>;
  reviewHours(entryId: string, decision: HoursDecision): Promise<SessionSnapshot>;
  updateSettings(patch: Partial<WorkspaceSettings>): Promise<SessionSnapshot>;
  createOpportunity(input: NewOpportunityInput): Promise<{
    opportunity: Opportunity;
    snapshot: SessionSnapshot;
  }>;
  registerForShift(shiftId: string, volunteerId: string, role: string): Promise<SessionSnapshot>;
  saveVolunteerProfile(
    patch: Partial<SessionSnapshot["volunteerProfile"]>,
  ): Promise<SessionSnapshot>;
  resetDemo(): Promise<SessionSnapshot>;
  listBackups(): Promise<BackupSnapshot[]>;
  createBackup(note?: string): Promise<BackupSnapshot[]>;
  restoreBackup(id: string): Promise<BackupRestoreResult>;
  /** Seals a snapshot and writes it wherever the coordinator chooses. */
  exportEncryptedBackup(passphrase: string): Promise<EncryptedBackupReceipt | null>;
  /** Restores from a sealed file, after the same checks a local snapshot passes. */
  importEncryptedBackup(passphrase: string): Promise<BackupRestoreResult | null>;
  getMissionControl(role?: AccountRole): Promise<MissionControlSummary>;
  getNotifications(role: AccountRole): Promise<NotificationItem[]>;
  markNotificationRead(id: string, role: AccountRole): Promise<void>;
  saveReportView(name: string, scope: string, filtersJson: string): Promise<SessionSnapshot>;
  generateReport(request: ReportRequest): Promise<ReportDocument>;
  exportReport(request: ReportRequest, format: ExportFormat): Promise<ExportReceipt | null>;
  /** Row-by-row check that writes nothing. */
  previewVolunteerImport(text: string): Promise<VolunteerImportPreview>;
  /** One transaction; any bad row refuses the whole file. */
  applyVolunteerImport(text: string): Promise<VolunteerImportSummary>;
  /** Writes the roster in the shape the import reads, for editing and return. */
  exportVolunteerRoster(): Promise<ExportReceipt | null>;
}

// The same shape the core suggests, so the dialog and the file agree.
function encryptedBackupName(): string {
  return `civicflow-backup-${new Date().toISOString().slice(0, 10)}.civicflow`;
}

export { setRepositoryToken } from "../nativeSession";

const desktopRepository: WorkspaceRepository = {
  source: "desktop",
  signIn: (email, password, remember) =>
    invoke<AuthSession>("sign_in", { email, password, remember }),
  openDemoWorkspace: () => invoke<AuthSession>("open_demo_workspace"),
  createAccount: (name, email, password) =>
    invoke<AuthSession>("create_account", { name, email, password }),
  signInWithHosted: async (_identity) => {
    const hostedSession = await currentHostedSession();
    if (!hostedSession?.access_token || !supabaseAnonKey) {
      throw new Error("Sign in with the hosted provider before opening this workspace.");
    }
    return invoke<AuthSession>("sign_in_with_hosted", {
      accessToken: hostedSession.access_token,
      anonKey: supabaseAnonKey,
    });
  },
  signOut: async (token) => {
    await invoke<boolean>("sign_out", { token });
  },
  currentUser: (token) => invoke<Account | null>("current_user", { token }),
  listAccounts: (token) => invoke<Account[]>("list_accounts", { token }),
  resetPassword: async (token, userId, newPassword) => {
    await invoke<null>("reset_password", { token, userId, newPassword });
  },
  listOrganizations: () => invokeAuthed<OrganizationAccess[]>("list_my_organizations"),
  listPublicOrganizations: () => invoke<OrganizationProfile[]>("list_public_organizations"),
  selectOrganization: async (organizationId) => {
    if (!organizationId) return;
    await invokeAuthed<OrganizationAccess>("select_organization", { organizationId });
  },
  createOrganization: (input) => invokeAuthed<OrganizationAccess>("create_organization", { input }),
  updateOrganization: (organizationId, patch) =>
    invokeAuthed<OrganizationProfile>("update_organization", { organizationId, patch }),
  listOrganizationMembers: (organizationId) =>
    invokeAuthed<OrganizationMember[]>("list_organization_members", { organizationId }),
  listOrganizationInvites: (organizationId) =>
    invokeAuthed<PendingInvite[]>("list_organization_invites", { organizationId }),
  createOrganizationInvite: (organizationId, role, email) =>
    invokeAuthed<IssuedInvite>("create_organization_invite", { organizationId, role, email }),
  revokeOrganizationInvite: async (organizationId, inviteId) => {
    await invokeAuthed<null>("revoke_organization_invite", { organizationId, inviteId });
  },
  redeemOrganizationInvite: (code) =>
    invokeAuthed<OrganizationAccess>("redeem_organization_invite", { code }),
  joinPublicOrganization: (organizationId) =>
    invokeAuthed<OrganizationAccess>("join_public_organization", { organizationId }),
  setOrganizationMemberRole: (organizationId, userId, role) =>
    invokeAuthed<OrganizationMember[]>("set_organization_member_role", {
      organizationId,
      userId,
      role,
    }),
  setOrganizationMemberStatus: (organizationId, userId, status) =>
    invokeAuthed<OrganizationMember[]>("set_organization_member_status", {
      organizationId,
      userId,
      status,
    }),
  transferOrganizationOwnership: (organizationId, userId) =>
    invokeAuthed<OrganizationMember[]>("transfer_organization_ownership", {
      organizationId,
      userId,
    }),
  getSnapshot: () => invokeAuthed<SessionSnapshot>("get_workspace_snapshot"),
  setSaved: (opportunityId, saved) =>
    invokeAuthed<SessionSnapshot>("set_saved_opportunity", { opportunityId, saved }),
  setApplicationStage: (applicationId, stage) =>
    invokeAuthed<SessionSnapshot>("set_application_stage", { applicationId, stage }),
  checkIn: (shiftId, volunteerId, code) =>
    invokeAuthed<SessionSnapshot>("check_in_volunteer", { shiftId, volunteerId, code }),
  manualCheckIn: (shiftId, volunteerId, reason) =>
    invokeAuthed<SessionSnapshot>("manual_check_in", { shiftId, volunteerId, reason }),
  checkOut: (shiftId, volunteerId) =>
    invokeAuthed<SessionSnapshot>("check_out_volunteer", { shiftId, volunteerId }),
  markNoShow: (shiftId, volunteerId) =>
    invokeAuthed<SessionSnapshot>("mark_volunteer_no_show", { shiftId, volunteerId }),
  cancelRegistration: (shiftId, volunteerId, reason) =>
    invokeAuthed<SessionSnapshot>("cancel_registration", {
      shiftId,
      volunteerId,
      reason: reason ?? null,
    }),
  joinWaitlist: (shiftId, volunteerId, role) =>
    invokeAuthed<SessionSnapshot>("join_waitlist", { shiftId, volunteerId, role }),
  getCheckinCode: (shiftId) => invokeAuthed<CheckinCode>("get_checkin_code", { shiftId }),
  checkinWindow: (shiftId) => invokeAuthed<CheckinWindow>("checkin_window", { shiftId }),
  installationAccess: () => invokeAuthed<InstallationAccess>("installation_access"),
  autoRoster: (shiftIds, options) => invokeAuthed<RosterPlan>("auto_roster", { shiftIds, options }),
  evaluateRoster: (shiftIds, options) =>
    invokeAuthed<RosterEvaluation>("evaluate_roster_candidates", { shiftIds, options }),
  applyRosterWeek: (expectedRevision, expectedPolicyVersion, assignments) =>
    invokeAuthed<SessionSnapshot>("apply_roster_week", {
      expectedRevision,
      expectedPolicyVersion,
      assignments,
    }),
  getRosterPolicy: () => invokeAuthed<RosterPolicyView>("get_roster_policy"),
  updateRosterPolicy: (policy) =>
    invokeAuthed<RosterPolicyView>("update_roster_policy", { policy }),
  explainRosterChoice: (shiftIds, options, candidateId, slotId) =>
    invokeAuthed<CandidateAnswer>("explain_roster_choice", {
      shiftIds,
      options,
      candidateId,
      slotId,
    }),
  applyRoster: (shiftId, assignments) =>
    invokeAuthed<SessionSnapshot>("apply_roster_plan", { shiftId, assignments }),
  detectDisruptions: () => invokeAuthed<DisruptionReport>("detect_disruptions"),
  planRecovery: (shiftIds, options) =>
    invokeAuthed<RecoveryPlan>("plan_recovery", { shiftIds, options }),
  applyRecovery: (shiftId, changes) =>
    invokeAuthed<SessionSnapshot>("apply_recovery", { shiftId, changes }),
  setAssignmentLock: (shiftId, volunteerId, locked) =>
    invokeAuthed<SessionSnapshot>("set_assignment_lock", { shiftId, volunteerId, locked }),
  createShiftSeries: (opportunityId, rule, roles) =>
    invokeAuthed<SeriesResult>("create_shift_series", { opportunityId, rule, roles }),
  listShiftSeries: (opportunityId) =>
    invokeAuthed<ShiftSeriesRecord[]>("list_shift_series", {
      opportunityId: opportunityId ?? null,
    }),
  generateSeriesInstances: (seriesId) =>
    invokeAuthed<SeriesResult>("generate_series_instances", { seriesId }),
  retimeShiftSeries: (seriesId, startsLocalTime, durationMinutes, scope) =>
    invokeAuthed<SessionSnapshot>("retime_shift_series", {
      seriesId,
      startsLocalTime,
      durationMinutes,
      scope,
    }),
  deleteShiftSeries: (seriesId) =>
    invokeAuthed<SessionSnapshot>("delete_shift_series", { seriesId }),
  recommendReplacement: (shiftId, role) =>
    invokeAuthed<ReplacementRecommendation>("recommend_replacement", { shiftId, role }),
  listNotificationRules: () => invokeAuthed<NotificationRule[]>("list_notification_rules"),
  updateNotificationRule: (ruleId, patch) =>
    invokeAuthed<NotificationRule[]>("update_notification_rule", { ruleId, patch }),
  queueDueReminders: () => invokeAuthed<number>("queue_due_reminders"),
  retentionSignals: () => invokeAuthed<RetentionSignal[]>("retention_signals"),
  volunteerInsight: (volunteerId) =>
    invokeAuthed<VolunteerInsight>("volunteer_insight", { volunteerId }),
  engagementMetrics: () => invokeAuthed<EngagementMetrics>("engagement_metrics"),
  credentialReadiness: () => invokeAuthed<CredentialReadiness>("credential_readiness"),
  promoteWaitlist: (shiftId, volunteerId) =>
    invokeAuthed<SessionSnapshot>("promote_waitlist", { shiftId, volunteerId }),
  reviewHours: (entryId, decision) =>
    invokeAuthed<SessionSnapshot>("review_hours", {
      entryId,
      status: decision.status,
      approvedMinutes: decision.approvedMinutes,
      reason: decision.reason,
    }),
  updateSettings: (patch) => invokeAuthed<SessionSnapshot>("update_workspace_settings", { patch }),
  createOpportunity: (input) =>
    invokeAuthed<CreateOpportunityResult>("create_opportunity", { input }),
  registerForShift: (shiftId, volunteerId, role) =>
    invokeAuthed<SessionSnapshot>("register_for_shift", { shiftId, volunteerId, role }),
  saveVolunteerProfile: (patch) =>
    invokeAuthed<SessionSnapshot>("save_volunteer_profile", {
      skills: patch.skills ?? [],
      availability: patch.availability ?? [],
      completedOnboarding: patch.completedOnboarding ?? true,
      phone: patch.phone ?? "",
      interests: patch.interests ?? "",
      causes: patch.causes ?? [],
      photo: patch.photo ?? "",
    }),
  resetDemo: () => invokeAuthed<SessionSnapshot>("reset_demo"),
  listBackups: () => invokeAuthed<BackupSnapshot[]>("list_backups"),
  createBackup: (note) => invokeAuthed<BackupSnapshot[]>("create_backup", { note }),
  restoreBackup: (id) => invokeAuthed<BackupRestoreResult>("restore_backup", { id }),
  exportEncryptedBackup: async (passphrase) => {
    const path = await save({
      title: "Save an encrypted backup",
      defaultPath: encryptedBackupName(),
      filters: [{ name: "CivicFlow archive", extensions: ["civicflow"] }],
    });
    if (!path) return null;
    return invokeAuthed<EncryptedBackupReceipt>("export_encrypted_backup", { path, passphrase });
  },
  importEncryptedBackup: async (passphrase) => {
    const chosen = await open({
      title: "Open an encrypted backup",
      multiple: false,
      directory: false,
      filters: [{ name: "CivicFlow archive", extensions: ["civicflow"] }],
    });
    if (!chosen || typeof chosen !== "string") return null;
    return invokeAuthed<BackupRestoreResult>("import_encrypted_backup", {
      path: chosen,
      passphrase,
    });
  },
  getMissionControl: () => invokeAuthed<MissionControlSummary>("get_mission_control"),
  getNotifications: () => invokeAuthed<NotificationItem[]>("list_notifications"),
  markNotificationRead: async (id: string) => {
    await invokeAuthed<boolean>("mark_notification_read", { id });
  },
  saveReportView: (name, scope, filtersJson) =>
    invokeAuthed<SessionSnapshot>("save_report_view", { name, scope, filtersJson }),
  generateReport: (request) => invokeAuthed<ReportDocument>("generate_report", { request }),
  exportReport: async (request, format) => {
    const document = await invokeAuthed<ReportDocument>("generate_report", { request });
    const extension = format === "pdf" ? "pdf" : "csv";
    const slug = document.template.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const path = await save({
      title: `Export ${document.title}`,
      defaultPath: `civicflow-${slug}-${document.period.slice(0, 10)}.${extension}`,
      filters: [
        {
          name: extension === "pdf" ? "PDF report" : "CSV report",
          extensions: [extension],
        },
      ],
    });
    if (!path) return null;
    return invokeAuthed<ExportReceipt>("export_report", { request, format, path });
  },
  previewVolunteerImport: (text) =>
    invokeAuthed<VolunteerImportPreview>("preview_volunteer_import", { text }),
  applyVolunteerImport: (text) =>
    invokeAuthed<VolunteerImportSummary>("apply_volunteer_import", { text }),
  exportVolunteerRoster: async () => {
    const path = await save({
      title: "Export the volunteer roster",
      defaultPath: "civicflow-volunteer-roster.csv",
      filters: [{ name: "CSV roster", extensions: ["csv"] }],
    });
    if (!path) return null;
    return invokeAuthed<ExportReceipt>("export_volunteer_roster", { path });
  },
};

export function getWorkspaceRepository(): WorkspaceRepository {
  return isTauri() ? desktopRepository : previewRepository;
}

/**
 * The seeded browser store. The desktop shell uses the same implementation for
 * an organization created in the app, so those workspaces stay isolated from the
 * local SQLite demo workspace.
 */
export { previewRepository };
