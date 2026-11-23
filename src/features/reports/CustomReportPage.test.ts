import { describe, expect, it } from "vitest";
import type { HourRow } from "../../lib/workspace/selectors";
import { buildCausePoints, buildTrendPoints } from "./CustomReportPage";

function row(date: string, minutes: number): HourRow {
  return {
    id: `${date}-${minutes}`,
    date,
    approvedMinutes: minutes,
    requestedMinutes: minutes,
  } as HourRow;
}

describe("custom report trend", () => {
  it("orders the axis by ISO date and sums rows on the same day", () => {
    const points = buildTrendPoints([
      row("2026-10-10", 60),
      row("2026-10-01", 30),
      row("2026-10-10", 15),
      row("2026-10-05", 45),
    ]);

    expect(points.map((point) => point.value)).toEqual([30, 45, 75]);
  });
});

describe("custom report cause summary", () => {
  it("aggregates only the rows passed by the selected filters", () => {
    const food = { ...row("2026-10-03", 60), opportunity: { cause: "food" } } as HourRow;
    const education = { ...row("2026-10-03", 90), opportunity: { cause: "education" } } as HourRow;
    const points = buildCausePoints([
      food,
      education,
      { ...food, id: "another", approvedMinutes: 30 },
    ]);
    expect(points.find((entry) => entry.label === "Food security")?.value).toBe(90);
    expect(points.find((entry) => entry.label === "Education")?.value).toBe(90);
    expect(points).toHaveLength(2);
  });
  it("handles an empty date range without inventing report hours", () => {
    expect(buildCausePoints([])).toEqual([]);
  });
});
