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
};

export function buildPreviewReport(
  request: ReportRequest,
  workspace: DemoWorkspace,
  state: SessionSnapshot,
): ReportDocument {
  const end = request.dateEnd ?? workspace.now.slice(0, 10);
  const start = request.dateStart ?? `${end.slice(0, 4)}-01-01`;
  const template = REPORT_TITLES[request.template] ? request.template : "custom";
  const cause = request.cause ?? "";
  const inRange = (date: string) => date >= start && date <= end;
  let headers: string[];
  let rows: string[][] = [];
  let summary: ReportSummaryItem[];

  if (template === "coverage") {
    headers = ["Date", "Program", "Role", "Required", "Filled", "Gap", "Shift status"];
    let required = 0;
    let filled = 0;
    // A selected reporting period must include completed shifts. Without an
    // explicit range, coverage remains an upcoming-capacity planning view.
    const hasSelectedPeriod = Boolean(request.dateStart || request.dateEnd);
    for (const shift of workspace.shifts.filter((row) =>
      hasSelectedPeriod
        ? inRange(row.startsAt.slice(0, 10))
        : row.startsAt >= workspace.now,
    )) {
      const opportunity = workspace.opportunities.find((row) => row.id === shift.opportunityId);
      if (!opportunity || (cause && opportunity.cause !== cause)) continue;
      for (const role of shift.roles) {
        required += role.required;
        filled += role.filled;
        rows.push([
          shift.startsAt.slice(0, 10),
          opportunity.title,
          role.name,
          String(role.required),
          String(role.filled),
          String(Math.max(0, role.required - role.filled)),
          shift.status,
        ]);
      }
    }
    summary = [
      { label: "Required role slots", value: String(required) },
      { label: "Filled slots", value: String(filled) },
      {
        label: "Role coverage",
        value: `${required === 0 ? 100 : Math.round((filled / required) * 100)}%`,
      },
    ];
  } else if (template === "attendance") {
    headers = ["Date", "Program", "Volunteer", "Role", "Status", "Checked in", "Checked out"];
    let arrivals = 0;
    let completed = 0;
    let noShow = 0;
    for (const [shiftId, entries] of Object.entries(state.attendance)) {
      const shift = workspace.shifts.find((row) => row.id === shiftId);
      const opportunity = workspace.opportunities.find((row) => row.id === shift?.opportunityId);
      if (!shift || !opportunity || !inRange(shift.startsAt.slice(0, 10))) continue;
      if (cause && opportunity.cause !== cause) continue;
      for (const entry of entries) {
        const volunteer = workspace.volunteers.find((row) => row.id === entry.volunteerId);
        if (entry.status === "checked_in") arrivals += 1;
        if (entry.status === "completed") completed += 1;
        if (entry.status === "no_show") noShow += 1;
        rows.push([
          shift.startsAt.slice(0, 10),
          opportunity.title,
          volunteer?.name ?? "Volunteer",
          entry.role,
          entry.status,
          entry.checkedInAt ?? "",
          entry.checkedOutAt ?? "",
        ]);
      }
    }
    summary = [
      { label: "Arrivals", value: String(arrivals) },
      { label: "Completed", value: String(completed) },
      { label: "No-shows", value: String(noShow) },
    ];
  } else if (template === "retention") {
    headers = ["Cohort", "Eligible", "Returned in 30 days", "Rate"];
    rows = state.retention.map((row) => [
      row.label,
      String(row.eligible),
      String(row.returned),
      `${row.rate}%`,
    ]);
    const eligible = state.retention.reduce((sum, row) => sum + row.eligible, 0);
    const returned = state.retention.reduce((sum, row) => sum + row.returned, 0);
    summary = [
      { label: "Cohort eligible", value: String(eligible) },
      { label: "Returned", value: String(returned) },
      {
        label: "Average 30-day return",
        value: `${eligible === 0 ? 0 : Math.round((returned / eligible) * 100)}%`,
      },
    ];
  } else if (template === "skills" || template === "credentials") {
    headers = ["Volunteer", "Skill", "Credential", "Valid through", "Status"];
    let expiring = 0;
    for (const volunteer of workspace.volunteers) {
      for (const skill of volunteer.skills) {
        const credential = state.credentials.find((row) => row.volunteerId === volunteer.id);
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
    ];
  } else if (template === "impact") {
    headers = ["Program", "Metric", "Unit", "Value", "Recorded"];
    rows = state.impactMetrics
      .filter((metric) => {
        const opportunity = workspace.opportunities.find((row) => row.id === metric.opportunityId);
        return inRange(metric.recordedAt.slice(0, 10)) && (!cause || opportunity?.cause === cause);
      })
      .map((metric) => [
        workspace.opportunities.find((row) => row.id === metric.opportunityId)?.title ?? "Program",
        metric.name,
        metric.unit,
        String(metric.value),
        metric.recordedAt.slice(0, 10),
      ]);
    summary = [{ label: "Outcome records", value: String(rows.length) }];
  } else {
    const fields =
      request.fields.length > 0
        ? request.fields.filter((field) => field in REPORT_FIELD_LABELS)
        : ["volunteer", "program", "date", "hours", "status", "verification"];
    headers = fields.map((field) => REPORT_FIELD_LABELS[field]);
    let total = 0;
    let verified = 0;
    const volunteers = new Set<string>();
    for (const entry of [...workspace.hourEntries, ...workspace.mayaEntries]) {
      const opportunity = workspace.opportunities.find((row) => row.id === entry.opportunityId);
      const volunteer = workspace.volunteers.find((row) => row.id === entry.volunteerId);
      if (!opportunity || !volunteer || !inRange(entry.date)) continue;
      if (cause && opportunity.cause !== cause) continue;
      const decision = state.hoursDecisions[entry.id];
      const status = decision?.status ?? entry.status;
      const minutes = decision?.approvedMinutes ?? entry.minutes;
      total += minutes;
      if (status === "verified") {
        verified += minutes;
        volunteers.add(volunteer.id);
      }
      const registration = state.registrations.find(
        (row) => row.volunteerId === volunteer.id && row.status === "registered",
      );
      const values: Record<string, string> = {
        volunteer: volunteer.name,
        program: opportunity.title,
        date: entry.date,
        hours: String(minutes),
        status,
        verification: entry.verificationId ?? "",
        cause: opportunity.cause,
        role: registration?.role ?? "",
      };
      rows.push(fields.map((field) => values[field] ?? ""));
    }
    summary = [
      { label: "Records", value: String(rows.length) },
      { label: "Approved or recorded", value: `${Math.floor(total / 60)}h ${total % 60}m` },
      { label: "Verified", value: `${Math.floor(verified / 60)}h ${verified % 60}m` },
      { label: "Volunteers", value: String(volunteers.size) },
    ];
  }

  return {
    template,
    title: REPORT_TITLES[template],
    organization: state.settings.organizationName || workspace.organization.name,
    period: `${start} – ${end}`,
    generatedAt: workspace.now,
    headers,
    rows,
    summary,
  };
}
