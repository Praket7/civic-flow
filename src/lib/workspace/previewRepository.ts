/**
 * Browser fallback for the workflow store: mirrors the snapshot contract over
 * the shared seed and localStorage. Chosen by `getWorkspaceRepository()` when
 * there is no native host.
 */

import rawSessionSeed from "../../../shared/session-seed.json";
import { isTauri } from "../platform";
import { downloadCsv } from "../csv";
import rawWorkspace from "../../../shared/demo-workspace.json";
import type {
  Account,
  AccountRole,
  Applicant,
  AttendanceEntry,
  AuditEvent,
  BackupRestoreResult,
  CandidateAnswer,
  CheckinCode,
  CheckinStatus,
  CheckinWindow,
  Credential,
  AuthSession,
  DemoWorkspace,
  DisruptedRole,
  DisruptedShift,
  DisruptionReport,
  HoursDecision,
  ImpactMetric,
  InstallationAccess,
  NewOpportunityInput,
  NotificationItem,
  Opportunity,
  PriorityLevel,
  CredentialReadiness,
  EngagementMetrics,
  Milestone,
  NotificationRule,
  NotificationRulePatch,
  RecurrenceRule,
  RecoveryChange,
  RecoveryChangeRequest,
  RecoveryPlan,
  RecoverySeat,
  ReplacementRecommendation,
  RetentionSignal,
  RosterApplyAssignment,
  RosterEvaluation,
  RosterOptions,
  RosterPlan,
  RosterPolicy,
  RosterPolicyView,
  RosterVolunteer,
  SavedViewRecord,
  SeriesResult,
  ServiceVerification,
  SessionSnapshot,
  ShiftSeriesRecord,
  VolunteerInsight,
  WaitlistCandidate,
  VolunteerImportPreview,
  WaitlistEntry,
  WeeklyAssignment,
  WorkspaceSettings,
} from "../../types/domain";
import * as previewOrganizations from "../organizations/preview";
import { buildMissionControl } from "./compute";
import { buildPreviewReport, previewRetention } from "./preview/reports";
import { renderPrintableReport } from "./preview/reportHtml";
import { IMPORT_COLUMNS, previewVolunteerCsv } from "./preview/volunteerImport";
import { createPreviewRosterStorage } from "./preview/rosterStorage";
import { createPreviewRosterPolicyStore } from "./preview/rosterPolicyStore";
import { createPreviewBackupStore } from "./preview/backupStore";
import { createPreviewRosterEngine, roleRequirement } from "./preview/rosterEngine";
import { demoWorkspace } from "./dataset";
import {
  blankWorkspaceForOrganization,
  withCreatedPrograms,
  withCreatedShifts,
  withRoster,
} from "./organizationWorkspace";
import type { OrganizationScope } from "./organizationWorkspace";
import type { WorkspaceRepository } from "./repository";
import {
  PREVIEW_ACCOUNT_KEY,
  PREVIEW_ACCOUNTS_KEY,
  previewPasswords,
  storedPreviewAccounts,
} from "./previewAccountStorage";

const STORAGE_KEY = "civicflow.workflow.v1";
const READ_KEY = "civicflow.notifications.read";

/**
 * Each organization has its own workflow overlay; the demo keeps the original
 * keys and an account with no organization reads an empty store.
 */
const DEMO_ORGANIZATION_ID = demoWorkspace.organization.id;
const NO_ORGANIZATION_ID = "no-organization";

const DEMO_SCOPE: OrganizationScope = {
  id: demoWorkspace.organization.id,
  name: demoWorkspace.organization.name,
};

let organization: OrganizationScope | null = DEMO_SCOPE;

function scopeId(): string {
  return organization?.id ?? NO_ORGANIZATION_ID;
}

function scoped(key: string): string {
  return scopeId() === DEMO_ORGANIZATION_ID ? key : `${key}:${scopeId()}`;
}
/** The identity the preview screens are operating as. */
let activePreviewAccount: Account | null = null;

function requirePreviewAccount(): Account {
  if (activePreviewAccount) return activePreviewAccount;
  const demo = previewAccounts.find((row) => row.role !== "none") ?? previewAccounts[0];
  if (!demo) throw new Error("Sign in before opening an organization.");
  return demo;
}

/**
 * The role comes from the selected membership, not the identity row stored at
 * sign-up.
 */
function withLiveRole(account: Account): Account {
  const access = previewOrganizations.active(account);
  if (!access) return account;
  const role: AccountRole = access.membership.role === "volunteer" ? "volunteer" : "coordinator";
  if (role === "coordinator") return { ...account, role, volunteerId: null };
  const matching = workspace.volunteers.find(
    (volunteer) => volunteer.email?.toLowerCase() === account.email.toLowerCase(),
  );
  return { ...account, role, volunteerId: matching?.id ?? account.volunteerId };
}

function previewAccountFromToken(token: string): Account | null {
  const match = /^preview:([^:]+):([^:]+)$/.exec(token);
  if (!match) return null;
  const account = previewAccounts.find((row) => row.id === match[1]);
  if (!account) return null;
  const expected = previewPasswords()[account.id] ?? "demo";
  return expected === match[2] ? withLiveRole(account) : null;
}

function previewToken(account: Account): string {
  const version = previewPasswords()[account.id] ?? "demo";
  return `preview:${account.id}:${version}`;
}

interface SessionSeed {
  savedOpportunityIds: string[];
  waitlist: WaitlistEntry[];
  applications: Applicant[];
  audit: AuditEvent[];
  settings: WorkspaceSettings;
}

const demoSeed = rawSessionSeed as unknown as SessionSeed;
const demoWorkspaceData = rawWorkspace as unknown as DemoWorkspace;

let seed: SessionSeed = demoSeed;
let workspace: DemoWorkspace = demoWorkspaceData;
let current = workspace.volunteers.find(
  (volunteer) => volunteer.id === workspace.currentVolunteerId,
);

/** Settings for an organization nobody has set up yet: no demo identity. */
function blankSeed(organization: OrganizationScope | null): SessionSeed {
  return {
    savedOpportunityIds: [],
    waitlist: [],
    applications: [],
    audit: [],
    settings: {
      ...demoSeed.settings,
      organizationName: organization?.name ?? "Your organization",
      contactEmail: organization?.contactEmails?.[0] ?? "",
    },
  };
}

function revisionKey(): string {
  return scoped("civicflow.workspace-revision.v1");
}

function loadRevision(): number {
  try {
    const value = Number(localStorage.getItem(revisionKey()));
    return Number.isFinite(value) && value > 0 ? value : 1;
  } catch {
    return 1;
  }
}

function bumpRevision(): void {
  revision += 1;
  try {
    localStorage.setItem(revisionKey(), String(revision));
  } catch {
    // The in-memory counter still guards the open session.
  }
}

function applyScope(next: OrganizationScope | null): void {
  organization = next;
  if (next && next.id === DEMO_ORGANIZATION_ID) {
    workspace = demoWorkspaceData;
    seed = demoSeed;
  } else {
    const coordinator: Account | null = next?.coordinatorName
      ? {
          id: "scope-coordinator",
          name: next.coordinatorName,
          email: next.coordinatorEmail ?? "",
          role: "coordinator",
          volunteerId: null,
        }
      : null;
    workspace = blankWorkspaceForOrganization(next, coordinator);
    seed = blankSeed(next);
  }
  current = workspace.volunteers.find((volunteer) => volunteer.id === workspace.currentVolunteerId);
  state = loadSnapshot();
  revision = loadRevision();
}

const seededAccounts: Account[] = [
  {
    id: "user-praket",
    name: "Praket Gauri",
    email: "praket@rivergate.example",
    role: "coordinator",
    volunteerId: null,
  },
  {
    id: "user-maya",
    name: current?.name ?? "Maya Chen",
    email: current?.email ?? "maya.chen@example.org",
    role: "volunteer",
    volunteerId: current?.id ?? workspace.currentVolunteerId,
  },
];

const previewAccounts: Account[] = [...seededAccounts, ...storedPreviewAccounts()];

function defaultCredentials(): Credential[] {
  return workspace.credentials.map((credential) => {
    const today = workspace.now.slice(0, 10);
    const status =
      credential.validThrough < today
        ? "expired"
        : credential.validThrough <=
            new Date(new Date(workspace.now).getTime() + 45 * 86_400_000).toISOString().slice(0, 10)
          ? "expiring"
          : "current";
    return { ...credential, status };
  });
}

function defaultVerifications(): ServiceVerification[] {
  const groups = new Map<string, ServiceVerification>();
  for (const entry of [...workspace.hourEntries, ...workspace.mayaEntries]) {
    if (entry.status !== "verified" || !entry.verificationId) continue;
    const existing = groups.get(entry.verificationId);
    if (existing) {
      existing.totalMinutes += entry.minutes;
      existing.dateStart = existing.dateStart < entry.date ? existing.dateStart : entry.date;
      existing.dateEnd = existing.dateEnd > entry.date ? existing.dateEnd : entry.date;
    } else {
      groups.set(entry.verificationId, {
        id: `verification-${entry.verificationId}`,
        code: entry.verificationId,
        volunteerId: entry.volunteerId,
        organizationId: workspace.organization.id,
        dateStart: entry.date,
        dateEnd: entry.date,
        totalMinutes: entry.minutes,
        issuedAt: workspace.now,
        issuedBy: workspace.coordinator.name,
      });
    }
  }
  return [...groups.values()];
}

function defaultImpactMetrics(): ImpactMetric[] {
  return workspace.impactRecords.map((record) => ({ ...record }));
}

function defaultAttendance(): SessionSnapshot["attendance"] {
  const arrivedAt = new Date(new Date(workspace.now).getTime() - 18 * 60_000).toISOString();
  const rows = workspace.registrations
    .filter(
      (row) => row.shiftId === "sh-tue-pantry" && row.volunteerId !== workspace.currentVolunteerId,
    )
    .slice(0, 2)
    .map((row) => ({
      volunteerId: row.volunteerId,
      shiftId: row.shiftId,
      role: row.role,
      status: "checked_in" as const,
      checkedInAt: arrivedAt,
      checkedOutAt: null,
    }));
  return rows.length > 0 ? { "sh-tue-pantry": rows } : {};
}

function defaultSavedViews(): SavedViewRecord[] {
  return workspace.savedViews.map((view) => ({
    id: view.id,
    scope: "records",
    name: view.name,
    filtersJson: JSON.stringify(view.filters),
    createdAt: workspace.now,
  }));
}

const { readImportedRoster, writeImportedRoster, workspaceRoster } = createPreviewRosterStorage(
  scoped,
  () => workspace.volunteers,
);

export function createDefaultSnapshot(): SessionSnapshot {
  const snapshot: SessionSnapshot = {
    savedOpportunityIds: [...seed.savedOpportunityIds],
    attendance: defaultAttendance(),
    hoursDecisions: {},
    applications: seed.applications.map((applicant) => ({ ...applicant })),
    waitlist: seed.waitlist.map((entry) => ({ ...entry })),
    settings: { ...seed.settings },
    createdOpportunities: [],
    registrations: workspace.registrations.map((row) => ({ ...row })),
    audit: seed.audit.map((event) => ({ ...event })),
    volunteerProfile: {
      skills: current?.skills ?? [],
      availability: current?.availability ?? [],
      completedOnboarding: true,
      phone: current?.phone ?? "",
      interests: current?.interests ?? "",
      causes: current?.causes ?? [],
      photo: current?.photo ?? "",
    },
    credentials: defaultCredentials(),
    verifications: defaultVerifications(),
    impactMetrics: defaultImpactMetrics(),
    savedViews: defaultSavedViews(),
    retention: [],
    checkinCode: null,
    roster: workspaceRoster(),
  };
  return withRetention(snapshot);
}

/** Recompute derived retention rather than persisting a stale synthetic rate. */
function withRetention(snapshot: SessionSnapshot): SessionSnapshot {
  return { ...snapshot, retention: previewRetention(journeyWorkspace(snapshot), snapshot) };
}

function readIds(): string[] {
  try {
    const raw = localStorage.getItem(scoped(READ_KEY));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string")
      ? (parsed as string[])
      : [];
  } catch {
    return [];
  }
}

function writeIds(ids: string[]): void {
  try {
    localStorage.setItem(scoped(READ_KEY), JSON.stringify([...new Set(ids)]));
  } catch {
    // Storage can be unavailable in hardened webviews; the fallback still works.
  }
}

function loadSnapshot(): SessionSnapshot {
  const fallback = createDefaultSnapshot();
  try {
    const raw = localStorage.getItem(scoped(STORAGE_KEY));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SessionSnapshot>;
    return withRetention({
      ...fallback,
      ...parsed,
      applications: Array.isArray(parsed.applications)
        ? parsed.applications
        : fallback.applications,
      waitlist: Array.isArray(parsed.waitlist) ? parsed.waitlist : fallback.waitlist,
      audit: Array.isArray(parsed.audit) ? parsed.audit : fallback.audit,
      settings: { ...fallback.settings, ...(parsed.settings ?? {}) },
      volunteerProfile: { ...fallback.volunteerProfile, ...(parsed.volunteerProfile ?? {}) },
    });
  } catch {
    return fallback;
  }
}

let state = loadSnapshot();
let revision = loadRevision();

const { clone, isRecord, validSnapshot, makeBackup, writeBackups, ensureBackups, listBackupMeta } =
  createPreviewBackupStore(
    scoped,
    () => workspace,
    () => state,
  );

function persist(next: SessionSnapshot): SessionSnapshot {
  next = withRetention(next);
  state = next;
  bumpRevision();
  try {
    localStorage.setItem(scoped(STORAGE_KEY), JSON.stringify(next));
  } catch {
    // The in-memory store is enough when storage is refused.
  }
  return next;
}

function audit(
  action: string,
  entityType: AuditEvent["entityType"],
  entityId: string,
  summary: string,
  detail?: string,
): AuditEvent {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: workspace.now,
    actor: workspace.coordinator.name,
    action,
    entityType,
    entityId,
    summary,
    detail,
  };
}

function previewCheckinCode(shiftId: string): string {
  const window = Math.floor(new Date(workspace.now).getTime() / (15 * 60_000));
  const seed = `${shiftId}:${window}`;
  let hash = 0xcbf29ce4;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return String(hash % 1_000_000).padStart(6, "0");
}

// Browser preview mirrors the Rust self check-in window.
const SELF_CHECKIN_OPEN_BEFORE_MINUTES = 30;
const SELF_CHECKIN_CLOSE_AFTER_MINUTES = 15;

function previewCheckinWindow(shiftId: string): CheckinWindow {
  const shift =
    workspace.shifts.find((row) => row.id === shiftId) ??
    (state.createdShifts ?? []).find((row) => row.id === shiftId);
  if (!shift) throw new Error("That shift is no longer available.");
  const startsAt = new Date(shift.startsAt).getTime();
  const opensAt = new Date(startsAt - SELF_CHECKIN_OPEN_BEFORE_MINUTES * 60_000);
  const closesAt = new Date(startsAt + SELF_CHECKIN_CLOSE_AFTER_MINUTES * 60_000);
  const now = new Date(workspace.now).getTime();
  const status: CheckinStatus =
    now < opensAt.getTime() ? "not_open" : now > closesAt.getTime() ? "closed" : "open";
  return {
    shiftId,
    opensAt: opensAt.toISOString(),
    closesAt: closesAt.toISOString(),
    status,
    canSelfCheckIn: status === "open",
  };
}

function volunteerName(id: string): string {
  return (
    journeyWorkspace().volunteers.find((volunteer) => volunteer.id === id)?.name ?? "Volunteer"
  );
}

function volunteerRole(id: string): string {
  return (
    journeyWorkspace().volunteers.find((volunteer) => volunteer.id === id)?.skills[0] ??
    "General support"
  );
}

/** The role a volunteer holds on a shift, as the registration records it. */
function registeredRole(shiftId: string, volunteerId: string): string {
  return (
    state.registrations.find(
      (row) =>
        row.shiftId === shiftId && row.volunteerId === volunteerId && row.status !== "canceled",
    )?.role ?? volunteerRole(volunteerId)
  );
}

/**
 * Counts the registration rows, which the seed's own totals predate. Mission
 * Control and Schedule must agree on these numbers.
 */
function journeyWorkspace(snapshot = state): DemoWorkspace {
  return withCreatedShifts(
    withCreatedPrograms(
      withRoster(workspace, snapshot.roster ?? []),
      snapshot.createdOpportunities,
    ),
    snapshot.createdSeries ?? [],
    snapshot.createdShifts ?? [],
  );
}

function countedWorkspace(): DemoWorkspace {
  const base = journeyWorkspace();
  return {
    ...base,
    shifts: base.shifts.map((shift) => {
      const live = state.registrations.filter(
        (row) => row.shiftId === shift.id && row.status === "registered",
      );
      return {
        ...shift,
        confirmed: live.length,
        waitlisted: state.waitlist.filter(
          (row) => row.shiftId === shift.id && row.status === "waiting",
        ).length,
        roles: shift.roles.map((role) => ({
          ...role,
          filled: live.filter((row) => row.role === role.name).length,
        })),
      };
    }),
  };
}

/// Matches the desktop core: attendance row, audit entry, and the reason together.
function validateJourneySeat(
  snapshot: SessionSnapshot,
  shiftId: string,
  volunteerId: string,
  role: string,
) {
  const base = journeyWorkspace(snapshot);
  const shift = base.shifts.find((row) => row.id === shiftId);
  const volunteer = base.volunteers.find((row) => row.id === volunteerId);
  if (!shift || shift.status !== "scheduled" || new Date(shift.endsAt) <= new Date(base.now))
    throw new Error("This shift is not accepting registrations.");
  if (!volunteer || volunteer.status !== "active")
    throw new Error("Only active volunteers can hold a seat.");
  const requested = shift.roles.find((row) => row.name === role);
  if (!requested) throw new Error("Choose a role offered on this shift.");
  const live = snapshot.registrations.filter(
    (row) => row.shiftId === shiftId && row.status === "registered",
  );
  if (live.some((row) => row.volunteerId === volunteerId))
    throw new Error("This volunteer already holds a seat.");
  if (
    live.length >= shift.capacity ||
    live.filter((row) => row.role === role).length >= requested.required
  )
    throw new Error("That role is full. Join the waitlist instead.");
  if (
    snapshot.registrations.some((row) => {
      if (row.volunteerId !== volunteerId || row.status !== "registered" || row.shiftId === shiftId)
        return false;
      const other = base.shifts.find((item) => item.id === row.shiftId);
      return (
        other &&
        other.status === "scheduled" &&
        new Date(other.startsAt) < new Date(shift.endsAt) &&
        new Date(other.endsAt) > new Date(shift.startsAt)
      );
    })
  )
    throw new Error("This shift overlaps an existing registration.");
  const requirement = roleRequirement(role);
  if (
    requirement.skill &&
    !volunteer.skills.some((skill) => skill.toLowerCase().includes(requirement.skill.toLowerCase()))
  )
    throw new Error(`Required skill: ${requirement.skill}.`);
  if (
    requirement.credential &&
    !snapshot.credentials.some(
      (row) =>
        row.volunteerId === volunteerId &&
        row.name.toLowerCase() === requirement.credential?.toLowerCase() &&
        row.verifiedAt &&
        row.validFrom.slice(0, 10) <= shift.startsAt.slice(0, 10) &&
        row.validThrough.slice(0, 10) >= shift.startsAt.slice(0, 10),
    )
  )
    throw new Error(`A verified ${requirement.credential} credential is required.`);
}

function journeyNotice(
  volunteerId: string,
  shiftId: string,
  title: string,
  body: string,
  kind: NotificationItem["kind"] = "shift",
): NotificationItem & { volunteerId: string } {
  return {
    id: crypto.randomUUID(),
    volunteerId,
    kind,
    title,
    body,
    priority: "normal",
    createdAt: workspace.now,
    readAt: null,
    href: `/volunteer/shifts/${shiftId}`,
  };
}

function recordArrival(
  snapshot: SessionSnapshot,
  shiftId: string,
  volunteerId: string,
  action: "shift.checkin" | "shift.manual_checkin",
  reason: string | null,
): SessionSnapshot {
  const existing = (snapshot.attendance[shiftId] ?? []).find(
    (row) => row.volunteerId === volunteerId,
  );
  if (existing?.status === "checked_in" || existing?.status === "completed") return snapshot;
  if (existing?.status === "no_show")
    throw new Error("Correct the no-show before recording an arrival.");
  const shift = journeyWorkspace(snapshot).shifts.find((row) => row.id === shiftId);
  if (!shift || shift.status === "canceled") throw new Error("This shift is not available.");
  if (
    !snapshot.registrations.some(
      (row) =>
        row.shiftId === shiftId && row.volunteerId === volunteerId && row.status === "registered",
    )
  ) {
    throw new Error("That volunteer does not hold a seat on this shift.");
  }
  const next = withAttendance(snapshot, shiftId, {
    volunteerId,
    shiftId,
    role: existing?.role ?? registeredRole(shiftId, volunteerId),
    status: "checked_in",
    checkedInAt: workspace.now,
    checkedOutAt: null,
  });
  return persist({
    ...next,
    audit: [
      audit(
        action,
        "shift",
        shiftId,
        `Checked in ${volunteerName(volunteerId)}`,
        reason
          ? `Role: ${existing?.role ?? registeredRole(shiftId, volunteerId)}. Recorded by hand: ${reason}`
          : undefined,
      ),
      ...next.audit,
    ],
  });
}

function withAttendance(
  snapshot: SessionSnapshot,
  shiftId: string,
  entry: AttendanceEntry,
): SessionSnapshot {
  const existing = snapshot.attendance[shiftId] ?? [];
  return {
    ...snapshot,
    attendance: {
      ...snapshot.attendance,
      [shiftId]: [...existing.filter((row) => row.volunteerId !== entry.volunteerId), entry],
    },
  };
}

function previewVolunteers(text: string): VolunteerImportPreview {
  return previewVolunteerCsv(
    text,
    workspaceRoster().map((record) => record.email),
  );
}

/** Both roster entry points commit one validated snapshot, or no changes at all. */
function applyPreviewAssignments(assignments: WeeklyAssignment[]): SessionSnapshot {
  if (assignments.length === 0) {
    throw new Error("Select at least one suggested assignment to apply");
  }
  let next = state;
  const events: AuditEvent[] = [];
  for (const assignment of assignments) {
    validateJourneySeat(next, assignment.shiftId, assignment.candidateId, assignment.role);
    if (
      next.waitlist.some(
        (row) =>
          row.shiftId === assignment.shiftId &&
          row.volunteerId === assignment.candidateId &&
          row.status === "waiting",
      )
    ) {
      next = {
        ...next,
        waitlist: next.waitlist.map((row) =>
          row.shiftId === assignment.shiftId &&
          row.volunteerId === assignment.candidateId &&
          row.status === "waiting"
            ? { ...row, status: "promoted" }
            : row,
        ),
      };
    }
    next = {
      ...next,
      registrations: [
        ...next.registrations.filter(
          (row) =>
            !(row.shiftId === assignment.shiftId && row.volunteerId === assignment.candidateId),
        ),
        {
          shiftId: assignment.shiftId,
          volunteerId: assignment.candidateId,
          role: assignment.role,
          status: "registered",
        },
      ],
    };
    events.push(
      audit(
        assignment.promoteWaitlist ? "waitlist.promote" : "autoroster.apply",
        "shift",
        assignment.shiftId,
        `AutoRoster assigned ${volunteerName(assignment.candidateId)} as ${assignment.role}`,
        "Applied from an approved AutoRoster plan",
      ),
    );
  }
  return persist({
    ...next,
    journeyNotifications: [
      ...assignments.map((assignment) =>
        journeyNotice(
          assignment.candidateId,
          assignment.shiftId,
          "Shift assignment confirmed",
          `You are registered as ${assignment.role}.`,
        ),
      ),
      ...(next.journeyNotifications ?? []),
    ],
    audit: [...events, ...next.audit],
  });
}

export const previewRepository: WorkspaceRepository = {
  source: "preview",
  async listOrganizations() {
    return previewOrganizations.list(requirePreviewAccount());
  },
  async listPublicOrganizations() {
    return previewOrganizations.listPublic();
  },
  async selectOrganization(organizationId) {
    if (!organizationId) {
      applyScope(null);
      return;
    }
    const access = previewOrganizations.select(requirePreviewAccount(), organizationId);
    applyScope({
      id: access.organization.id,
      name: access.organization.name,
      coordinatorName:
        access.membership.role === "owner" || access.membership.role === "coordinator"
          ? access.organization.name
          : undefined,
      image: access.organization.image ?? undefined,
      imageAlt: access.organization.imageAlt ?? undefined,
    });
  },
  async createOrganization(input) {
    const access = previewOrganizations.create(requirePreviewAccount(), input);
    applyScope({
      id: access.organization.id,
      name: access.organization.name,
      coordinatorName: access.organization.name,
      image: access.organization.image ?? undefined,
      imageAlt: access.organization.imageAlt ?? undefined,
    });
    return access;
  },
  async updateOrganization(organizationId, patch) {
    return previewOrganizations.update(requirePreviewAccount(), organizationId, patch);
  },
  async listOrganizationMembers(organizationId) {
    return previewOrganizations.members(requirePreviewAccount(), organizationId);
  },
  async listOrganizationInvites(organizationId) {
    return previewOrganizations.invites(requirePreviewAccount(), organizationId);
  },
  async createOrganizationInvite(organizationId, role, email) {
    return previewOrganizations.createInvite(requirePreviewAccount(), organizationId, role, email);
  },
  async revokeOrganizationInvite(organizationId, inviteId) {
    previewOrganizations.revokeInvite(requirePreviewAccount(), organizationId, inviteId);
  },
  async redeemOrganizationInvite(code) {
    const access = previewOrganizations.redeem(requirePreviewAccount(), code);
    applyScope({
      id: access.organization.id,
      name: access.organization.name,
      coordinatorName: access.organization.name,
      image: access.organization.image ?? undefined,
      imageAlt: access.organization.imageAlt ?? undefined,
    });
    return access;
  },
  async joinPublicOrganization(organizationId) {
    const access = previewOrganizations.join(requirePreviewAccount(), organizationId);
    applyScope({
      id: access.organization.id,
      name: access.organization.name,
      coordinatorName: access.organization.name,
      image: access.organization.image ?? undefined,
      imageAlt: access.organization.imageAlt ?? undefined,
    });
    return access;
  },
  async setOrganizationMemberRole(organizationId, userId, role) {
    return previewOrganizations.setRole(requirePreviewAccount(), organizationId, userId, role);
  },
  async setOrganizationMemberStatus(organizationId, userId, status) {
    return previewOrganizations.setStatus(requirePreviewAccount(), organizationId, userId, status);
  },
  async transferOrganizationOwnership(organizationId, userId) {
    return previewOrganizations.transferOwnership(requirePreviewAccount(), organizationId, userId);
  },
  async openDemoWorkspace(role = "coordinator"): Promise<AuthSession> {
    const demo = seededAccounts.find((row) => row.role === role);
    if (!demo) throw new Error("The browser preview has no demo workspace to open.");
    previewOrganizations.select(demo, DEMO_ORGANIZATION_ID);
    const live = withLiveRole(demo);
    activePreviewAccount = live;
    return {
      token: previewToken(live),
      user: live,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
  },
  async signIn(email, password, _remember): Promise<AuthSession> {
    if (import.meta.env.PROD && !isTauri()) {
      throw new Error("This browser build is a demo, not a hosted account system.");
    }
    const clean = email.trim().toLowerCase();
    const account = previewAccounts.find((row) => row.email.toLowerCase() === clean);
    const stored = account ? previewPasswords()[account.id] : undefined;
    const expected = stored ?? "civicflow-demo";
    if (!account || password !== expected) {
      throw new Error("That email and password do not match an account on this device.");
    }
    const live = withLiveRole(account);
    activePreviewAccount = live;
    return {
      token: previewToken(live),
      user: live,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
  },
  async createAccount(name, email, password): Promise<AuthSession> {
    if (import.meta.env.PROD && !isTauri()) {
      throw new Error("This browser build is a demo. Account creation is not available here.");
    }
    const clean = email.trim().toLowerCase();
    const display = name.trim().replace(/\s+/g, " ");
    if (display.length < 2) throw new Error("Enter the name to show on this account.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      throw new Error("Use an email address like name@example.org.");
    }
    if (password.length < 8) throw new Error("Use at least 8 characters for the password.");
    if (previewAccounts.some((row) => row.email.toLowerCase() === clean)) {
      throw new Error("An account already uses that email. Sign in instead.");
    }
    const suffix = Date.now().toString(36);
    const account: Account = {
      id: `user-preview-${suffix}`,
      name: display,
      email: clean,
      // A fresh identity has no workspace role. Membership supplies one.
      role: "none",
      volunteerId: null,
    };
    try {
      localStorage.setItem(
        PREVIEW_ACCOUNT_KEY,
        JSON.stringify({ ...previewPasswords(), [account.id]: password }),
      );
      localStorage.setItem(
        PREVIEW_ACCOUNTS_KEY,
        JSON.stringify([...storedPreviewAccounts(), account]),
      );
    } catch {
      throw new Error("The browser preview could not save the new account.");
    }
    previewAccounts.push(account);
    activePreviewAccount = account;
    return {
      token: previewToken(account),
      user: account,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
  },
  async signInWithHosted({ name, email }): Promise<AuthSession> {
    if (import.meta.env.PROD && !isTauri()) {
      throw new Error("Hosted accounts cannot be adopted into the browser demo.");
    }
    const clean = email.trim().toLowerCase();
    const existing = previewAccounts.find((row) => row.email.toLowerCase() === clean);
    if (existing) {
      const live = withLiveRole(existing);
      activePreviewAccount = live;
      return {
        token: previewToken(live),
        user: live,
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      };
    }
    const suffix = Date.now().toString(36);
    const account: Account = {
      id: `user-hosted-${suffix}`,
      name: name.trim().replace(/\s+/g, " ") || clean,
      email: clean,
      role: "none",
      volunteerId: null,
    };
    try {
      localStorage.setItem(
        PREVIEW_ACCOUNTS_KEY,
        JSON.stringify([...storedPreviewAccounts(), account]),
      );
    } catch {
      throw new Error("The browser preview could not save the hosted account.");
    }
    previewAccounts.push(account);
    activePreviewAccount = account;
    return {
      token: previewToken(account),
      user: account,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
  },
  async signOut(token) {
    void token;
  },
  async currentUser(token) {
    const account = previewAccountFromToken(token);
    if (account) activePreviewAccount = account;
    return account;
  },
  async listAccounts(token) {
    const account = previewAccountFromToken(token);
    if (account?.role !== "coordinator") throw new Error("Only a coordinator can list accounts.");
    // This list answers "who is on this team", not "who exists on the device".
    const self = previewOrganizations.active(account);
    if (!self) return [];
    const roster = previewOrganizations.members(account, self.organization.id);
    const byId = new Map(previewAccounts.map((row) => [row.id, row]));
    return roster
      .map((member) => byId.get(member.userId))
      .filter((row): row is Account => Boolean(row))
      .map((row) => withLiveRole(row));
  },
  async resetPassword(token, userId, newPassword) {
    const account = previewAccountFromToken(token);
    if (account?.role !== "coordinator") throw new Error("Only a coordinator can reset passwords.");
    if (newPassword.length < 8) throw new Error("Use at least 8 characters for the password.");
    const target = previewAccounts.find((row) => row.id === userId);
    if (!target) throw new Error("Account not found.");
    try {
      localStorage.setItem(
        PREVIEW_ACCOUNT_KEY,
        JSON.stringify({ ...previewPasswords(), [userId]: newPassword }),
      );
    } catch {
      throw new Error("The browser preview could not save the new password.");
    }
  },
  async getSnapshot() {
    return state;
  },
  async setSaved(opportunityId, saved) {
    const opportunity = journeyWorkspace().opportunities.find((row) => row.id === opportunityId);
    if (!opportunity) throw new Error("Opportunity not found");
    const currentlySaved = state.savedOpportunityIds.includes(opportunityId);
    if (currentlySaved === saved) return state;
    return persist({
      ...state,
      savedOpportunityIds: saved
        ? [...state.savedOpportunityIds, opportunityId]
        : state.savedOpportunityIds.filter((id) => id !== opportunityId),
      audit: [
        audit(
          saved ? "opportunity.save" : "opportunity.unsave",
          "opportunity",
          opportunityId,
          saved
            ? `Saved ${opportunity.title}`
            : `Removed ${opportunity.title} from saved opportunities`,
        ),
        ...state.audit,
      ],
    });
  },
  async setApplicationStage(applicationId, stage) {
    const applicant = state.applications.find((row) => row.id === applicationId);
    if (!applicant) throw new Error("Application not found");
    if (applicant.stage === stage) return state;
    if (!["applied", "review", "onboarding", "active"].includes(stage))
      throw new Error("Unknown application stage.");
    return persist({
      ...state,
      applications: state.applications.map((row) =>
        row.id === applicationId ? { ...row, stage: stage as Applicant["stage"] } : row,
      ),
      audit: [
        audit(
          "application.stage",
          "volunteer",
          applicationId,
          `Moved ${applicant.name} to ${stage.charAt(0).toUpperCase()}${stage.slice(1)}`,
          `Previously ${applicant.stage}`,
        ),
        ...state.audit,
      ],
    });
  },
  async checkIn(shiftId, volunteerId, code) {
    const window = previewCheckinWindow(shiftId);
    if (!window.canSelfCheckIn) {
      throw new Error(
        window.status === "not_open"
          ? "Check-in opens 30 minutes before the shift starts."
          : "Self check-in closed 15 minutes after the shift started. Ask a coordinator to record your arrival.",
      );
    }
    const supplied = code.trim().replace(/^civicflow:\/\/checkin\//, "");
    const expected = previewCheckinCode(shiftId);
    // The door kiosk sends the QR payload; the volunteer page sends the digits.
    if (supplied !== expected && supplied !== `demo-${shiftId}-${expected}`) {
      throw new Error("That check-in code is not valid.");
    }
    return recordArrival(state, shiftId, volunteerId, "shift.checkin", null);
  },
  async manualCheckIn(shiftId, volunteerId, reason) {
    if (reason.trim().length < 4) {
      throw new Error("Say why this arrival is being recorded by hand.");
    }
    return recordArrival(state, shiftId, volunteerId, "shift.manual_checkin", reason.trim());
  },
  async checkOut(shiftId, volunteerId) {
    const existing = (state.attendance[shiftId] ?? []).find(
      (row) => row.volunteerId === volunteerId,
    );
    if (existing?.status === "completed") return state;
    if (existing?.status !== "checked_in" || !existing.checkedInAt) {
      throw new Error("Check this volunteer in before checking them out.");
    }
    const shift = journeyWorkspace().shifts.find((row) => row.id === shiftId);
    if (!shift || shift.status === "canceled") throw new Error("This shift is not available.");
    const minutes = Math.max(
      1,
      Math.min(
        1440,
        Math.floor(
          (new Date(workspace.now).getTime() - new Date(existing.checkedInAt).getTime()) / 60_000,
        ),
      ),
    );
    const next = withAttendance(state, shiftId, {
      volunteerId,
      shiftId,
      role: existing.role,
      status: "completed",
      checkedInAt: existing.checkedInAt,
      checkedOutAt: workspace.now,
    });
    const id = `service:${shiftId}:${volunteerId}`;
    return persist({
      ...next,
      submittedHours: [
        ...(next.submittedHours ?? []).filter((row) => row.id !== id),
        {
          id,
          volunteerId,
          opportunityId: shift.opportunityId,
          shiftId,
          date: shift.startsAt.slice(0, 10),
          minutes,
          status: "pending",
          verificationId: null,
        },
      ],
      audit: [
        audit("shift.checkout", "shift", shiftId, `Checked out ${volunteerName(volunteerId)}`),
        ...next.audit,
      ],
    });
  },
  async cancelRegistration(shiftId, volunteerId, reason) {
    const registration = state.registrations.find(
      (row) => row.shiftId === shiftId && row.volunteerId === volunteerId,
    );
    if (registration?.status === "canceled") return state;
    if (!registration || registration.status !== "registered")
      throw new Error("That registration no longer exists.");
    if (
      (state.attendance[shiftId] ?? []).some(
        (row) =>
          row.volunteerId === volunteerId &&
          (row.status === "checked_in" || row.status === "completed"),
      )
    )
      throw new Error("An attended shift cannot be canceled.");
    const nextRegistrations: SessionSnapshot["registrations"] = state.registrations.map((row) =>
      row.shiftId === shiftId && row.volunteerId === volunteerId
        ? { ...row, status: "canceled" }
        : row,
    );
    const released = { ...state, registrations: nextRegistrations };
    const promoted = state.settings.autoPromoteWaitlist
      ? [...state.waitlist]
          .filter((row) => {
            if (
              row.shiftId !== shiftId ||
              row.status !== "waiting" ||
              row.eligibleRole !== registration.role
            )
              return false;
            try {
              validateJourneySeat(released, shiftId, row.volunteerId, row.eligibleRole);
              return true;
            } catch {
              return false;
            }
          })
          .sort((a, b) => a.position - b.position)[0]
      : undefined;
    const auditEvents = [
      audit(
        "shift.cancel_registration",
        "shift",
        shiftId,
        `Canceled ${volunteerName(volunteerId)}'s registration`,
        reason,
      ),
    ];
    if (promoted) {
      const previous = nextRegistrations.findIndex(
        (row) => row.shiftId === shiftId && row.volunteerId === promoted.volunteerId,
      );
      if (previous >= 0) nextRegistrations.splice(previous, 1);
      nextRegistrations.push({
        shiftId,
        volunteerId: promoted.volunteerId,
        role: registration.role,
        status: "registered",
      });
      auditEvents.push(
        audit(
          "waitlist.promote",
          "shift",
          shiftId,
          `Promoted ${volunteerName(promoted.volunteerId)} from the waitlist`,
          `Filled the ${registration.role} seat opened by a cancellation`,
        ),
      );
    }
    return persist({
      ...state,
      registrations: nextRegistrations,
      waitlist: promoted
        ? state.waitlist.map((row) =>
            row.id === promoted.id ? { ...row, status: "promoted" } : row,
          )
        : state.waitlist,
      journeyNotifications: [
        journeyNotice(volunteerId, shiftId, "Seat canceled", "Your registration was canceled."),
        ...(promoted
          ? [
              journeyNotice(
                promoted.volunteerId,
                shiftId,
                "Waitlist promoted",
                `Your ${registration.role} seat is confirmed.`,
                "WAITLIST_PROMOTED",
              ),
            ]
          : []),
        ...(state.journeyNotifications ?? []),
      ],
      audit: [...auditEvents, ...state.audit],
    });
  },
  async joinWaitlist(shiftId, volunteerId, role, requestReview = false) {
    if (
      state.waitlist.some(
        (row) =>
          row.shiftId === shiftId && row.volunteerId === volunteerId && row.status === "waiting",
      )
    ) {
      return state;
    }
    const shift = journeyWorkspace().shifts.find((row) => row.id === shiftId);
    if (
      !shift ||
      shift.status !== "scheduled" ||
      new Date(shift.startsAt) <= new Date(workspace.now)
    )
      throw new Error("This shift is not accepting waitlist requests.");
    if (!journeyWorkspace().volunteers.some((row) => row.id === volunteerId))
      throw new Error("Volunteer not found.");
    if (
      state.registrations.some(
        (row) =>
          row.shiftId === shiftId && row.volunteerId === volunteerId && row.status === "registered",
      )
    )
      throw new Error("This volunteer already holds a seat.");
    if (!shift.roles.some((row) => row.name === role))
      throw new Error("Choose a role offered on this shift.");
    const entry: WaitlistEntry = {
      id: `wait-${shiftId}-${volunteerId}-${crypto.randomUUID()}`,
      shiftId,
      volunteerId,
      createdAt: workspace.now,
      status: "waiting",
      position:
        Math.max(
          0,
          ...state.waitlist.filter((row) => row.shiftId === shiftId).map((row) => row.position),
        ) + 1,
      eligibleRole: role,
      requestReview,
    };
    return persist({
      ...state,
      waitlist: [
        ...state.waitlist.filter(
          (row) => row.shiftId !== shiftId || row.volunteerId !== volunteerId,
        ),
        entry,
      ],
      audit: [
        audit(
          "waitlist.join",
          "shift",
          shiftId,
          requestReview
            ? `Requested coordinator review for ${volunteerName(volunteerId)} as ${role}`
            : `Added ${volunteerName(volunteerId)} to the waitlist`,
        ),
        ...state.audit,
      ],
    });
  },
  async checkinWindow(shiftId): Promise<CheckinWindow> {
    return previewCheckinWindow(shiftId);
  },
  async installationAccess(): Promise<InstallationAccess> {
    return { steward: previewOrganizations.isWorkspaceSteward(requirePreviewAccount()) };
  },
  async getCheckinCode(shiftId): Promise<CheckinCode> {
    const issuedAt = workspace.now;
    const expiresAt = new Date(
      new Date(workspace.now).getTime() + 4 * 60 * 60 * 1000,
    ).toISOString();
    const code = previewCheckinCode(shiftId);
    const token = `demo-${shiftId}-${code}`;
    return {
      shiftId,
      code,
      token,
      issuedAt,
      expiresAt,
      payload: `civicflow://checkin/${token}`,
    };
  },
  async autoRoster(shiftIds, options): Promise<RosterPlan> {
    return previewRosterPlan(shiftIds, options, readRosterPolicy());
  },
  async evaluateRoster(shiftIds, options): Promise<RosterEvaluation> {
    return previewEvaluation(shiftIds, options);
  },
  async applyRosterWeek(expectedRevision, expectedPolicyVersion, assignments) {
    if (expectedRevision !== null && expectedRevision !== revision) {
      throw new Error(
        "PLAN_STALE: the roster changed after this plan was generated. Rebuild the plan so nobody is double-booked.",
      );
    }
    if (expectedPolicyVersion !== null && expectedPolicyVersion !== readRosterPolicy().version) {
      throw new Error(
        "POLICY_STALE: the matching policy changed after this plan was generated. Rebuild the plan before applying it.",
      );
    }
    return applyPreviewAssignments(assignments);
  },
  async getRosterPolicy(): Promise<RosterPolicyView> {
    return {
      policy: readRosterPolicy(),
      levels: PREVIEW_PRIORITY_LEVELS,
      organizationId: scopeId(),
    };
  },
  async updateRosterPolicy(policy): Promise<RosterPolicyView> {
    validateRosterPolicy(policy);
    const next: RosterPolicy = { ...policy, version: readRosterPolicy().version + 1 };
    writeRosterPolicy(next);
    return { policy: next, levels: PREVIEW_PRIORITY_LEVELS, organizationId: scopeId() };
  },
  async explainRosterChoice(shiftIds, options, candidateId, slotId): Promise<CandidateAnswer> {
    return previewExplain(shiftIds, options, candidateId, slotId);
  },
  async applyRoster(shiftId, assignments: RosterApplyAssignment[]) {
    return applyPreviewAssignments(assignments.map((assignment) => ({ ...assignment, shiftId })));
  },
  async detectDisruptions(): Promise<DisruptionReport> {
    return previewDisruptions();
  },
  async planRecovery(shiftIds, options): Promise<RecoveryPlan> {
    return previewRecoveryPlan(shiftIds, options);
  },
  async applyRecovery(shiftId, changes: RecoveryChangeRequest[]) {
    if (changes.length === 0) throw new Error("Select at least one change to apply");
    const shift = workspace.shifts.find((row) => row.id === shiftId);
    if (!shift || shift.status !== "scheduled") {
      throw new Error("This shift is no longer accepting assignments.");
    }
    let next = state;
    const events: AuditEvent[] = [];
    for (const change of changes) {
      const held = next.registrations.find(
        (row) => row.shiftId === shiftId && row.volunteerId === change.volunteerId,
      );
      if (change.fromRole) {
        if (!held || held.status !== "registered" || held.role !== change.fromRole) {
          throw new Error("That volunteer is no longer on this shift, so there is nothing to move");
        }
        if (previewLocks.has(`${shiftId}:${change.volunteerId}`)) {
          throw new Error("That assignment is locked. Unlock it first.");
        }
      }
      next = {
        ...next,
        waitlist: change.promoteWaitlist
          ? next.waitlist.map((row) =>
              row.shiftId === shiftId &&
              row.volunteerId === change.volunteerId &&
              row.status === "waiting"
                ? { ...row, status: "promoted" }
                : row,
            )
          : next.waitlist,
        registrations: [
          ...next.registrations.filter(
            (row) => !(row.shiftId === shiftId && row.volunteerId === change.volunteerId),
          ),
          { shiftId, volunteerId: change.volunteerId, role: change.role, status: "registered" },
        ],
      };
      events.push(
        audit(
          "recovery.apply",
          "shift",
          shiftId,
          change.fromRole
            ? `Recovery moved ${volunteerName(change.volunteerId)} from ${change.fromRole} to ${change.role}`
            : `Recovery assigned ${volunteerName(change.volunteerId)} as ${change.role}`,
          "Approved from a coverage recovery plan",
        ),
      );
    }
    return persist({ ...next, audit: [...events, ...next.audit] });
  },
  async setAssignmentLock(shiftId, volunteerId, locked) {
    const held = state.registrations.find(
      (row) => row.shiftId === shiftId && row.volunteerId === volunteerId,
    );
    if (!held || held.status !== "registered") {
      throw new Error("Only a live assignment can be locked");
    }
    const key = `${shiftId}:${volunteerId}`;
    if (previewLocks.has(key) === locked) return state;
    if (locked) previewLocks.add(key);
    else previewLocks.delete(key);
    return persist({
      ...state,
      audit: [
        audit(
          locked ? "assignment.lock" : "assignment.unlock",
          "shift",
          shiftId,
          `${locked ? "Locked" : "Unlocked"} ${volunteerName(volunteerId)}'s assignment`,
          locked
            ? "Recovery and AutoRoster will not move a locked assignment"
            : "The assignment can be replanned again",
        ),
        ...state.audit,
      ],
    });
  },
  async createShiftSeries(opportunityId, rule, roles): Promise<SeriesResult> {
    const opportunity = [...workspace.opportunities, ...state.createdOpportunities].find(
      (row) => row.id === opportunityId,
    );
    if (!opportunity) throw new Error("That program is not on file.");
    if (roles.length === 0) throw new Error("Give the series at least one role to fill");
    const needed = roles.reduce((total, role) => total + role.required, 0);
    if (needed > opportunity.capacity) {
      throw new Error(
        `These roles need ${needed} volunteers, but ${opportunity.title} is listed for ${opportunity.capacity}`,
      );
    }
    const dates = previewOccurrences(rule);
    const series: ShiftSeriesRecord = {
      id: `series-${crypto.randomUUID()}`,
      opportunityId,
      opportunityTitle: opportunity.title,
      timezone: workspace.organization.timezone,
      kind: rule.kind,
      intervalWeeks: rule.intervalWeeks,
      weekdays: rule.weekdays,
      startsLocalTime: rule.startsLocalTime,
      durationMinutes: rule.durationMinutes,
      startsOn: rule.startsOn,
      endsOn: rule.endsOn,
      occurrenceCount: rule.occurrenceCount,
      generated: dates.length,
      roles,
    };
    const shifts = dates.map((date, index) => {
      const startsAt = previewShiftStart(date, rule.startsLocalTime);
      return {
        id: `sh-series-${series.id}-${index + 1}`,
        occurrenceDate: date,
        startsAt,
        endsAt: new Date(
          new Date(startsAt).getTime() + rule.durationMinutes * 60_000,
        ).toISOString(),
      };
    });
    const next = persist({
      ...state,
      createdSeries: [...(state.createdSeries ?? []), series],
      createdShifts: [...(state.createdShifts ?? []), ...shifts],
      audit: [
        audit(
          "series.create",
          "opportunity",
          opportunityId,
          `Scheduled ${shifts.length} shift(s) for ${opportunity.title}`,
          `${series.kind === "weekly" ? "Weekly" : "Single"} series, ${roles.length} roles`,
        ),
        ...state.audit,
      ],
    });
    return { series, shifts, snapshot: next };
  },
  async listShiftSeries(opportunityId): Promise<ShiftSeriesRecord[]> {
    const series = state.createdSeries ?? [];
    return opportunityId ? series.filter((row) => row.opportunityId === opportunityId) : series;
  },
  async generateSeriesInstances(seriesId): Promise<SeriesResult> {
    const series = (state.createdSeries ?? []).find((row) => row.id === seriesId);
    if (!series) throw new Error("That series is not on file.");
    const existing = new Set(
      (state.createdShifts ?? [])
        .filter((row) => row.id.startsWith(`sh-series-${seriesId}-`))
        .map((row) => row.occurrenceDate),
    );
    const dates = previewOccurrences(previewRuleOf(series)).filter((date) => !existing.has(date));
    const added = dates.map((date, index) => {
      const startsAt = previewShiftStart(date, series.startsLocalTime);
      return {
        id: `sh-series-${seriesId}-extra-${index + 1}-${date}`,
        occurrenceDate: date,
        startsAt,
        endsAt: new Date(
          new Date(startsAt).getTime() + series.durationMinutes * 60_000,
        ).toISOString(),
      };
    });
    const next = persist({
      ...state,
      createdShifts: [...(state.createdShifts ?? []), ...added],
      createdSeries: (state.createdSeries ?? []).map((row) =>
        row.id === seriesId ? { ...row, generated: row.generated + added.length } : row,
      ),
    });
    return {
      series: next.createdSeries?.find((row) => row.id === seriesId) ?? series,
      shifts: added,
      snapshot: next,
    };
  },
  async retimeShiftSeries(seriesId, startsLocalTime, durationMinutes, scope) {
    const series = (state.createdSeries ?? []).find((row) => row.id === seriesId);
    if (!series) throw new Error("That series is not on file.");
    const today = workspace.now.slice(0, 10);
    let moved = 0;
    const shifts = (state.createdShifts ?? []).map((row) => {
      const mine = row.id.startsWith(`sh-series-${seriesId}-`);
      if (!mine || row.occurrenceDate < today) return row;
      if (scope === "instance" && moved > 0) return row;
      moved += 1;
      const startsAt = previewShiftStart(row.occurrenceDate, startsLocalTime);
      return {
        ...row,
        startsAt,
        endsAt: new Date(new Date(startsAt).getTime() + durationMinutes * 60_000).toISOString(),
      };
    });
    const next = persist({
      ...state,
      createdShifts: shifts,
      createdSeries: (state.createdSeries ?? []).map((row) =>
        row.id === seriesId
          ? {
              ...row,
              startsLocalTime: scope === "series" ? startsLocalTime : row.startsLocalTime,
              durationMinutes: scope === "series" ? durationMinutes : row.durationMinutes,
            }
          : row,
      ),
      audit: [
        audit(
          "series.retime",
          "opportunity",
          series.opportunityId,
          `Moved ${moved} shift(s) to ${startsLocalTime}`,
          scope === "instance" ? "Applied to this shift only" : "Applied to the whole series",
        ),
        ...state.audit,
      ],
    });
    return next;
  },
  async deleteShiftSeries(seriesId) {
    const series = (state.createdSeries ?? []).find((row) => row.id === seriesId);
    if (!series) throw new Error("That series is not on file.");
    const booked = (state.createdShifts ?? []).some(
      (row) =>
        row.id.startsWith(`sh-series-${seriesId}-`) &&
        state.registrations.some(
          (registration) => registration.shiftId === row.id && registration.status === "registered",
        ),
    );
    if (booked) {
      throw new Error(
        "Some of these shifts already have volunteers. Remove them first, or cancel the series from the schedule.",
      );
    }
    return persist({
      ...state,
      createdShifts: (state.createdShifts ?? []).filter(
        (row) => !row.id.startsWith(`sh-series-${seriesId}-`),
      ),
      createdSeries: (state.createdSeries ?? []).filter((row) => row.id !== seriesId),
      audit: [
        audit(
          "series.delete",
          "opportunity",
          series.opportunityId,
          `Removed ${series.generated} shift(s) from ${series.opportunityTitle}`,
          "The series and its shifts were deleted together",
        ),
        ...state.audit,
      ],
    });
  },
  async recommendReplacement(shiftId, role): Promise<ReplacementRecommendation> {
    return previewReplacement(shiftId, role);
  },
  async listNotificationRules(): Promise<NotificationRule[]> {
    return previewRules();
  },
  async updateNotificationRule(ruleId, patch: NotificationRulePatch) {
    const rules = previewRules().map((rule) =>
      rule.id === ruleId
        ? {
            ...rule,
            offsetMinutes: patch.offsetMinutes ?? rule.offsetMinutes,
            enabled: patch.enabled ?? rule.enabled,
          }
        : rule,
    );
    writePreviewRules(rules);
    return rules;
  },
  async queueDueReminders(): Promise<number> {
    return previewReminders().length;
  },
  async retentionSignals(): Promise<RetentionSignal[]> {
    return previewSignals();
  },
  async volunteerInsight(volunteerId): Promise<VolunteerInsight> {
    return previewInsight(volunteerId);
  },
  async engagementMetrics(): Promise<EngagementMetrics> {
    return previewEngagement();
  },
  async credentialReadiness(): Promise<CredentialReadiness> {
    return previewReadiness();
  },
  async markNoShow(shiftId, volunteerId) {
    const existing = (state.attendance[shiftId] ?? []).find(
      (row) => row.volunteerId === volunteerId,
    );
    // Marking the same person twice must not release the seat twice, and must
    // not write a second audit entry for one absence.
    if (existing?.status === "no_show") return state;
    if (existing?.status === "checked_in" || existing?.status === "completed") {
      throw new Error(
        "This volunteer already checked in. Correct the attendance record instead of marking a no-show.",
      );
    }
    const registration = state.registrations.find(
      (row) =>
        row.shiftId === shiftId && row.volunteerId === volunteerId && row.status === "registered",
    );
    if (!registration) {
      throw new Error("That volunteer does not hold a seat on this shift.");
    }
    const next = withAttendance(state, shiftId, {
      volunteerId,
      shiftId,
      role: existing?.role ?? registration.role ?? volunteerRole(volunteerId),
      status: "no_show",
      checkedInAt: null,
      checkedOutAt: null,
    });
    return persist({
      ...next,
      // Seat and role totals are projections of the registration rows, so the
      // absence has to land there too or every count keeps the empty seat.
      registrations: next.registrations.map((row) =>
        row.shiftId === shiftId && row.volunteerId === volunteerId && row.status === "registered"
          ? { ...row, status: "no_show" }
          : row,
      ),
      audit: [
        audit(
          "shift.no_show",
          "shift",
          shiftId,
          `Marked ${volunteerName(volunteerId)} as a no-show`,
        ),
        ...next.audit,
      ],
    });
  },
  async promoteWaitlist(shiftId, volunteerId) {
    const entry = state.waitlist.find(
      (row) => row.shiftId === shiftId && row.volunteerId === volunteerId,
    );
    if (!entry) throw new Error("Waitlist entry not found");
    if (entry.status !== "waiting") return state;
    validateJourneySeat(state, shiftId, volunteerId, entry.eligibleRole);
    return persist({
      ...state,
      waitlist: state.waitlist.map((row) =>
        row.id === entry.id ? { ...row, status: "promoted" } : row,
      ),
      registrations: [
        ...state.registrations.filter(
          (row) => !(row.shiftId === shiftId && row.volunteerId === volunteerId),
        ),
        { shiftId, volunteerId, role: entry.eligibleRole, status: "registered" },
      ],
      journeyNotifications: [
        journeyNotice(
          volunteerId,
          shiftId,
          "Waitlist promoted",
          `Your ${entry.eligibleRole} seat is confirmed.`,
          "WAITLIST_PROMOTED",
        ),
        ...(state.journeyNotifications ?? []),
      ],
      audit: [
        audit(
          "waitlist.promote",
          "shift",
          shiftId,
          `Promoted ${volunteerName(volunteerId)} from the waitlist`,
        ),
        ...state.audit,
      ],
    });
  },
  async reviewHours(entryId, decision: HoursDecision) {
    const entry = [
      ...workspace.hourEntries,
      ...workspace.mayaEntries,
      ...(state.submittedHours ?? []),
    ].find((row) => row.id === entryId);
    if (!entry || state.hoursDecisions[entryId] || entry.status !== "pending")
      throw new Error("Only pending hours can be reviewed");
    if (decision.reason.trim().length === 0) throw new Error("Enter a review reason.");
    if (
      decision.status === "verified" &&
      (!Number.isInteger(decision.approvedMinutes) ||
        (decision.approvedMinutes ?? 0) <= 0 ||
        (decision.approvedMinutes ?? 0) > 1440)
    ) {
      throw new Error("Approved hours need an approved minute value");
    }
    return persist({
      ...state,
      hoursDecisions: { ...state.hoursDecisions, [entryId]: decision },
      journeyNotifications: entry.shiftId
        ? [
            journeyNotice(
              entry.volunteerId,
              entry.shiftId,
              decision.status === "verified" ? "Service hours approved" : "Service hours rejected",
              decision.reason,
              decision.status === "verified" ? "HOURS_APPROVED" : "hours",
            ),
            ...(state.journeyNotifications ?? []),
          ]
        : state.journeyNotifications,
      audit: [
        audit(
          decision.status === "verified" ? "hours.approve" : "hours.reject",
          "hours",
          entryId,
          decision.status === "verified"
            ? `Approved ${decision.approvedMinutes ?? 0} minutes for ${volunteerName(entry.volunteerId)}`
            : `Rejected submitted hours for ${volunteerName(entry.volunteerId)}`,
          decision.reason,
        ),
        ...state.audit,
      ],
    });
  },
  async updateSettings(patch) {
    const settings = { ...state.settings, ...patch };
    if (!settings.organizationName.trim()) throw new Error("Organization name is required");
    if (!settings.contactEmail.includes("@")) throw new Error("Enter a valid contact email");
    return persist({
      ...state,
      settings,
      audit: [
        audit("settings.update", "settings", "workspace", "Updated workspace settings"),
        ...state.audit,
      ],
    });
  },
  async createOpportunity(input: NewOpportunityInput) {
    const id = `opp-new-${crypto.randomUUID()}`;
    const opportunity: Opportunity = {
      id,
      slug: input.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, ""),
      title: input.title,
      cause: input.cause,
      organization: workspace.organization.name,
      image: "/media/opp-community-event.jpg",
      imageAlt: `${input.title} volunteers at work`,
      description: input.description,
      address: input.address,
      distanceMiles: 2.4,
      coordinator: workspace.coordinator.name,
      capacity: input.capacity,
      duration: input.duration,
      training: ["Orientation on arrival"],
      requirements: input.requirements,
      impactMetric: "New program — impact will be tracked after the first shift",
    };
    return {
      opportunity,
      snapshot: persist({
        ...state,
        createdOpportunities: [opportunity, ...state.createdOpportunities],
        audit: [
          audit(
            "opportunity.create",
            "opportunity",
            opportunity.id,
            `Created ${opportunity.title}`,
            `Capacity: ${opportunity.capacity}`,
          ),
          ...state.audit,
        ],
      }),
    };
  },
  async registerForShift(shiftId, volunteerId, role) {
    if (
      state.registrations.some(
        (row) =>
          row.shiftId === shiftId && row.volunteerId === volunteerId && row.status === "registered",
      )
    )
      return state;
    const chosen = role.trim() || volunteerRole(volunteerId);
    validateJourneySeat(state, shiftId, volunteerId, chosen);
    return persist({
      ...state,
      waitlist: state.waitlist.map((row) =>
        row.shiftId === shiftId && row.volunteerId === volunteerId && row.status === "waiting"
          ? { ...row, status: "promoted" }
          : row,
      ),
      registrations: [
        ...state.registrations.filter(
          (row) => !(row.shiftId === shiftId && row.volunteerId === volunteerId),
        ),
        {
          shiftId,
          volunteerId,
          role: chosen,
          status: "registered",
        },
      ],
      journeyNotifications: [
        journeyNotice(volunteerId, shiftId, "Seat confirmed", `You are registered as ${chosen}.`),
        ...(state.journeyNotifications ?? []),
      ],
      audit: [
        audit(
          "shift.register",
          "shift",
          shiftId,
          `Registered ${volunteerName(volunteerId)} as ${role || volunteerRole(volunteerId)}`,
        ),
        ...state.audit,
      ],
    });
  },
  async saveVolunteerProfile(patch) {
    if (patch.skills && patch.skills.length === 0) {
      throw new Error("Choose at least one skill so matches stay explainable");
    }
    if (patch.availability && patch.availability.length === 0) {
      throw new Error("Add at least one availability window");
    }
    return persist({
      ...state,
      volunteerProfile: { ...state.volunteerProfile, ...patch },
      audit: [
        audit(
          "volunteer.profile_update",
          "volunteer",
          workspace.currentVolunteerId,
          "Updated skills and availability",
        ),
        ...state.audit,
      ],
    });
  },
  async previewVolunteerImport(text: string) {
    return previewVolunteers(text);
  },
  async applyVolunteerImport(text: string) {
    const preview = previewVolunteers(text);
    if (preview.problems.length > 0) throw new Error(preview.problems.join(" "));
    if (preview.invalid > 0) {
      throw new Error(
        `${preview.invalid} of ${preview.total} rows need a fix before anything is written.`,
      );
    }
    if (preview.valid === 0) throw new Error("This file has no volunteer rows to add.");

    const created: RosterVolunteer[] = preview.rows.map((row, index) => ({
      id: `vol-new-${Date.now()}-${index}`,
      name: row.name,
      email: row.email,
      phone: row.phone,
      status: row.status,
      joinedAt: workspace.now,
      skills: row.skills,
      availability: row.availability,
      causes: row.causes,
    }));
    writeImportedRoster([...readImportedRoster(), ...created]);
    // Adding them to the loaded workspace means this session's roster screens and
    // candidate pools see the same people the stored roster does.
    workspace = withRoster(workspace, created);
    state = persist({
      ...state,
      audit: [
        audit(
          "volunteers.imported",
          "volunteer",
          created[0]?.id ?? "roster",
          `Imported ${created.length} volunteer${created.length === 1 ? "" : "s"} from a spreadsheet`,
          `${preview.total} rows read · ${created.length} added`,
        ),
        ...state.audit,
      ],
    });
    return { created: created.length, createdIds: created.map((row) => row.id), preview };
  },
  async exportVolunteerRoster() {
    const header = IMPORT_COLUMNS.map(([, label]) => label);
    const rows = workspaceRoster().map((record) => [
      record.name,
      record.email,
      record.phone,
      record.status,
      record.skills.join("; "),
      record.availability.join("; "),
      "",
      record.causes.join("; "),
    ]);
    const blob = downloadCsv("civicflow-volunteer-roster.csv", [header, ...rows]);
    return {
      path: "browser-download",
      bytes: blob.size,
      format: "csv" as const,
      title: "Volunteer roster",
    };
  },
  async resetDemo() {
    try {
      localStorage.removeItem(scoped(STORAGE_KEY));
      localStorage.removeItem(scoped(READ_KEY));
    } catch {
      // Resetting in memory is still meaningful.
    }
    state = createDefaultSnapshot();
    return state;
  },
  async listBackups() {
    return listBackupMeta();
  },
  async createBackup(note) {
    const backups = ensureBackups();
    const created = makeBackup(state, "manual", note?.trim() || "Manual snapshot");
    writeBackups([created, ...backups]);
    return listBackupMeta();
  },
  async exportEncryptedBackup() {
    throw new Error("Encrypted archives are written by the desktop app.");
  },
  async importEncryptedBackup() {
    throw new Error("Encrypted archives are opened by the desktop app.");
  },
  async restoreBackup(id): Promise<BackupRestoreResult> {
    const backups = ensureBackups();
    const target = backups.find((entry) => entry.meta.id === id);
    if (!target) throw new Error("That snapshot is not available in this workspace.");
    if (!validSnapshot(target.snapshot) || target.meta.integrity !== "ok") {
      throw new Error(
        "That backup is incomplete or foreign, or its integrity check failed. It was not restored.",
      );
    }

    const safety = makeBackup(state, "automatic", `Before restoring ${id}`);
    writeBackups([safety, ...backups]);

    const restored = clone(target.snapshot);
    const event = audit(
      "backup.restore",
      "backup",
      id,
      `Restored backup ${id}`,
      `Safety snapshot: ${safety.meta.id}`,
    );
    const next = persist({ ...restored, audit: [event, ...restored.audit] });
    return { snapshot: next, backups: listBackupMeta() };
  },
  async getMissionControl(role: "coordinator" | "volunteer" = "coordinator") {
    return buildMissionControl(countedWorkspace(), readIds(), role);
  },
  async getNotifications(role: AccountRole) {
    const read = readIds();
    const recipient = activePreviewAccount?.volunteerId ?? workspace.currentVolunteerId;
    const updates =
      role === "volunteer"
        ? (state.journeyNotifications ?? []).filter((row) => row.volunteerId === recipient)
        : [];
    return [...updates, ...workspace.notifications]
      .filter((notification) =>
        role === "volunteer"
          ? notification.href.startsWith("/volunteer")
          : !notification.href.startsWith("/volunteer"),
      )
      .map((notification) => ({
        ...notification,
        readAt: read.includes(notification.id) ? new Date().toISOString() : notification.readAt,
      }));
  },
  async markNotificationRead(id: string, _role: AccountRole) {
    writeIds([...readIds(), id]);
  },
  async saveReportView(name, scope, filtersJson) {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 80) {
      throw new Error("Saved view names must be 2–80 characters.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(filtersJson);
    } catch {
      throw new Error("Saved view filters must be valid JSON.");
    }
    if (!isRecord(parsed)) throw new Error("Saved view filters must be a JSON object.");
    const existing = state.savedViews.find((view) => view.name === trimmed && view.scope === scope);
    const savedView: SavedViewRecord = {
      id: existing?.id ?? `view-${Date.now()}`,
      scope,
      name: trimmed,
      filtersJson,
      createdAt: existing?.createdAt ?? workspace.now,
    };
    return persist({
      ...state,
      savedViews: existing
        ? state.savedViews.map((view) => (view.id === existing.id ? savedView : view))
        : [savedView, ...state.savedViews],
      audit: [
        audit("report.view_saved", "system", trimmed, `Saved report view ${trimmed}`),
        ...state.audit,
      ],
    });
  },
  async generateReport(request) {
    return buildPreviewReport(request, countedWorkspace(), state);
  },
  async exportReport(request, format) {
    const report = buildPreviewReport(request, countedWorkspace(), state);
    if (format === "csv") {
      const blob = downloadCsv(`civicflow-${report.template}-${report.period.slice(0, 10)}.csv`, [
        report.headers,
        ...report.rows,
      ]);
      return {
        path: "browser-download",
        bytes: blob.size,
        format,
        title: report.title,
      };
    }
    const printWindow = window.open("", "_blank", "width=960,height=1000");
    if (!printWindow) throw new Error("Allow pop-ups to open the printable report.");
    printWindow.document.write(renderPrintableReport(report));
    printWindow.document.close();
    printWindow.focus();
    printWindow.setTimeout(() => printWindow.print(), 250);
    return { path: "print-dialog", bytes: 0, format, title: report.title };
  },
};

/* ---------------------------------------------------------------------------
 * The preview's matching rules: the same policy, checks and weights in
 * miniature. One seat at a time, best scoring eligible volunteer.
 * ------------------------------------------------------------------------- */

const PREVIEW_PRIORITY_LEVELS: PriorityLevel[] = [
  { key: "none", weight: 0 },
  { key: "low", weight: 5 },
  { key: "medium", weight: 10 },
  { key: "high", weight: 15 },
  { key: "top", weight: 35 },
];

const { readRosterPolicy, writeRosterPolicy, validateRosterPolicy } =
  createPreviewRosterPolicyStore(scoped, PREVIEW_PRIORITY_LEVELS);

function previewDayKey(startsAt: string): string {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(startsAt).getDay()];
}

function previewPeriod(startsAt: string): string {
  const hour = new Date(startsAt).getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/// Coordinator locks are a property of a live assignment. The preview keeps them
// for the session; the desktop stores them on the registration row.
const previewLocks = new Set<string>();

const RULE_KEY = "civicflow.notification-rules.v1";

const PREVIEW_RULES: NotificationRule[] = [
  {
    id: "rule-shift_reminder-volunteer",
    triggerType: "shift_reminder",
    offsetMinutes: 1440,
    audience: "volunteer",
    enabled: true,
  },
  {
    id: "rule-checkin_soon-volunteer",
    triggerType: "checkin_soon",
    offsetMinutes: 120,
    audience: "volunteer",
    enabled: true,
  },
  {
    id: "rule-missed_shift_follow_up-coordinator",
    triggerType: "missed_shift_follow_up",
    offsetMinutes: 60,
    audience: "coordinator",
    enabled: true,
  },
  {
    id: "rule-credential_expiring-coordinator",
    triggerType: "credential_expiring",
    offsetMinutes: 43200,
    audience: "coordinator",
    enabled: true,
  },
];

function previewRules(): NotificationRule[] {
  try {
    const raw = localStorage.getItem(scoped(RULE_KEY));
    if (!raw) return PREVIEW_RULES;
    const stored = JSON.parse(raw) as NotificationRule[];
    return PREVIEW_RULES.map((rule) => stored.find((row) => row.id === rule.id) ?? rule);
  } catch {
    return PREVIEW_RULES;
  }
}

function writePreviewRules(rules: NotificationRule[]): void {
  try {
    localStorage.setItem(scoped(RULE_KEY), JSON.stringify(rules));
  } catch {
    // The in-memory rules are enough when storage is refused.
  }
}

/** Every date the rule produces. The Rust engine is authoritative; this is the
// same arithmetic over the preview's clock. */
function previewOccurrences(rule: RecurrenceRule): string[] {
  const startsOn = rule.startsOn;
  if (!startsOn) throw new Error("Choose the date the series starts");
  if (rule.durationMinutes < 15 || rule.durationMinutes > 1440) {
    throw new Error("A shift has to last between 15 minutes and 24 hours");
  }
  if (rule.kind === "none") return [startsOn];
  if (rule.weekdays.length === 0) throw new Error("Choose at least one weekday to repeat on");
  if (rule.endsOn && rule.occurrenceCount) {
    throw new Error("Choose either an end date or an occurrence count, not both");
  }
  if (!rule.endsOn && !rule.occurrenceCount) {
    throw new Error("Give the series an end date or an occurrence count");
  }
  const interval = Math.min(Math.max(rule.intervalWeeks, 1), 8);
  const [year, month, day] = startsOn.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day));
  anchor.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay());
  const dates: string[] = [];
  for (let week = 0; week < 260; week += 1) {
    for (const weekday of [...rule.weekdays].sort((a, b) => a - b)) {
      const date = new Date(anchor);
      date.setUTCDate(anchor.getUTCDate() + week * 7 * interval + weekday);
      const key = date.toISOString().slice(0, 10);
      if (key < startsOn) continue;
      if (rule.endsOn && key > rule.endsOn) continue;
      if (!dates.includes(key)) dates.push(key);
    }
    dates.sort();
    if (rule.occurrenceCount && dates.length >= rule.occurrenceCount) break;
    if (rule.endsOn) {
      const limit = new Date(anchor);
      limit.setUTCDate(anchor.getUTCDate() + (week + 1) * 7 * interval);
      if (limit.toISOString().slice(0, 10) > rule.endsOn) break;
    }
  }
  const capped = rule.occurrenceCount ? dates.slice(0, rule.occurrenceCount) : dates;
  if (capped.length === 0) throw new Error("That rule produces no shifts");
  if (capped.length > 60) {
    throw new Error(
      `That rule would create ${capped.length} shifts. Shorten the series to 60 or fewer.`,
    );
  }
  return capped;
}

function previewShiftStart(date: string, startsLocalTime: string): string {
  const [hours, minutes] = startsLocalTime.split(":").map(Number);
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours + 4, minutes)).toISOString();
}

function previewRuleOf(series: ShiftSeriesRecord): RecurrenceRule {
  return {
    kind: series.kind,
    intervalWeeks: series.intervalWeeks,
    weekdays: series.weekdays,
    startsLocalTime: series.startsLocalTime,
    durationMinutes: series.durationMinutes,
    startsOn: series.startsOn,
    endsOn: series.endsOn,
    occurrenceCount: series.occurrenceCount,
  };
}

function previewLiveRegistrations(snapshot: SessionSnapshot, shiftId: string) {
  return snapshot.registrations.filter(
    (row) => row.shiftId === shiftId && row.status === "registered",
  );
}

function previewDisruptions(): DisruptionReport {
  const now = workspace.now;
  const shifts: DisruptedShift[] = [];
  const atRisk: DisruptionReport["atRisk"] = [];

  for (const shift of workspace.shifts.filter((row) => row.endsAt > now)) {
    const live = previewLiveRegistrations(state, shift.id);
    const title =
      workspace.opportunities.find((row) => row.id === shift.opportunityId)?.title ?? "Shift";
    const roles: DisruptedRole[] = shift.roles
      .map((role) => {
        const filled = live.filter((row) => row.role === role.name).length;
        return {
          role: role.name,
          required: role.required,
          filled,
          open: Math.max(0, role.required - filled),
        };
      })
      .filter((role) => role.open > 0);

    if (roles.length > 0) {
      shifts.push({
        shiftId: shift.id,
        opportunityId: shift.opportunityId,
        title,
        startsAt: shift.startsAt,
        capacity: shift.capacity,
        confirmed: live.length,
        roles,
        reasons: roles.map(
          (role) =>
            `${role.open} required ${role.open === 1 ? "seat" : "seats"} open as ${role.role}`,
        ),
      });
    }

    for (const row of live) {
      const lapsed = state.credentials.find(
        (credential) =>
          credential.volunteerId === row.volunteerId && credential.status === "expired",
      );
      if (!lapsed) continue;
      atRisk.push({
        shiftId: shift.id,
        shiftTitle: title,
        startsAt: shift.startsAt,
        volunteerId: row.volunteerId,
        volunteerName: volunteerName(row.volunteerId),
        role: row.role,
        credential: lapsed.name,
        validThrough: lapsed.validThrough,
        expired: true,
      });
    }
  }

  return {
    now,
    openRequired: shifts.reduce(
      (total, shift) => total + shift.roles.reduce((sum, role) => sum + role.open, 0),
      0,
    ),
    shifts,
    atRisk,
  };
}

function previewRecoveryPlan(shiftIds: string[], options: RosterOptions): RecoveryPlan {
  if (shiftIds.length === 0) throw new Error("Choose at least one shift to recover");
  const policy = readRosterPolicy();
  const report = previewDisruptions();
  const chosen = previewRosterPlan(shiftIds, options, policy);

  const changes: RecoveryChange[] = chosen.assignments.map((assignment) => {
    const waiting = state.waitlist.some(
      (row) =>
        row.shiftId === assignment.shiftId &&
        row.volunteerId === assignment.candidateId &&
        row.status === "waiting",
    );
    return {
      kind: waiting ? "promote" : "assign",
      shiftId: assignment.shiftId,
      shiftTitle: assignment.shiftTitle,
      startsAt: assignment.startsAt,
      role: assignment.role,
      fromRole: null,
      volunteerId: assignment.candidateId,
      volunteerName: assignment.candidateName,
      volunteerInitials: assignment.candidateInitials,
      score: assignment.score,
      cost: 0,
      reason: `${waiting ? "Promoted from the waitlist: " : ""}${assignment.reasons[0] ?? "Eligible and available"}`,
    };
  });
  const remaining: RecoverySeat[] = chosen.unfilled.map((slot) => ({
    shiftId: slot.shiftId,
    role: slot.role,
    reason: slot.reason,
  }));

  return {
    shifts: report.shifts.filter((shift) => shiftIds.includes(shift.shiftId)),
    changes,
    remaining,
    openBefore: changes.length + remaining.length,
    openAfter: remaining.length,
    movedAssignments: 0,
    policyVersion: policy.version,
  };
}

/** The demeed date a preview shift stands for, so a signal can count days. */
function previewDaysSince(stamp: string): number {
  const then = new Date(stamp).getTime();
  const now = new Date(workspace.now).getTime();
  return Math.max(0, Math.round((now - then) / 86_400_000));
}

function previewCompletedShifts(volunteerId: string): string[] {
  const now = workspace.now;
  return workspace.shifts
    .filter(
      (shift) =>
        shift.endsAt < now &&
        state.registrations.some(
          (row) =>
            row.shiftId === shift.id &&
            row.volunteerId === volunteerId &&
            row.status === "registered",
        ),
    )
    .map((shift) => shift.id);
}

/** The same transparent rules the Rust engine applies, over preview rows. */
function previewSignals(): RetentionSignal[] {
  const signals: RetentionSignal[] = [];
  for (const volunteer of workspace.volunteers) {
    if (volunteer.status !== "active") continue;
    const completed = previewCompletedShifts(volunteer.id);
    const last = [...(state.attendance ? Object.values(state.attendance).flat() : [])]
      .filter((row) => row.volunteerId === volunteer.id)
      .sort((a, b) => (a.checkedInAt ?? "").localeCompare(b.checkedInAt ?? ""))
      .at(-1);
    const idle = last?.checkedInAt ? previewDaysSince(last.checkedInAt) : Number.MAX_SAFE_INTEGER;

    if (idle >= 90 && completed.length > 0) {
      signals.push({
        volunteerId: volunteer.id,
        name: volunteer.name,
        initials: volunteer.initials,
        signal: "inactive",
        reason: `No completed shift in ${idle} days, but ${completed.length} on record`,
        history: [`${completed.length} completed shift(s)`],
        suggestedAction: "Send upcoming opportunities from their usual program",
      });
      continue;
    }

    const registered = state.registrations.filter((row) => row.volunteerId === volunteer.id);
    const lost = registered.filter((row) => row.status === "canceled").length;
    if (completed.length === 0 && registered.length >= 1 && lost >= 2) {
      signals.push({
        volunteerId: volunteer.id,
        name: volunteer.name,
        initials: volunteer.initials,
        signal: "newVolunteerAtRisk",
        reason: `${lost} registration(s) ended in a cancellation and no shift has been completed`,
        history: [`${registered.length} registration(s) in total`],
        suggestedAction:
          "Offer a shorter or better-supported first shift, or a call from the coordinator",
      });
      continue;
    }

    const recent = completed.filter((shiftId) => {
      const shift = workspace.shifts.find((row) => row.id === shiftId);
      return shift ? previewDaysSince(shift.endsAt) <= 60 : false;
    });
    if (recent.length >= 4) {
      signals.push({
        volunteerId: volunteer.id,
        name: volunteer.name,
        initials: volunteer.initials,
        signal: "highlyEngaged",
        reason: `${recent.length} completed shifts in the last 60 days`,
        history: [`${completed.length} completed shifts in total`],
        suggestedAction: "Ask them to mentor a new volunteer or lead a shift",
      });
      continue;
    }

    const lapsed = state.credentials.filter(
      (credential) => credential.volunteerId === volunteer.id && credential.status === "expired",
    );
    if (lapsed.length > 0) {
      signals.push({
        volunteerId: volunteer.id,
        name: volunteer.name,
        initials: volunteer.initials,
        signal: "credentialBlocker",
        reason: `An expired ${lapsed.map((row) => row.name).join(", ")} blocks the roles that need it`,
        history: [],
        suggestedAction: "Send the renewal steps and hold a seat for the next shift",
      });
    }
  }
  return signals;
}

function previewInsight(volunteerId: string): VolunteerInsight {
  const volunteer = workspace.volunteers.find((row) => row.id === volunteerId);
  if (!volunteer) throw new Error("That volunteer is not on file.");
  const verifiedMinutes = [...workspace.hourEntries, ...workspace.mayaEntries]
    .filter((entry) => entry.volunteerId === volunteerId && entry.status === "verified")
    .reduce((total, entry) => total + entry.minutes, 0);
  const verifiedHours = Math.floor(verifiedMinutes / 60);
  const completed = previewCompletedShifts(volunteerId).length;
  const daysOfService = previewDaysSince(volunteer.joinedAt);

  const milestones: Milestone[] = [
    ...[10, 25, 50].map((hours) => ({
      key: `hours-${hours}`,
      label: `${hours} verified hours`,
      earned: verifiedHours >= hours,
      remaining: `${Math.max(0, hours - verifiedHours)} hour(s) to go`,
    })),
    {
      key: "shifts-10",
      label: "10 completed shifts",
      earned: completed >= 10,
      remaining: `${Math.max(0, 10 - completed)} shift(s) to go`,
    },
    {
      key: "service-year-1",
      label: "One year of service",
      earned: daysOfService >= 365,
      remaining: `${Math.max(0, 365 - daysOfService)} day(s) to go`,
    },
  ];
  const next = milestones.find((milestone) => !milestone.earned);
  return {
    volunteerId,
    name: volunteer.name,
    verifiedHours,
    completedShifts: completed,
    milestones,
    next: next ? `${next.label} — ${next.remaining}` : null,
  };
}

function previewEngagement(): EngagementMetrics {
  const yearStart = workspace.now.slice(0, 4);
  const newVolunteers = workspace.volunteers.filter((volunteer) =>
    volunteer.joinedAt.startsWith(yearStart),
  ).length;
  const inactiveVolunteers = previewSignals().filter(
    (signal) => signal.signal === "inactive",
  ).length;
  const completedShifts = workspace.shifts.filter((shift) => shift.endsAt < workspace.now).length;
  const attendanceRows = Object.values(state.attendance ?? {}).flat();
  const arrivals = attendanceRows.filter((row) => row.status === "checked_in").length;
  const noShows = attendanceRows.filter((row) => row.status === "no_show").length;
  const cancellations = state.registrations.filter((row) => row.status === "canceled").length;
  const promotions = state.waitlist.filter((row) => row.status === "promoted").length;
  const share = (part: number, whole: number) =>
    whole <= 0 ? 0 : Math.round((part / whole) * 100);
  return {
    newVolunteers,
    return30: share(state.retention[0]?.returned ?? 0, state.retention[0]?.eligible ?? 1),
    return60: share(state.retention[1]?.returned ?? 0, state.retention[1]?.eligible ?? 1),
    return90: share(state.retention[2]?.returned ?? 0, state.retention[2]?.eligible ?? 1),
    inactiveVolunteers,
    completedShifts,
    noShowRate: share(noShows, arrivals + noShows),
    lateCancellationRate: share(cancellations, state.registrations.length),
    averageLeadDays: 9,
    waitlistPromotions: promotions,
    waitlistPromotionRate: share(promotions, state.waitlist.length),
  };
}

function previewReadiness(): CredentialReadiness {
  const today = workspace.now.slice(0, 10);
  const current = state.credentials.filter((row) => row.status === "current").length;
  const expiringSoon = state.credentials.filter((row) => row.status === "expiring").length;
  const expired = state.credentials.filter((row) => row.status === "expired").length;
  const atRisk = state.registrations.filter((registration) => {
    if (registration.status !== "registered") return false;
    const shift = workspace.shifts.find((row) => row.id === registration.shiftId);
    if (!shift || shift.startsAt <= workspace.now) return false;
    return state.credentials.some(
      (credential) =>
        credential.volunteerId === registration.volunteerId &&
        credential.validThrough < today &&
        credential.status === "expired",
    );
  }).length;
  return { current, expiringSoon, expired, assignmentsAtRisk: atRisk };
}

function previewReplacement(shiftId: string, role: string): ReplacementRecommendation {
  const shift = workspace.shifts.find((row) => row.id === shiftId);
  const title =
    workspace.opportunities.find((row) => row.id === shift?.opportunityId)?.title ?? "Shift";
  if (!shift) throw new Error("That shift is not on file.");

  const ranked: WaitlistCandidate[] = state.waitlist
    .filter((row) => row.shiftId === shiftId && row.status === "waiting")
    .sort((a, b) => a.position - b.position)
    .map((entry) => {
      const volunteer = workspace.volunteers.find((row) => row.id === entry.volunteerId);
      const lapsed = state.credentials.find(
        (credential) =>
          credential.volunteerId === entry.volunteerId && credential.status === "expired",
      );
      return {
        volunteerId: entry.volunteerId,
        name: volunteer?.name ?? "Volunteer",
        initials: volunteer?.initials ?? "",
        position: entry.position,
        eligible: !lapsed,
        reason: lapsed
          ? `This role needs a valid ${lapsed.name} on the shift date.`
          : "Meets every requirement for this role.",
        attendanceRate: volunteer?.attendanceRate ?? 0,
        joinedAt: entry.createdAt,
      };
    });
  const recommended = ranked.find((row) => row.eligible) ?? null;
  const skipped = ranked.filter(
    (row) => !row.eligible && row.position < (recommended?.position ?? Infinity),
  );
  const summary = recommended
    ? skipped.length === 0
      ? `${recommended.name} was first in line on the waitlist and meets every requirement for ${role}.`
      : `${recommended.name} was first eligible on the waitlist. ${skipped.length} ahead in line could not take the seat: ${skipped
          .map((row) => `${row.name} (${row.reason})`)
          .join("; ")}.`
    : ranked.length === 0
      ? `Nobody is waiting for ${role} on ${title}.`
      : `None of the ${ranked.length} waiting volunteers can take ${role} right now: ${ranked
          .map((row) => `${row.name} (${row.reason})`)
          .join("; ")}.`;

  return {
    shiftId,
    shiftTitle: title,
    role,
    startsAt: shift.startsAt,
    recommended,
    ranked,
    summary,
  };
}

/** Reminders the preview would queue, from the same triggers the engine uses. */
function previewReminders(): string[] {
  const rules = previewRules().filter((rule) => rule.enabled);
  const due: string[] = [];
  for (const rule of rules) {
    if (rule.triggerType === "credential_expiring") {
      due.push(
        ...state.credentials
          .filter((row) => row.status === "expiring")
          .map((row) => `${rule.id}:${row.id}`),
      );
      continue;
    }
    if (rule.triggerType === "shift_reminder" || rule.triggerType === "checkin_soon") {
      const horizon = new Date(
        new Date(workspace.now).getTime() + rule.offsetMinutes * 60_000 + 30 * 60_000,
      ).toISOString();
      due.push(
        ...state.registrations
          .filter((row) => {
            if (row.status !== "registered") return false;
            const shift = workspace.shifts.find((entry) => entry.id === row.shiftId);
            return Boolean(shift && shift.startsAt > workspace.now && shift.startsAt <= horizon);
          })
          .map((row) => `${rule.id}:${row.shiftId}:${row.volunteerId}`),
      );
    }
  }
  return due;
}

function createMatchingEngine() {
  return createPreviewRosterEngine({
    workspace: journeyWorkspace(),
    state,
    revision,
    readRosterPolicy,
    previewDayKey,
    previewPeriod,
  });
}
function previewRosterPlan(
  shiftIds: string[],
  options: RosterOptions,
  policy: RosterPolicy,
): RosterPlan {
  return createMatchingEngine().previewRosterPlan(shiftIds, options, policy);
}
function previewEvaluation(shiftIds: string[], options: RosterOptions): RosterEvaluation {
  return createMatchingEngine().previewEvaluation(shiftIds, options);
}
function previewExplain(
  shiftIds: string[],
  options: RosterOptions,
  candidateId: string,
  slotId: string,
): CandidateAnswer {
  return createMatchingEngine().previewExplain(shiftIds, options, candidateId, slotId);
}
