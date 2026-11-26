import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { loadPreferences } from "../../lib/sync/notifications";
import { useCloud } from "../../lib/sync/provider";
import { SettingsScreen } from "./settings";

vi.mock("../../lib/sync/provider", () => ({ useCloud: vi.fn() }));
vi.mock("../../lib/sync/notifications", () => ({
  loadPreferences: vi.fn(async () => ({
    inApp: true,
    push: false,
    email: false,
    sms: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    reminderMinutes: 1440,
  })),
  loadPushConfig: vi.fn(async () => ({
    push: { configured: false, publicKey: "" },
    channels: { email: false, sms: false },
  })),
  pushState: vi.fn(async () => "unsupported"),
  savePreferences: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}));

async function renderWithPending(pending: number, signOut: () => Promise<void>) {
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

  await act(async () => {
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    );
  });
}

describe("volunteer sign-out and offline work", () => {
  it("asks for confirmation before leaving unsynced changes on a device", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    await renderWithPending(2, signOut);

    fireEvent.click(screen.getByRole("button", { name: /^Sign out$/ }));
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByText(/2 changes waiting to sync/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
    expect(signOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^Sign out$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out with unsent changes" }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("signs out normally when there is no queued work", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    await renderWithPending(0, signOut);

    fireEvent.click(screen.getByRole("button", { name: /^Sign out$/ }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(screen.queryByText(/changes waiting to sync/i)).not.toBeInTheDocument();
  });

  it("shows a preferences loading failure instead of an endless loading state", async () => {
    vi.mocked(loadPreferences).mockRejectedValueOnce(new Error("Preferences unavailable"));
    await renderWithPending(0, vi.fn().mockResolvedValue(undefined));
    expect(screen.getByRole("alert")).toHaveTextContent("Preferences unavailable");
    expect(screen.queryByText(/Loading how this organization reaches you/)).not.toBeInTheDocument();
  });
});
