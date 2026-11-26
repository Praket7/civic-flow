import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StartupErrorBoundary } from "./StartupErrorBoundary";

function BrokenScreen(): never {
  throw new Error("intentional render failure");
}

describe("startup recovery", () => {
  it("shows a safe recovery action instead of a blank view or resetting records", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <StartupErrorBoundary>
          <BrokenScreen />
        </StartupErrorBoundary>,
      );
      expect(screen.getByRole("alert")).toHaveTextContent("could not open");
      expect(screen.getByRole("button", { name: "Reload application" })).toBeVisible();
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
