import { describe, expect, it } from "vitest";
import type { Candidate } from "./autoRosterModel";
import { rankAlternativesForRole } from "./autoRosterModel";

function person(id: string, eligible: boolean, score: number): Candidate {
  return {
    volunteer: { id },
    eligibleRoles: eligible ? ["Packing"] : [],
    scores: eligible ? { Packing: score } : {},
    score,
  } as Candidate;
}

describe("AutoRoster explanation alternatives", () => {
  it("ranks truly eligible alternatives before blocked applicants, without hiding the blocked", () => {
    const rows = [
      person("holder", true, 99),
      person("unqualified", false, 90),
      person("b", true, 70),
      person("a", true, 70),
    ];
    expect(
      rankAlternativesForRole(rows, "Packing", "holder", 4).map((row) => row.volunteer.id),
    ).toEqual(["a", "b", "unqualified"]);
  });

  it("applies a stable tie-breaker and bounds the number of visible alternatives", () => {
    const rows = [person("z", false, 12), person("b", false, 12), person("a", false, 12)];
    expect(rankAlternativesForRole(rows, "Packing", "", 2).map((row) => row.volunteer.id)).toEqual([
      "a",
      "b",
    ]);
  });
});
