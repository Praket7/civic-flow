import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { CoverageDay } from "../../../types/domain";
import { WeekCoverageCard } from "./WeekCoverageCard";

const days: CoverageDay[] = [
  { key: "mon", label: "Mon 12", capacity: 10, confirmed: 9, percent: 90 },
  { key: "tue", label: "Tue 13", capacity: 10, confirmed: 6, percent: 60 },
  { key: "wed", label: "Wed 14", capacity: 0, confirmed: 0, percent: 0 },
];

describe("weekly staffing coverage", () => {
  it("summarizes real seats instead of averaging displayed daily percentages", () => {
    render(
      <MemoryRouter>
        <WeekCoverageCard days={days} />
      </MemoryRouter>,
    );
    const summary = screen.getByRole("group", { name: "Weekly staffing summary" });
    expect(within(summary).getByText("75%")).toBeInTheDocument();
    expect(within(summary).getByText("5")).toBeInTheDocument();
    expect(within(summary).getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open the week/ })).toHaveAttribute(
      "href",
      "/coordinator/schedule",
    );
    const table = screen.getByRole("table", { name: "Seat fill by day this week" });
    expect(within(table).getByRole("rowheader", { name: "Tue 13" })).toBeInTheDocument();
  });

  it("does not claim 100% coverage when no shifts have seats", () => {
    render(
      <MemoryRouter>
        <WeekCoverageCard days={days.slice(2)} />
      </MemoryRouter>,
    );
    const summary = screen.getByRole("group", { name: "Weekly staffing summary" });
    expect(within(summary).getByText("—")).toBeInTheDocument();
    expect(within(summary).getAllByText("0")).toHaveLength(2);
  });
});
