import { useEffect, useMemo, useState } from "react";
import { addDays, parseISO } from "date-fns";
import { messageOf } from "../../lib/errors";
import { getRoster, getUpcomingShiftRows } from "../../lib/workspace/selectors";
import { useWorkspace } from "../../lib/workspace/session";
import type {
  CandidateAnswer,
  RosterEvaluation,
  RosterPlan,
  RosterPolicyView,
} from "../../types/domain";
import { auditRosterPlan } from "./planAudit";
import {
  AVAILABILITY_POINTS,
  DEFAULT_OPTIONS,
  availabilityLabel,
  rankAlternativesForRole,
  type Candidate,
  type EngineOptions,
  type PlanRow,
  type ShiftPlan,
} from "./autoRosterModel";

export function useAutoRoster() {
  const { workspace, session, actions } = useWorkspace();
  const [scope, setScope] = useState<"week" | "shift">("week");
  const upcoming = useMemo(() => {
    const rows = getUpcomingShiftRows(workspace);
    return rows.filter((row) => row.shift.roles.some((role) => role.filled < role.required));
  }, [workspace]);
  const weekRows = useMemo(() => {
    if (upcoming.length === 0) return [];
    const end = addDays(parseISO(workspace.now), 7);
    const next = upcoming.filter((row) => parseISO(row.shift.startsAt) <= end);
    return next.length > 0 ? next : upcoming.slice(0, 4);
  }, [upcoming, workspace.now]);
  const [shiftId, setShiftId] = useState(
    () => weekRows[0]?.shift.id ?? upcoming[0]?.shift.id ?? "",
  );
  // A shift may stop having a gap while the page is open. Fall back to the
  // f¶»§q«^