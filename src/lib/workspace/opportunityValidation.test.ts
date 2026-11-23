import { describe, expect, it } from "vitest";
import { validateOpportunityDraft, type OpportunityDraft } from "./opportunityValidation";

const good: OpportunityDraft = {
  title: "Community Pantry Restock",
  cause: "food",
  description: "Sort shelf-stable items and prepare the pantry for guests.",
  address: "123 Main Street, Buffalo, NY",
  capacity: "12",
  duration: "2 hours",
  requirements: "Arrival on time, Closed-toe shoes, Arrival on time",
};

describe("opportunity validation", () => {
  it("normalizes safe data and deduplicates the nonempty requirements", () => {
    const result = validateOpportunityDraft({ ...good, title: "  Pantry Restock  " });
    expect(result).toEqual({
      valid: true,
      input: {
        ...good,
        title: "Pantry Restock",
        capacity: 12,
        requirements: ["Arrival on time", "Closed-toe shoes"],
      },
    });
  });

  it.each(["", "0", "-2", "2.5", "1e2", "201", "NaN", "Infinity", "001"])(
    "rejects an invalid or impossible capacity: %s",
    (capacity) => {
      const result = validateOpportunityDraft({ ...good, capacity });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.field).toBe("capacity");
    },
  );

  it.each(["", "forever", "0 hours", "13 hours", "10 min", "NaN hours"])(
    "rejects a shift duration that is not meaningful: %s",
    (duration) => {
      const result = validateOpportunityDraft({ ...good, duration });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.field).toBe("duration");
    },
  );

  it("accepts ordinary hours and minute descriptions", () => {
    for (const duration of ["15 minutes", "90 mins", "1.5 hours", "12h"]) {
      expect(validateOpportunityDraft({ ...good, duration }).valid).toBe(true);
    }
  });

  it("rejects an uninformative name, description, location or invalid cause", () => {
    for (const draft of [
      { ...good, title: "X" },
      { ...good, description: "Short" },
      { ...good, address: " " },
      { ...good, cause: "not-a-cause" as OpportunityDraft["cause"] },
    ]) {
      expect(validateOpportunityDraft(draft).valid).toBe(false);
    }
  });

  it("rejects unreasonably long or numerous requirements", () => {
    expect(
      validateOpportunityDraft({ ...good, requirements: Array.from({ length: 13 }, (_, i) => `Skill ${i}`).join(",") }).valid,
    ).toBe(false);
    expect(validateOpportunityDraft({ ...good, requirements: "X".repeat(61) }).valid).toBe(false);
  });
});
