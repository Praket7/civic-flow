import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RosterOptions } from "../../../types/domain";
import { demoWorkspace } from "../dataset";
import { previewRepository } from "../previewRepository";

/**
 * SHA-256 golden fixtures were captured by executing unmodified main and
 * refactored preview repositories side by side, comparing their complete
 * evaluations, plans, and selection explanations for fourteen shifts.
 * Stage 6 fingerprints reflect the corrected credential-validity start date.
 * Explicit negative tests in journeys.test.ts protect that constraint.
 */
const cases: { options: RosterOptions; expected: string }[] = [
  {
    options: {
      preferSpanish: false,
      blockConflicts: true,
      capWeekly: true,
      includeWaitlist: false,
    },
    expected: "c000b765fd8d62962dd252f2555a4f209b7d9b74b42a731b9c1e8e533901ef94",
  },
  {
    options: { preferSpanish: true, blockConflicts: true, capWeekly: true, includeWaitlist: true },
    expected: "ffcd3708ac3b82043a5cdfc1488674c3dfaad065bbb311276b6ed7e2bad79e57",
  },
  {
    options: {
      preferSpanish: false,
      blockConflicts: false,
      capWeekly: false,
      includeWaitlist: true,
    },
    expected: "645bfe5ce25124aac6f63dfbc8ac536bc8c4e6e372cff060245f1e24faa6f32f",
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
        expect(createHash("sha256").update(JSON.stringify({ one, onePlan })).digest("hex")).toBe(
          expected,
        );
        expect(onePlan.assignments).toHaveLength(4);
        expect(onePlan.totalScore).toBe(365);
      },
    );
  }
});
