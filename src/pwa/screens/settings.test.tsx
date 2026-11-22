import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { useCloud } from "../../lib/sync/provider";
import { SettingsScreen } from "./settings";

vi.mock("../../lib/sync/provider", () => ({ useCloud: vi.fn() }));
vi.mock("../../lib/sync/notifications", () => ({
  loadPreferences: vi.fn(async () => ({ push: false })),
  loadPushConfig: vi.fn(async () => ({ push: { configured: false, publicKey: "" } })),
  pushState: vi.fn(async () => "unsupported"),
  savePreferences: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}));

function renderWithPending(pending: number, signOut: () => Promise<void>) {
  vi.mocked(useCloud).mockReturnValue({
    workspace: { organizationId: "org-test", organization: { name: "Test organization" } },
    workspaces: [],
    view: { email: "volunteer@example.org" },
    status: {
      organizationId: "org-test",
      running: false,
      online: false,
      pending,
      conflicts: 0,
      lastSyncedAt: null,
      lastError: null,
      revision: 0,
    },
    conflicts: [],
    signOut,
    selectWorkspace: vi.fn(),
    syncNow: vi.fn(),
    dismissConflict: vi.fn(),
    retryConflict: vi.fn(),
  } as unknown as ReturnType<typeof useCloud>);

  render(
    <MemoryRouter>
      <SettingsScreen />
    </MemoryRouter>,
  );
}

describe("volunteer sign-out and offline work", () => {
  it("asks for confirmation before leaving unsynced changes on a device", () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    renderWithPending(2, signOut);

    fireEvent.click(screen.getByRole("button", { name: "Sign out", exact: true }));
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByText(/2 changes waiting to sync/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
    expect(signOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sign out", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out with unsent changes" }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("signs out normally when there is no queued work", () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    renderWithPending(0, signOut);

    fireEvent.click(screen.getByRole("button", { name: "Sign out", exact: true }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(screen.queryByText(/changes waiting to sync/i)).not.toBeInTheDocument();
  });
});
