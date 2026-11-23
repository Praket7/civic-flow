import { describe, expect, it } from "vitest";
import { buildPreviewReport } from "./reports";
import type { DemoWorkspace, ReportRequest, SessionSnapshot } from "../../../types/domain";

const workspace = {
  now: "2026-11-22T12:00:00-05:00",
  organization: { name: "Community Partners" },
  shifts: [
    {
      id: "shift-a",
      opportunityId: "opp-a",
      startsAt: "2026-11-23T09:00:00-05:00",
      status: "scheduled",
      roles: [{ name: "Distribution", required: 3, filled: 1 }],
    },
    {
      id: "shift-b",
      opportunityId: "opp-b",
      startsAt: "2026-11-24T09:00:00-05:00",
      status: "scheduled",
      roles: [{ name: "Tutoring", required: 2, filled: 2 }],
    },
  ],
  opportunities: [
    { id: "opp-a", title: "Pantry", cause: "food" },
    { id: "opp-b", title: "Tutoring", cause: "education" },
  ],
} as unknown as DemoWorkspace;

const state = {
  settings: { organizationName: "Rivergate Volunteers" },
} as SessionSnapshot;

const request: ReportRequest = {
  template: "coverage",
  fields: [],
  dateStart: "2026-11-01",
  dateEnd: "2026-11-30",
  groupBy: "none",
};

describe("pure preview reporting", () => {
  it("computes coverage and coordinator-ready summary without side effects", () => {
    const result = buildPreviewReport(request, workspace, state);
    expect(result.organization).toBe("Rivergate Volunteers");
    expect(result.title).toBe("Coverage by program");
    expect(result.headers).toContain("Gap");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual([
      "2026-11-23",
      "Pantry",
      "Distribution",
      "3",
      "1",
      "2",
      "scheduled",
    ]);
    expect(result.summary).toContainEqual({ label: "Role coverage", value: "60%" });
  });

  it("limits the report to the requested cause", () => {
    const result = buildPreviewReport({ ...request, cause: "food" }, workspace, state);
    expect(result.rows).toHaveLength(1);
    expect(result.summary).toContainEqual({ label: "Role coverage", value: "33%" });
  });

  it("respects an explicitly selected coverage end date", () => {
    const result = buildPreviewReport({ ...request, dateEnd: "2026-11-23" }, workspace, state);
    expect(result.rows).toHaveLength(1);
    expect(result.summary).toContainEqual({ label: "Required role slots", value: "3" });
  });

  it("filters impact records by date and nonprofit cause", () => {
    const data = {
      ...state,
      impactMetrics: [
        {
          opportunityId: "opp-a",
          name: "Meals",
          unit: "meals",
          value: 200,
          recordedAt: "2026-11-12T12:00:00Z",
        },
        {
          opportunityId: "opp-b",
          name: "Students",
          unit: "students",
          value: 20,
          recordedAt: "2026-11-12T12:00:00Z",
        },
        {
          opportunityId: "opp-a",
          name: "Meals",
          unit: "meals",
          value: 50,
          recordedAt: "2026-10-01T12:00:00Z",
        },
      ],
    } as unknown as SessionSnapshot;
    const result = buildPreviewReport(
      { ...request, template: "impact", cause: "food" },
      workspace,
      data,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual(["Pantry", "Meals", "meals", "200", "2026-11-12"]);
    expect(result.summary).toContainEqual({ label: "Outcome records", value: "1" });
  });

  it("includes completed shifts in an explicitly selected historical coverage period", () => {
    const historical = {
      ...workspace,
      shifts: [
        {
          ...workspace.shifts[0],
          id: "shift-history",
          startsAt: "2026-11-15T09:00:00-05:00",
          status: "completed",
        },
        ...workspace.shifts,
      ],
    } as DemoWorkspace;
    const selected = buildPreviewReport(request, historical, state);
    expect(selected.rows.map((row) => row[0])).toEqual(["2026-11-15", "2026-11-23", "2026-11-24"]);
    expect(selected.summary).toContainEqual({ label: "Required role slots", value: "8" });
    const upcoming = buildPreviewReport(
      { ...request, dateStart: undefined, dateEnd: undefined },
      historical,
      state,
    );
    expect(upcoming.rows).toHaveLength(2);
    expect(upcoming.rows.every((row) => row[0] > "2026-11-22")).toBe(true);
  });

  it("does not mutate a source workspace", () => {
    const before = JSON.stringify(workspace);
    buildPreviewReport(request, workspace, state);
    expect(JSON.stringify(workspace)).toBe(before);
  });
});

describe("Stage 4 known-answer reporting ledger", () => {
  const ledger = {
    now: "2026-11-22T12:00:00-05:00",
    organization: { name: "Community Partners" },
    currentVolunteerId: "demo-volunteer",
    volunteers: [
      { id: "alice", name: "Alice", skills: [] },
      { id: "bob", name: "Bob", skills: [] },
    ],
    opportunities: [
      { id: "pantry", title: "Food Pantry", cause: "food" },
      { id: "school", title: "Tutoring", cause: "education" },
    ],
    shifts: [
      {
        id: "earlier",
        opportunityId: "pantry",
        startsAt: "2026-10-10T09:00:00-05:00",
        status: "completed",
        roles: [{ name: "Distribution", required: 2, filled: 1 }],
      },
      {
        id: "cancelled",
        opportunityId: "pantry",
        startsAt: "2026-10-11T09:00:00-05:00",
        status: "canceled",
        roles: [{ name: "Distribution", required: 1, filled: 1 }],
      },
      {
        id: "future",
        opportunityId: "school",
        startsAt: "2026-12-02T09:00:00-05:00",
        status: "scheduled",
        roles: [{ name: "Tutor", required: 3, filled: 2 }],
      },
    ],
    hourEntries: [
      {
        id: "a-verified",
        volunteerId: "alice",
        opportunityId: "pantry",
        date: "2026-10-10",
        minutes: 90,
        status: "pending",
        verificationId: "a-verification",
      },
      {
        id: "b-pending",
        volunteerId: "bob",
        opportunityId: "pantry",
        date: "2026-10-10",
        minutes: 100,
        status: "pending",
        verificationId: null,
      },
      {
        id: "c-rejected",
        volunteerId: "bob",
        opportunityId: "pantry",
        date: "2026-10-11",
        minutes: 60,
        status: "rejected",
        verificationId: null,
      },
      {
        id: "d-verified",
        volunteerId: "bob",
        opportunityId: "school",
        date: "2026-10-12",
        minutes: 30,
        status: "verified",
        verificationId: "d-verification",
      },
      {
        id: "e-outside",
        volunteerId: "alice",
        opportunityId: "school",
        date: "2026-08-15",
        minutes: 120,
        status: "verified",
        verificationId: "e-verification",
      },
    ],
    mayaEntries: [],
  } as unknown as DemoWorkspace;
  const decisions = {
    ...state,
    hoursDecisions: {
      "a-verified": {
        status: "verified",
        approvedMinutes: 45,
        reason: "Corrected against check-out",
        reviewedAt: "2026-11-01",
      },
      "c-rejected": {
        status: "rejected",
        approvedMinutes: 600,
        reason: "Duplicate claim",
        reviewedAt: "2026-11-02",
      },
    },
    registrations: [
      { shiftId: "earlier", volunteerId: "alice", role: "Distribution", status: "completed" },
    ],
  } as unknown as SessionSnapshot;
  const q: ReportRequest = {
    template: "custom",
    fields: ["recordId", "hours", "requested", "status", "cause"],
    dateStart: "2026-10-01",
    dateEnd: "2026-10-31",
    groupBy: "none",
  };

  it("reconciles corrected, pending, rejected and outside-period records exactly", () => {
    const report = buildPreviewReport(q, ledger, decisions);
    expect(report.headers).toEqual([
      "Record ID",
      "Approved minutes",
      "Requested minutes",
      "Status",
      "Cause",
    ]);
    expect(report.rows).toEqual([
      ["d-verified", "30", "30", "verified", "education"],
      ["c-rejected", "", "60", "rejected", "food"],
      ["a-verified", "45", "90", "verified", "food"],
      ["b-pending", "", "100", "pending", "food"],
    ]);
    expect(report.summary).toContainEqual({ label: "Approved service", value: "1h 15m" });
    expect(report.summary).toContainEqual({ label: "Pending requested", value: "1h 40m" });
    expect(report.summary).toContainEqual({ label: "Rejected records", value: "1" });
    expect(report.summary).toContainEqual({ label: "Verified volunteers", value: "2" });
  });

  it("filters by exact program and cause without losing the approved-hour invariant", () => {
    const report = buildPreviewReport(
      { ...q, cause: "food", programId: "pantry" },
      ledger,
      decisions,
    );
    expect(report.rows).toHaveLength(3);
    expect(report.summary).toContainEqual({ label: "Approved service", value: "0h 45m" });
    expect(report.rows.every((row) => row[4] === "food")).toBe(true);
    expect(
      buildPreviewReport({ ...q, programId: "does-not-exist" }, ledger, decisions).rows,
    ).toEqual([]);
  });

  it("supports history and upcoming capacity and excludes canceled shifts", () => {
    const history = buildPreviewReport({ ...q, template: "coverage" }, ledger, decisions);
    expect(history.rows).toHaveLength(1);
    expect(history.summary).toContainEqual({ label: "Role coverage", value: "50%" });
    const upcoming = buildPreviewReport(
      { ...q, template: "coverage", dateStart: null, dateEnd: null },
      ledger,
      decisions,
    );
    expect(upcoming.rows).toHaveLength(1);
    expect(upcoming.summary).toContainEqual({ label: "Open slots", value: "1" });
    expect(upcoming.period).toContain("Upcoming");
  });

  it("rejects reversed, malformed and impossible date ranges", () => {
    expect(() => buildPreviewReport({ ...q, dateEnd: "2026-09-01" }, ledger, decisions)).toThrow(
      "start date",
    );
    expect(() => buildPreviewReport({ ...q, dateStart: "2026-02-30" }, ledger, decisions)).toThrow(
      "real calendar",
    );
    expect(() => buildPreviewReport({ ...q, dateStart: "yesterday" }, ledger, decisions)).toThrow(
      "YYYY-MM-DD",
    );
  });

  it("sorts by actual program values even if the group column is hidden", () => {
    const report = buildPreviewReport(
      { ...q, groupBy: "program", fields: ["recordId"] },
      ledger,
      decisions,
    );
    expect(report.rows.map((row) => row[0])).toEqual([
      "c-rejected",
      "a-verified",
      "b-pending",
      "d-verified",
    ]);
  });
});
