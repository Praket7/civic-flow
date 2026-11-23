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
} as ReportRequest;

describe("pure preview reporting", () => {
  it("computes coverage and coordinator-ready summary without side effects", () => {
    const result = buildPreviewReport(request, workspace, state);
    expect(result.organization).toBe("Rivergate Volunteers");
    expect(result.title).toBe("Coverage by program");
    expect(result.headers).toContain("Gap");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual([
      "2026-11-23", "Pantry", "Distribution", "3", "1", "2", "scheduled",
    ]);
    expect(result.summary).toContainEqual({ label: "Role coverage", value: "60%" });
  });

  it("limits the report to the requested cause", () => {
    const result = buildPreviewReport({ ...request, cause: "food" }, workspace, state);
    expect(result.rows).toHaveLength(1);
    expect(result.summary).toContainEqual({ label: "Role coverage", value: "33%" });
  });

  it("does not mutate a source workspace", () => {
    const before = JSON.stringify(workspace);
    buildPreviewReport(request, workspace, state);
    expect(JSON.stringify(workspace)).toBe(before);
  });
});
