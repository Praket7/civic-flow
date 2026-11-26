import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AreaChart, BarChart, DonutChart } from "./Charts";

describe("chart accessibility and accuracy", () => {
  it("renders zero as a zero-height bar and exposes exact data", () => {
    const { container } = render(
      <BarChart label="Coverage" data={[{ label: "Monday", value: 0 }]} />,
    );
    expect(container.querySelector('[class*="barFill"]')).toHaveStyle({ height: "0%" });
    expect(screen.getByRole("img", { name: "Coverage" })).toBeInTheDocument();
    expect(container.querySelector("tbody tr")?.textContent).toBe("Monday0%");
  });

  it("does not draw an empty donut segment", () => {
    const { container } = render(
      <DonutChart
        label="Hours"
        centerLabel="Total"
        centerValue="0"
        data={[{ label: "Food", value: 0, color: "blue" }]}
      />,
    );
    expect(container.querySelectorAll("svg circle")).toHaveLength(1);
  });

  it("gives repeated area charts independent gradient identifiers", () => {
    const data = [{ label: "Monday", value: 4 }];
    const { container } = render(
      <>
        <AreaChart label="Hours" data={data} />
        <AreaChart label="Hours" data={data} />
      </>,
    );
    const ids = Array.from(container.querySelectorAll("linearGradient"), (node) => node.id);
    expect(new Set(ids).size).toBe(2);
  });
});
