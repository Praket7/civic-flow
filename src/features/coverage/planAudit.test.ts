import { describe, expect, it } from "vitest";
import type { RosterEvaluation, RosterPlan } from "../../types/domain";
import type { ShiftPlan } from "./autoRosterModel";
import { demoWorkspace } from "../../lib/workspace/dataset";
import { previewRepository } from "../../lib/workspace/previewRepository";
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

  const shift = (id: string, startsAt: string, endsAt: string, missing = 1): ShiftPlan =>
    ({
      row: { shift: { id, startsAt, endsAt } },
      gaps: [{ name: "Packing", required: missing, filled: 0, missing }],
    }) as ShiftPlan;

  it("rejects a volunteer double-booked across overlapping shifts", () => {
    const result = auditRosterPlan(
      plan([assignment("a", "seat-1", 80, "shift-a"), assignment("a", "seat-2", 75, "shift-b")]),
      [candidate("a")],
      {
        shifts: [
          shift("shift-a", "2026-11-24T09:00:00Z", "2026-11-24T11:00:00Z"),
          shift("shift-b", "2026-11-24T10:00:00Z", "2026-11-24T12:00:00Z"),
        ],
      },
    );
    expect(result.safeToApply).toBe(false);
    expect(result.issues.join(" ")).toMatch(/overlapping assignments/);
  });

  it("allows back-to-back nonoverlapping assignments without mutating the proposal", () => {
    const proposed = plan([
      assignment("a", "seat-1", 80, "shift-a"),
      assignment("a", "seat-2", 75, "shift-b"),
    ]);
    const before = JSON.stringify(proposed);
    const result = auditRosterPlan(proposed, [candidate("a")], {
      shifts: [
        shift("shift-a", "2026-11-24T09:00:00Z", "2026-11-24T11:00:00Z"),
        shift("shift-b", "2026-11-24T11:00:00Z", "2026-11-24T12:00:00Z"),
      ],
    });
    expect(result.safeToApply).toBe(true);
    expect(JSON.stringify(proposed)).toBe(before);
  });

  it("rejects assignments beyond the actual open-role capacity", () => {
    const result = auditRosterPlan(
      plan([assignment("a", "seat-1", 80), assignment("b", "seat-2", 70)]),
      [candidate("a"), candidate("b")],
      { shifts: [shift("shift-a", "2026-11-24T09:00:00Z", "2026-11-24T11:00:00Z")] },
    );
    expect(result.safeToApply).toBe(false);
    expect(result.issues.join(" ")).toMatch(/capacity|scope/);
  });

  it("rejects unfilled seats outside the current role scope", () => {
    const result = auditRosterPlan(
      plan([], [
        { shiftId: "shift-a", role: "Driver", reason: "Unavailable" },
      ] as RosterPlan["unfilled"]),
      [candidate("a")],
      { shifts: [shift("shift-a", "2026-11-24T09:00:00Z", "2026-11-24T11:00:00Z")] },
    );
    expect(result.safeToApply).toBe(false);
    expect(result.issues.join(" ")).toMatch(/outside the current planning scope/);
  });

  it("rejects a proposal that disagrees with its independently evaluated seat", () => {
    const proposed = plan([assignment("a", "seat-1", 80)]);
    const evaluation = {
      candidates: [
        {
          candidateId: "a",
          slots: [
            {
              slotId: "seat-1",
              shiftId: "shift-a",
              role: "Packing",
              score: 80,
              eligible: false,
              selected: true,
            },
          ],
        },
      ],
    } as RosterEvaluation;
    expect(auditRosterPlan(proposed, [candidate("a")], { evaluation }).safeToApply).toBe(false);
    evaluation.candidates[0].slots[0].eligible = true;
    expect(auditRosterPlan(proposed, [candidate("a")], { evaluation }).safeToApply).toBe(true);
  });

  it("rejects a shift with invalid times", () => {
    const result = auditRosterPlan(plan([assignment("a", "seat-1", 80)]), [candidate("a")], {
      shifts: [shift("shift-a", "not-a-date", "2026-11-24T11:00:00Z")],
    });
    expect(result.issues.join(" ")).toMatch(/invalid time interval/);
    expect(result.safeToApply).toBe(false);
  });

  it("accepts real demo optimizer assignments when separate evaluation agrees", async () => {
    await previewRepository.resetDemo();
    const ids = demoWorkspace.shifts
      .filter((shift) => shift.startsAt >= demoWorkspace.now)
      .slice(0, 14)
      .map((shift) => shift.id);
    const evaluation = await previewRepository.evaluateRoster(ids, {
      preferSpanish: true,
      blockConflicts: true,
      capWeekly: true,
      includeWaitlist: true,
    });
    const candidates = evaluation.candidates.map(
      (row) =>
        ({
          volunteer: { id: row.candidateId },
          availability: row.availability,
          weeklyShifts: row.weeklyShifts,
        }) as Candidate,
    );
    expect(evaluation.plan.assignments.length).toBeGreaterThan(0);
    expect(auditRosterPlan(evaluation.plan, candidates, { evaluation }).issues).toEqual([]);
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
