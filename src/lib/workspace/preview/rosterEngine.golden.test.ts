import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RosterOptions } from "../../../types/domain";
import { demoWorkspace } from "../dataset";
import { previewRepository } from "../previewRepository";

/**
 * SHA-256 golden fixtures were captured by executing unmodified main and
 * refactored preview repositories side by side, comparing their complete
 * evaluations, plans, and selection explanations for fourteen shifts.
 */
const cases: { options: RosterOptions; expected: string }[] = [
  {
    options: {
      preferSpanish: false,
      blockConflicts: true,
      capWeekly: true,
      includeWaitlist: false,
    },
    expected: "e0adefbea26a0d039a39791ba5ad21ec415d768362afee86d292cee471c51f10",
  },
  {
    options: { preferSpanish: true, blockConflicts: true, capWeekly: true, includeWaitlist: true },
    expected: "81a3a14e975dffa24dfe775766ef1ff7aad43b556bcf79ae75596ad0599a92bd",
  },
  {
    options: {
      preferSpanish: false,
      blockConflicts: false,
      capWeekly: false,
      includeWaitlist: true,
    },
    expected: "caf745842a735a3ac900200f7acf1decbef3d2548eeb7903ea7189095b8f8557",
  },
];
describe("preview AutoRoster preserves previous behavior exactly", () => {
  for (const { options, expected } of cases) {
    it(
      "matches the original full plan and explanations for " + JSON.stringify(options),
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
