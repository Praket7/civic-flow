import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RosterOptions } from "../../../types/domain";
import { demoWorkspace } from "../dataset";
import { createDefaultSnapshot, previewRepository } from "../previewRepository";

/**
 * SHA-256 golden fixtures were captured by executing unmodified main and
 * refactored preview repositories side by side, comparing their complete
 * evaluations, plans, and selection explanations for fourteen shifts.
 * Final parity fingerprints reflect the deliberate age, availability, exact skill,
 * waitlist and workload policy corrections. Waitlist-enabled fingerprints now
 * reflect shift-level promotion and the same base-load scoring as native.
 * The full response is still pinned;
 * independent assignment invariants below guard against accepting invalid plans.
 */
const cases: { options: RosterOptions; expected: string; score: number }[] = [
  {
    options: {
      preferSpanish: false,
      blockConflicts: true,
      capWeekly: true,
      includeWaitlist: false,
    },
    score: 336,
    expected: "d3d8f702df55b9eb74e12cafe2e7337cd38c7c481f6323dd1039372d3191800f",
  },
  {
    options: { preferSpanish: true, blockConflicts: true, capWeekly: true, includeWaitlist: true },
    score: 379,
    expected: "3a36c327506f8597b4f0a1583ec0f45736e65d45f93f25cfe60450d96d9cd970",
  },
  {
    options: {
      preferSpanish: false,
      blockConflicts: false,
      capWeekly: false,
      includeWaitlist: true,
    },
    score: 379,
    expected: "9ba8b9859c31b9540da6eabc818c23844b68a41a13f64e41e6f55eef234d370a",
  },
];
describe("preview AutoRoster deterministic credential-valid plan", () => {
  for (const { options, expected, score } of cases) {
    it(
      "matches the credential-valid plan and explanations for " + JSON.stringify(options),
      async () => {
        await previewRepository.resetDemo();
        const ids = demoWorkspace.shifts
          .filter((shift) => shift.startsAt >= demoWorkspace.now)
          .slice(0, 14)
          .map((shift) => shift.id);
        const one = await previewRepository.evaluateRoster(ids, options);
        const onePlan = await previewRepository.autoRoster(ids, options);
        // Reset now advances the revision to invalidate stale plans. Verify live
        // metadata separately and normalize only that field to the original
        // fixture revision; every assignment, score and explanation stays pinned.
        expect(one.revision).toBe(onePlan.revision);
        expect(one.plan.revision).toBe(onePlan.revision);
        expect(onePlan.revision).toBeGreaterThan(1);
        const normalized = {
          one: { ...one, revision: 1, plan: { ...one.plan, revision: 1 } },
          onePlan: { ...onePlan, revision: 1 },
        };
        expect(one.plan).toEqual(onePlan);
        const registrations = new Set<string>();
        const waitlist = createDefaultSnapshot().waitlist;
        for (const assignment of onePlan.assignments) {
          expect(assignment.explanation.eligible).toBe(true);
          expect(assignment.explanation.checks.every((check) => check.passed)).toBe(true);
          const key = JSON.stringify([assignment.shiftId, assignment.candidateId]);
          expect(registrations.has(key)).toBe(false);
          registrations.add(key);
          expect(assignment.promoteWaitlist).toBe(
            waitlist.some(
              (entry) =>
                entry.shiftId === assignment.shiftId &&
                entry.volunteerId === assignment.candidateId &&
                entry.status === "waiting",
            ),
          );
        }
        expect(onePlan.assignments).toHaveLength(4);
        expect(onePlan.totalScore).toBe(score);
        expect(onePlan.totalScore).toBe(
          onePlan.assignments.reduce((total, assignment) => total + assignment.score, 0),
        );
        expect(createHash("sha256").update(JSON.stringify(normalized)).digest("hex")).toBe(
          expected,
        );
      },
    );
  }
});
