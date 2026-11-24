import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BackupSnapshot, DemoWorkspace, SessionSnapshot, Opportunity, ShiftSeriesRecord } from "../../types/domain";
import { useOptionalAuth } from "../auth/session";
import { useOrganizationWorkspace } from "../organizations/useOrganizationWorkspace";
import { demoWorkspace } from "./dataset";
import {
  DEMO_ORGANIZATION,
  workspaceWithSnapshot,
  withRegistrationCounts,
  workspaceForOrganization,
} from "./organizationWorkspace";
import { workspaceReadKeys } from "./queries";
import { getWorkspaceRepository, type WorkspaceRepository } from "./repository";
import { WorkspaceScopeProvider } from "./scope";
import { setDisplayTimeZone } from "./selectors";
import { messageOf } from "../errors";

const localRepository = getWorkspaceRepository();

// Derive action parameters from the repository contract. Snapshot mutations
// publish the new snapshot internally rather than returning it to the screen.
type ActionName =
  | "setSaved"
  | "setApplicationStage"
  | "checkIn"
  | "manualCheckIn"
  | "checkOut"
  | "markNoShow"
  | "cancelRegistration"
  | "joinWaitlist"
  | "getCheckinCode"
  | "checkinWindow"
  | "autoRoster"
  | "evaluateRoster"
  | "applyRosterWeek"
  | "getRosterPolicy"
  | "updateRosterPolicy"
  | "explainRosterChoice"
  | "applyRoster"
  | "detectDisruptions"
  | "planRecovery"
  | "applyRecovery"
  | "setAssignmentLock"
  | "listShiftSeries"
  | "retimeShiftSeries"
  | "deleteShiftSeries"
  | "recommendReplacement"
  | "listNotificationRules"
  | "updateNotificationRule"
  | "queueDueReminders"
  | "retentionSignals"
  | "volunteerInsight"
  | "engagementMetrics"
  | "credentialReadiness"
  | "saveReportView"
  | "promoteWaitlist"
  | "reviewHours"
  | "updateSettings"
  | "registerForShift"
  | "saveVolunteerProfile"
  | "resetDemo"
  | "createBackup"
  | "restoreBackup"
  | "exportEncryptedBackup"
  | "importEncryptedBackup"
  | "previewVolunteerImport"
  | "applyVolunteerImport"
  | "exportVolunteerRoster";
type WorkspaceActions = {
  [K in ActionName]: WorkspaceRepository[K] extends (...args: infer Args) => Promise<infer Result>
    ? (...args: Args) => Promise<Result extends SessionSnapshot ? void : Result>
    : never;
} & {
  createShiftSeries(...args: Parameters<WorkspaceRepository["createShiftSeries"]>): Promise<ShiftSeriesRecord>;
  generateSeriesInstances(...args: Parameters<WorkspaceRepository["generateSeriesInstances"]>): Promise<number>;
  createOpportunity(...args: Parameters<WorkspaceRepository["createOpportunity"]>): Promise<Opportunity>;
};

interface WorkspaceSessionValue {
  workspace: DemoWorkspace;
  session: SessionSnapshot;
  backups: BackupSnapshot[];
  /** Null while the capability is being read. */
  installationSteward: boolean | null;
  actions: WorkspaceActions;
}

const WorkspaceSessionContext = createContext<WorkspaceSessionValue | null>(null);

// Writes run in order so an older snapshot never lands last.
let pendingWrites: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = pendingWrites.then(operation, operation);
  pendingWrites = next.catch(() => undefined);
  return next;
}

export function WorkspaceSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const auth = useOptionalAuth();
  const account = auth?.user ?? null;
  const organizationWorkspace = useOrganizationWorkspace(account);
  // Signed out shows the sample organization; signed in without one shows an
  // empty workspace.
  const organization = account ? organizationWorkspace.current : null;
  const organizationId = organization?.id ?? "";
  const accountId = account?.id ?? "";
  // One repository, scoped by the selected organization.
  const repository = localRepository;
  const workspace = useMemo(
    () => (account ? workspaceForOrganization(organization ?? null, account) : demoWorkspace),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [organization, accountId],
  );
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [backups, setBackups] = useState<BackupSnapshot[]>([]);
  // Keyed by account so a previous session's answer cannot unlock the next one.
  const [installation, setInstallation] = useState<{
    accountId: string;
    steward: boolean;
  } | null>(null);
  const installationSteward = !account
    ? false
    : installation?.accountId === account.id
      ? installation.steward
      : null;
  const [error, setError] = useState("");

  // What setup saves is what the roster and profile screens read back.
  const visibleWorkspace = useMemo(() => {
    if (!session) return workspace;
    const counted = withRegistrationCounts(workspaceWithSnapshot(workspace, session), session);
    const profile = session.volunteerProfile;
    return {
      ...counted,
      volunteers: counted.volunteers.map((volunteer) =>
        volunteer.id === base.currentVolunteerId
          ? {
              ...volunteer,
              skills: profile.skills,
              availability: profile.availability,
              phone: profile.phone ?? volunteer.phone,
              interests: profile.interests ?? volunteer.interests,
              causes: profile.causes ?? volunteer.causes,
              photo: profile.photo ?? volunteer.photo,
            }
          : volunteer,
      ),
    };
  }, [session, workspace]);

  const apply = useCallback(
    (next: SessionSnapshot) => {
      setSession(next);
      setError("");
      // A write can change any read model built from the same rows, so each one
      // is dropped rather than left to show the roster as it was.
      for (const queryKey of workspaceReadKeys) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    [queryClient],
  );
  useEffect(() => {
    let active = true;
    // The organization cache decides which workspace this is; the repository
    // opens it. A signed-out preview still reads the bundled demo organization.
    const scope = repository.selectOrganization(
      account ? organizationId || null : DEMO_ORGANIZATION.id,
    );
    scope
      .then(() => repository.getSnapshot())
      .then((snapshot) => {
        if (active) setSession(snapshot);
      })
      .catch((caught: unknown) => {
        if (active) setError(messageOf(caught));
      });
    // Only the steward reads installation snapshots.
    (account ? repository.installationAccess() : Promise.resolve({ steward: false }))
      .then(async (access) => {
        if (!active) return;
        if (!account) {
          setBackups([]);
          return;
        }
        setInstallation({ accountId: account.id, steward: access.steward });
        if (!access.steward) {
          setBackups([]);
          return;
        }
        const snapshots = await repository.listBackups();
        if (active) setBackups(snapshots);
      })
      .catch(() => {
        if (active && account) setInstallation({ accountId: account.id, steward: false });
      });
    return () => {
      active = false;
    };
  }, [repository, organizationId, account]);

  useEffect(() => {
    if (!session) return;
    const root = document.documentElement;
    if (session.settings.textScale === "standard") root.removeAttribute("data-text-scale");
    else root.setAttribute("data-text-scale", session.settings.textScale);
    root.dataset.highContrast = String(session.settings.highContrast);
    root.dataset.reducedMotion = String(session.settings.reducedMotion);
    root.dataset.underlineLinks = String(session.settings.underlineLinks);
    root.dataset.colourIndependent = String(session.settings.colourIndependent);
  }, [session]);

  const run = useCallback(
    (operation: () => Promise<SessionSnapshot>) =>
      enqueue(async () => {
        try {
          apply(await operation());
        } catch (caught) {
          setError(messageOf(caught));
        }
      }),
    [apply],
  );

  // A caller that has to react to a rejected write — AutoRoster's stale-plan
  // check, for one — needs the error rather than only the session banner.
  const runChecked = useCallback(
    async (operation: () => Promise<SessionSnapshot>) => {
      apply(await operation());
    },
    [apply],
  );

  const actions = useMemo<WorkspaceSessionValue["actions"]>(
    () => ({
      setSaved: (opportunityId, saved) => run(() => repository.setSaved(opportunityId, saved)),
      setApplicationStage: (applicationId, stage) =>
        run(() => repository.setApplicationStage(applicationId, stage)),
      checkIn: (shiftId, volunteerId, code) =>
        enqueue(() => runChecked(() => repository.checkIn(shiftId, volunteerId, code))),
      manualCheckIn: (shiftId, volunteerId, reason) =>
        enqueue(() => runChecked(() => repository.manualCheckIn(shiftId, volunteerId, reason))),
      checkOut: (shiftId, volunteerId) =>
        enqueue(() => runChecked(() => repository.checkOut(shiftId, volunteerId))),
      markNoShow: (shiftId, volunteerId) =>
        enqueue(() => runChecked(() => repository.markNoShow(shiftId, volunteerId))),
      cancelRegistration: (shiftId, volunteerId, reason) =>
        enqueue(() =>
          runChecked(() => repository.cancelRegistration(shiftId, volunteerId, reason)),
        ),
      joinWaitlist: (shiftId, volunteerId, role, requestReview) =>
        enqueue(() =>
          runChecked(() => repository.joinWaitlist(shiftId, volunteerId, role, requestReview)),
        ),
      getCheckinCode: (shiftId) => repository.getCheckinCode(shiftId),
      checkinWindow: (shiftId) => repository.checkinWindow(shiftId),
      autoRoster: (shiftIds, options) => repository.autoRoster(shiftIds, options),
      evaluateRoster: (shiftIds, options) => repository.evaluateRoster(shiftIds, options),
      applyRosterWeek: (expectedRevision, expectedPolicyVersion, assignments) =>
        enqueue(() =>
          runChecked(() =>
            repository.applyRosterWeek(expectedRevision, expectedPolicyVersion, assignments),
          ),
        ),
      getRosterPolicy: () => repository.getRosterPolicy(),
      updateRosterPolicy: (policy) => repository.updateRosterPolicy(policy),
      explainRosterChoice: (shiftIds, options, candidateId, slotId) =>
        repository.explainRosterChoice(shiftIds, options, candidateId, slotId),
      applyRoster: (shiftId, assignments) =>
        run(() => repository.applyRoster(shiftId, assignments)),
      detectDisruptions: () => repository.detectDisruptions(),
      planRecovery: (shiftIds, options) => repository.planRecovery(shiftIds, options),
      applyRecovery: (shiftId, changes) => run(() => repository.applyRecovery(shiftId, changes)),
      setAssignmentLock: (shiftId, volunteerId, locked) =>
        run(() => repository.setAssignmentLock(shiftId, volunteerId, locked)),
      createShiftSeries: (opportunityId, rule, roles) =>
        enqueue(async () => {
          const result = await repository.createShiftSeries(opportunityId, rule, roles);
          apply(result.snapshot);
          return result.series;
        }),
      listShiftSeries: (opportunityId) => repository.listShiftSeries(opportunityId),
      generateSeriesInstances: (seriesId) =>
        enqueue(async () => {
          const result = await repository.generateSeriesInstances(seriesId);
          apply(result.snapshot);
          return result.shifts.length;
        }),
      retimeShiftSeries: (seriesId, startsLocalTime, durationMinutes, scope) =>
        run(() => repository.retimeShiftSeries(seriesId, startsLocalTime, durationMinutes, scope)),
      deleteShiftSeries: (seriesId) => run(() => repository.deleteShiftSeries(seriesId)),
      recommendReplacement: (shiftId, role) => repository.recommendReplacement(shiftId, role),
      listNotificationRules: () => repository.listNotificationRules(),
      updateNotificationRule: (ruleId, patch) => repository.updateNotificationRule(ruleId, patch),
      queueDueReminders: () => repository.queueDueReminders(),
      retentionSignals: () => repository.retentionSignals(),
      volunteerInsight: (volunteerId) => repository.volunteerInsight(volunteerId),
      engagementMetrics: () => repository.engagementMetrics(),
      credentialReadiness: () => repository.credentialReadiness(),
      saveReportView: (name, scope, filtersJson) =>
        run(() => repository.saveReportView(name, scope, filtersJson)),
      promoteWaitlist: (shiftId, volunteerId) =>
        enqueue(() => runChecked(() => repository.promoteWaitlist(shiftId, volunteerId))),
      reviewHours: (entryId, decision) =>
        enqueue(() => runChecked(() => repository.reviewHours(entryId, decision))),
      updateSettings: (patch) => run(() => repository.updateSettings(patch)),
      createOpportunity: (input) =>
        enqueue(async () => {
          const result = await repository.createOpportunity(input);
          apply(result.snapshot);
          return result.opportunity;
        }),
      registerForShift: (shiftId, volunteerId, role) =>
        enqueue(() => runChecked(() => repository.registerForShift(shiftId, volunteerId, role))),
      saveVolunteerProfile: (patch) => run(() => repository.saveVolunteerProfile(patch)),
      resetDemo: () => run(() => repository.resetDemo()),
      createBackup: (note) =>
        enqueue(async () => {
          const next = await repository.createBackup(note);
          setBackups(next);
          return next;
        }),
      restoreBackup: (id) =>
        enqueue(async () => {
          const result = await repository.restoreBackup(id);
          setBackups(result.backups);
          apply(result.snapshot);
          return result;
        }),
      exportEncryptedBackup: (passphrase) => repository.exportEncryptedBackup(passphrase),
      importEncryptedBackup: (passphrase) =>
        enqueue(async () => {
          const result = await repository.importEncryptedBackup(passphrase);
          if (!result) return null;
          setBackups(result.backups);
          apply(result.snapshot);
          return result;
        }),
      previewVolunteerImport: (text) => repository.previewVolunteerImport(text),
      applyVolunteerImport: (text) =>
        enqueue(async () => {
          const summary = await repository.applyVolunteerImport(text);
          // The refreshed snapshot carries the new roster, so the list a
          // coordinator is looking at shows the people they just added.
          apply(await repository.getSnapshot());
          return summary;
        }),
      exportVolunteerRoster: () => repository.exportVolunteerRoster(),
    }),
    [apply, repository, run, runChecked],
  );

  const value = useMemo<WorkspaceSessionValue | null>(() => {
    if (!session) return null;
    // Apply the timezone before children format their first timestamp, so a
    // settings change never leaves a stale clock in the tree.
    setDisplayTimeZone(session.settings.timezone);
    return { workspace: visibleWorkspace, session, backups, installationSteward, actions };
  }, [visibleWorkspace, session, backups, installationSteward, actions]);

  if (!value) {
    return (
      <div
        role={error ? "alert" : "status"}
        style={{ padding: 32, fontFamily: "system-ui, sans-serif", color: "var(--text-primary)" }}
      >
        {error ? `CivicFlow could not open the workspace: ${error}` : "Opening workspace…"}
      </div>
    );
  }

  return (
    <WorkspaceSessionContext.Provider value={value}>
      <WorkspaceScopeProvider value={organizationId || "no-organization"}>
        {error ? (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: "8px 16px",
              background: "var(--tone-red-soft)",
              color: "var(--tone-red-ink)",
              font: "500 12px system-ui, sans-serif",
            }}
          >
            {error}
          </p>
        ) : null}
        {children}
      </WorkspaceScopeProvider>
    </WorkspaceSessionContext.Provider>
  );
}

export function useWorkspace(): WorkspaceSessionValue {
  const value = useContext(WorkspaceSessionContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceSessionProvider");
  return value;
}
