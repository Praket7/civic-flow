import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RosterOptions } from "../../../types/domain";
import { demoWorkspace } from "../dataset";
import { previewRepository } from "../previewRepository";

/**
 * SHA-256 golden fixtures were captured by executing unmodified main and
 * refactored preview repositories side by side, comparing their complete
 * evaluations, plans, and selection explanations for fourteen shifts.
 * Final parity fingerprints reflect the deliberate age, availability, exact skill,
 * waitlist and workload policy corrections. The full response is still pinned;
 * independent assignment invariants below guard against accepting invalid plans.
 */
const cases: { options: RosterOptions; expected: string }[] = [
  {
    options: {
      preferSpanish: false,
      blockConflicts: true,
      capWeekly: true,
      includeWaitlist: false,
    },
    expected: "d3d8f702df55b9eb74e12cafe2e7337cd38c7c481f6323dd1039372d3191800f",
  },
  {
    options: { preferSpanish: true, blockConflicts: true, capWeekly: true, includeWaitlist: true },
    expected: "c8d33144e7b9293f554b90b65ec2b9814b376740bbe71edb754315a131db2853",
  },
  {
    options: {
      preferSpanish: false,
      blockConflicts: false,
      capWeekly: false,
      includeWaitlist: true,
    },
    expected: "93364fb0f6010b51485017d0a9742325f666be6b8e6230034576ebf4314c5765",
  },
];
describe("preview AutoRoster deterministic credential-valid plan", () => {
  for (const { options, expected } of cases) {
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
        expect(createHash("sha256").update(JSON.stringify(normalized)).digest("hex")).toBe(
          expected,
        );
        expect(one.plan).toEqual(onePlan);
        const registrations = new Set<string>();
        for (const assignment of onePlan.assignments) {
          expect(assignment.explanation.eligible).toBe(true);
          expect(assignment.explanation.checks.every((check) => check.passed)).toBe(true);
          const key = JSON.stringify([assignment.shiftId, assignment.candidateId]);
          expect(registrations.has(key)).toBe(false);
          registrations.add(key);
        }
        expect(onePlan.assignments).toHaveLength(4);
        expect(onePlan.totalScore).toBe(365);
      },
    );
  }
});
