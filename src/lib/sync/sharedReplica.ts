import type { DesktopSyncState } from "./desktop";
import { readReplicaWorkspaceEntities } from "./desktopStore";
import type { SharedRow } from "./sharedRows";
import { useReplicaSource } from "./useReplicaSource";

const SOURCES = {
  opportunities: "opportunity",
  shifts: "shift",
  shiftRoles: "shift_role",
  roleRequirements: "role_requirement",
  volunteers: "volunteer",
  volunteerSkills: "volunteer_skill",
  availabilityRules: "availability_rule",
  credentialTypes: "credential_type",
  credentials: "credential",
  registrations: "registration",
  waitlists: "waitlist_entry",
  attendance: "attendance",
  hourEntries: "hour_entry",
  series: "shift_series",
  seriesRoles: "shift_series_role",
} as const;

export type SharedReplicaData = { organization: SharedRow | null } & {
  -readonly [K in keyof typeof SOURCES]: SharedRow[];
};

export function sharedReplicaFrom(
  raw: Record<string, Record<string, unknown>[]>,
): SharedReplicaData {
  const data = {
    organization: (raw.organization?.[0] as SharedRow | undefined) ?? null,
  } as SharedReplicaData;
  for (const key of Object.keys(SOURCES) as (keyof typeof SOURCES)[]) {
    data[key] = (raw[SOURCES[key]] ?? []) as SharedRow[];
  }
  return data;
}

const EMPTY = sharedReplicaFrom({});
function readAll(organizationId: string): Promise<SharedReplicaData> {
  return readReplicaWorkspaceEntities(organizationId).then(sharedReplicaFrom);
}

export interface SharedReplica {
  sync: DesktopSyncState;
  data: SharedReplicaData;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  rebuild: () => Promise<void>;
}

/**
 * Reads the coordinator screens from the SQLite replica. The screen never
 * calls Supabase directly: starting sync, pulling and applying batches stay in
 * the same runtime the volunteer app uses.
 */
export function useSharedReplica(): SharedReplica {
  return useReplicaSource(EMPTY, readAll);
}
