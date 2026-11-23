import { describe, expect, it } from "vitest";
import type { RosterPlan } from "../../types/domain";
import type { Candidate } from "./autoRosterModel";
import { auditRosterPlan } from "./planAudit";

const candidate = (
  id: string,
  weeklyShifts = 0,
  availability: Candidate["availability"] = "available",
) => ({ volunteer: { id }, weeklyShifts, availability }) as Candidate;

function assignment(id: string, slotId: string, score: number, shiftId = "shift-a") {
  return {
    shiftId,
    role: "Packing",
    candidateId: id,
    score,
    explanation: {
      candidateId: id,
      shiftId,
      slotId,
      totalScore: score,
      eligible: true,
      selected: true,
      checks: [{ name: "No overlapping shift", passed: true, detail: "No conflict" }],
    },
  } as RosterPlan["assignments"][number];
}

function plan(
  assignments: RosterPlan["assignments"],
  unfilled: RosterPlan["unfilled"] = [],
): RosterPlan {
  return {
    assignments,
    unfilled,
    totalScore: assignments.reduce((sum, row) => sum + row.score, 0),
    slotsConsidered: assignments.length + unfilled.length,
  } as RosterPlan;
}

describe("AutoRoster Stage 3 independent proposal audit", () => {
  it("reports proposed coverage, unfilled reasons, relative scores and projected workloads", () => {
    const result = auditRosterPlan(
      plan([assignment("a", "seat-1", 85)], [
        { shiftId: "shift-b", role: "Food Safety", reason: "Credential missing" },
      ] as RosterPlan["unfilled"]),
      [candidate("a", 2), candidate("b", 0)],
    );
    expect(result).toMatchObject({
      openSeats: 2,
      proposed: 1,
      remaining: 1,
      fillRate: 50,
      score: 85,
      scoreAverage: 85,
      distinctPeople: 1,
      safeToApply: true,
      workload: { minimum: 0, maximum: 3, spread: 3, candidates: 2 },
      unfilledReasons: [{ reason: "Credential missing", count: 1 }],
    });
  });

  it("does not divide by zero when there are no open seats", () => {
    const result = auditRosterPlan(plan([]), []);
    expect(result.fillRate).toBeNull();
    expect(result.scoreAverage).toBeNull();
    expect(result.workload).toBeNull();
    expect(result.safeToApply).toBe(true);
  });

  it("blocks failed hard checks, even when an assignment was marked selected", () => {
    const proposed = assignment("a", "seat-1", 75);
    proposed.explanation.checks[0].passed = false;
    const result = auditRosterPlan(plan([proposed]), [candidate("a")]);
    expect(result.safeToApply).toBe(false);
    expect(result.issues.join(" ")).toMatch(/eligibility/);
  });

  it("detects duplicate seats and repeated volunteer assignments to the same shift", () => {
    const result = auditRosterPlan(
      plan([assignment("a", "seat-1", 90), assignment("a", "seat-1", 80)]),
      [candidate("a")],
    );
    expect(result.safeToApply).toBe(false);
    expect(result.issues.join(" ")).toMatch(/seat/);
    expect(result.issues.join(" ")).toMatch(/more than one role/);
  });

  it("flags provisional availability without pretending it is a failed hard rule", () => {
    const result = auditRosterPlan(plan([assignment("a", "seat-1", 70)]), [
      candidate("a", 0, "unknown"),
    ]);
    expect(result.provisionalAvailability).toBe(1);
    expect(result.safeToApply).toBe(true);
  });

  it("rejects assignments for volunteers missing from the current evaluation", () => {
    const proposed = plan([assignment("unknown", "seat-1", 75)]);
    const result = auditRosterPlan(proposed, [candidate("known")]);
    expect(result.safeToApply).toBe(false);
    expect(result.issues.join(" ")).toMatch(/inconsistent eligibility/);
  });

  it("rejects inconsistent totals and explanations rather than approving a broken plan", () => {
    const proposed = plan([assignment("a", "seat-1", 70)]);
    proposed.totalScore = 90;
    proposed.slotsConsidered = 2;
    proposed.assignments[0].explanation.candidateId = "different-person";
    const result = auditRosterPlan(proposed, [candidate("a")]);
    expect(result.safeToApply).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });
});
