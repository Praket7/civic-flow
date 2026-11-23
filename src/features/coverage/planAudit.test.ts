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
      ] as RosterPlan["unfilled"]),¶»§q«^