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
    expect(selected.rows.map((row) => row[0])).toEqual([
      "2026-11-15",
      "2026-11-23",
      "2026-11-24",
    ]);
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
