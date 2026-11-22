import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCloud } from "../lib/sync/provider";
import { PwaApp } from "./PwaApp";

vi.mock("../lib/sync/provider", () => ({ useCloud: vi.fn() }));
vi.mock("./coordinator", () => ({
  CoordinatorApp: () => <h1 data-testid="coordinator-health">Workspace health</h1>,
}));

describe("shared workspace access changes", () => {
  beforeEach(() => {
    vi.stubGlobal("scrollTo", vi.fn());
  });

  it("blocks a coordinator with revoked authority before showing cached health", () => {
    vi.mocked(useCloud).mockReturnValue({
      phase: "ready",
      workspace: {
        role: "owner",
        organization: { name: "Test organization" },
      },
      conflicts: [{ id: "conflict-1", code: "stale_authority" }],
      signOut: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useCloud>);

    render(
      <MemoryRouter>
        <PwaApp />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Your access changed" })).toBeInTheDocument();
    expect(screen.queryByTestId("coordinator-health")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /dismiss and continue/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("still opens the coordinator health screen when no authority conflict exists", () => {
    vi.mocked(useCloud).mockReturnValue({
      phase: "ready",
      workspace: {
        role: "owner",
        organization: { name: "Test organization" },
      },
      conflicts: [],
      signOut: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useCloud>);

    render(
      <MemoryRouter>
        <PwaApp />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("coordinator-health")).toBeInTheDocument();
  });
});
