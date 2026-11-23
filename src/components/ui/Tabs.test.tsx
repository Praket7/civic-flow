import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Tabs } from "./Tabs";

function Example() {
  const [value, setValue] = useState("a");
  return <Tabs label="View" items={[{ id: "a", label: "First" }, { id: "b", label: "Second" }, { id: "c", label: "Third" }]} value={value} onChange={setValue} />;
}

describe("tab keyboard navigation", () => {
  it("moves selection and focus with arrows and Home/End", () => {
    render(<Example />);
    const first = screen.getByRole("tab", { name: "First" });
    const second = screen.getByRole("tab", { name: "Second" });
    const third = screen.getByRole("tab", { name: "Third" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(second, { key: "End" });
    expect(third).toHaveFocus();
    fireEvent.keyDown(third, { key: "ArrowRight" });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(third).toHaveFocus();
    fireEvent.keyDown(third, { key: "Home" });
    expect(first).toHaveFocus();
  });
});
