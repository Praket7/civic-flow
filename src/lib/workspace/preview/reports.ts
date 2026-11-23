/**
 * Pure reporting engine for the browser-only judging workspace.
 * It receives its complete data dependencies explicitly; it never reads
 * localStorage, writes records, or accesses production Supabase.
 */
import type {
  DemoWorkspace,
  SessionSnapshot,
  ReportDocument,
  ReportRequest,
  ReportSummaryItem,
} from "../../../types/domain";
import { getHourRows } from "../selectors";

const REPORT_TITLES: Record<string, string> = {
  participation: "Volunteer participation",
  coverage: "Coverage by program",
  attendance: "Attendance and no-shows",
  retention: "Retention and engagement",
  skills: "Credentials and skills",
  credentials: "Credentials and skills",
  impact: "Community impact",
  custom: "Custom report",
};

const REPORT_FIELD_LABELS: Record<string, string> = {
  volunteer: "Volunteer",
  program: "Program",
  date: "Service date",
  hours: "Approved minutes",
  status: "Status",
  verification: "Verification",
  cause: "Cause",
  role: "Role",
  requested: "Requested minutes",
  recordId: "Record ID",
  reviewReason: "Review reason",
};


/** Only normalized, real dates are valid. Lexical ISO comparisons are inclusive. */
function requireDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Report dates must use YYYY-MM-DD.");
  }
  const parsed = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Report date is not a real calendar day.");
  }
}

function duration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  return Math.floor(safe / 60) + "h " + String(safe % 60).padStart(2, "0") + "m";
}

/**
 * Browser judging reports and their CSV/PDF exports call this same pure model.
 * Only verified records contribute approved service time. All counts remain
 * reproducible from the returned rows and their stable record identifiers.
 */
export function buildPreviewReport(
  request: ReportRequest,
  workspace: DemoWorkspace,
  state: SessionSnapshot,
): ReportDocument {
  const end = request.dateEnd ?? workspace.now.slice(0, 10);
  const start = request.dateStart ?? end.slice(0, 4) + "-01-01";
  requireDate(start);
  requireDate(end);
  if (start > end) throw new Error("The report start date must be before its end date.");

  const template = REPORT_TITLES[request.template] ? request.template : "custom";
  const cause = request.cause ?? "";
  const programId = request.programId ?? "";
  const hasPeriod = Boolean(request.dateStart || request.dateEnd);
  const inRange = (date: string) => date >= start && date <= end;
  const opportunities = new Map(workspace.opportunities.map((row) => [row.id, row]));
  const matches = (opportunityId: string) => {
    const opportunity = opportunities.get(opportunityId);
    return Boolean(
      opportunity &&
        (!cause || opportunity.cause === cause) &&
        (!programId || opportunity.id === programId),
    );
  };
  let headers: string[];
  let rows: string[][] = [];
  let summary: ReportSummaryItem[];

  if (template === "coverage") {
    headers = ["Date", "Program", "Role", "Required", "Filled", "Gap", "Shift status"];
    let required = 0;
    let filled = 0;
    const selected = workspace.shifts
      .filter((shift) =>
        (hasPeriod ? inRange(shift.startsAt.slice(0, 10)) : shift.startsAt >= workspace.now) &&
        shift.status !== "canceled" &&
        matches(shift.opportunityId),
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
    for (const shift of selected) {
      const opportunity = opportunities.get(shift.opportunityId);
      if (!opportunity) continue;
      for (const role of shift.roles) {
        const seats = Math.max(0, role.required);
        const occupied = Math.min(seats, Math.max(0, role.filled));
        required += seats;
        filled += occupied;
        rows.push([
          shift.startsAt.slice(0, 10),
          opportunity.title,
          role.name,
          String(seats),
          String(occupied),
          String(seats - occupied),
          shift.status,
        ]);
      }
    }
    summary = [
      { label: "Required role slots", value: String(required) },
      { label: "Filled slots", value: String(filled) },
      { label: "Open slots", value: String(required - filled) },
      { label: "Role coverage", value: required ? Math.round((filled / required) * 100) + "%" : "N/A" },
      { label: "Scope", value: hasPeriod ? "Selected period, canceled shifts excluded" : "Upcoming shifts, canceled shifts excluded" },
    ];
  } else if (template === "attendance") {
    headers = ["Date", "Program", "Volunteer", "Role", "Status", "Checked in", "Checked out"];
    let arrivals = 0;
    let completed = 0;
    let noShow = 0;
    for (const [shiftId, entries] of Object.entries(state.attendance ?? {})) {
      const shift = workspace.shifts.find((item) => item.id === shiftId);
      if (!shift || !matches(shift.opportunityId) || !inRange(shift.startsAt.slice(0, 10))) continue;
      const opportunity = opportunities.get(shift.opportunityId);
      if (!opportunity) continue;
      for (const entry of entries) {
        const volunteer = workspace.volunteers.find((item) => item.id === entry.volunteerId);
        if (entry.status === "checked_in" || entry.status === "completed") arrivals += 1;
        if (entry.status === "completed") completed += 1;
        if (entry.status === "no_show") noShow += 1;
        rows.push([
          shift.startsAt.slice(0, 10),
          opportunity.title,
          volunteer?.name ?? "Unknown volunteer",
          entry.role,
          entry.status,
          entry.checkedInAt ?? "",
          entry.checkedOutAt ?? "",
        ]);
      }
    }
    rows.sort((a, b) => b[0].localeCompare(a[0]) || a[2].localeCompare(b[2]));
    summary = [
      { label: "Attendance records", value: String(rows.length) },
      { label: "Arrivals including completed", value: String(arrivals) },
      { label: "Completed", value: String(completed) },
      { label: "No-shows", value: String(noShow) },
    ];
  } else if (template === "retention") {
    headers = ["Cohort", "Eligible", "Returned in 30 days", "Rate"];
    rows = (state.retention ?? []).map((row) => [
      row.label,
      String(row.eligible),
      String(row.returned),
      row.rate + "%",
    ]);
    const eligible = (state.retention ?? []).reduce((sum, row) => sum + row.eligible, 0);
    const returned = (state.retention ?? []).reduce((sum, row) => sum + row.returned, 0);
    summary = [
      { label: "Cohort eligible", value: String(eligible) },
      { label: "Returned", value: String(returned) },
      { label: "Average 30-day return", value: (eligible ? Math.round((returned / eligible) * 100) : 0) + "%" },
      { label: "Scope", value: "All cohorts; activity filters not applicable" },
    ];
  } else if (template === "skills" || template === "credentials") {
    headers = ["Volunteer", "Skill", "Credential", "Valid through", "Status"];
    let expiring = 0;
    for (const volunteer of workspace.volunteers) {
      for (const skill of volunteer.skills) {
        const credential = (state.credentials ?? []).find((row) => row.volunteerId === volunteer.id);
        if (credential && credential.status !== "current") expiring += 1;
        rows.push([
          volunteer.name,
          skill,
          credential?.name ?? "—",
          credential?.validThrough ?? "—",
          credential?.status ?? "no credential",
        ]);
      }
    }
    summary = [
      { label: "Skill rows", value: String(rows.length) },
      { label: "Expiring or expired", value: String(expiring) },
      { label: "Scope", value: "Current credential inventory; activity filters not applicable" },
    ];
  } else if (template === "impact") {
    headers = ["Program", "Metric", "Unit", "Value", "Recorded"];
    rows = (state.impactMetrics ?? [])
      .filter((metric) => matches(metric.opportunityId) && inRange(metric.recordedAt.slice(0, 10)))
      .map((metric) => [
        opportunities.get(metric.opportunityId)?.title ?? "Unknown program",
        metric.name,
        metric.unit,
        String(metric.value),
        metric.recordedAt.slice(0, 10),
      ])
      .sort((a, b) => a[4].localeCompare(b[4]) || a[0].localeCompare(b[0]));
    summary = [{ label: "Outcome records", value: String(rows.length) }];
  } else {
    const chosen = request.fields.length
      ? request.fields.filter((field) => Object.hasOwn(REPORT_FIELD_LABELS, field))
      : ["volunteer", "program", "date", "hours", "status", "verification"];
    const fields = [...new Set(chosen)];
    if (fields.length === 0) fields.push("volunteer", "program", "date", "hours", "status");
    headers = fields.map((field) => REPORT_FIELD_LABELS[field]);
    let verifiedMinutes = 0;
    let pendingMinutes = 0;
    let rejected = 0;
    const volunteers = new Set<string>();
    const records: { key: string; date: string; id: string; values: Record<string, string> }[] = [];

    for (const row of getHourRows(state, workspace)) {
      if (!matches(row.opportunity.id) || !inRange(row.date)) continue;
      const isVerified = row.status === "verified";
      const approved = isVerified ? Math.max(0, row.approvedMinutes ?? 0) : 0;
      if (isVerified) {
        verifiedMinutes += approved;
        volunteers.add(row.volunteer.id);
      } else if (row.status === "pending") {
        pendingMinutes += Math.max(0, row.requestedMinutes);
      } else if (row.status === "rejected") rejected += 1;
      const values: Record<string, string> = {
        volunteer: row.volunteer.name,
        program: row.opportunity.title,
        date: row.date,
        hours: isVerified ? String(approved) : "",
        requested: String(row.requestedMinutes),
        status: row.status,
        verification: row.verificationId ?? "",
        cause: row.opportunity.cause,
        role: row.shiftId
          ? state.registrations?.find((reg) =>
              reg.shiftId === row.shiftId && reg.volunteerId === row.volunteer.id,
            )?.role ?? ""
          : "",
        recordId: row.id,
        reviewReason: row.reason,
      };
      records.push({
        key: request.groupBy === "cause" ? row.opportunity.cause
          : request.groupBy === "program" ? row.opportunity.title : "",
        date: row.date,
        id: row.id,
        values,
      });
    }
    records.sort((a, b) =>
      a.key.localeCompare(b.key) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
    );
    rows = records.map((record) => fields.map((field) => record.values[field] ?? ""));
    summary = [
      { label: "Records", value: String(records.length) },
      { label: "Approved service", value: duration(verifiedMinutes) },
      { label: "Pending requested", value: duration(pendingMinutes) },
      { label: "Rejected records", value: String(rejected) },
      { label: "Verified volunteers", value: String(volunteers.size) },
    ];
  }

  return {
    template,
    title: REPORT_TITLES[template],
    organization: state.settings?.organizationName || workspace.organization.name,
    period: template === "coverage" && !hasPeriod ? "Upcoming from " + workspace.now.slice(0, 10) : start + " – " + end,
    generatedAt: workspace.now,
    headers,
    rows,
    summary,
  };
}
