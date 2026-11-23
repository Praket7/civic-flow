import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signUpWithPassword } from "../lib/sync/auth";
import { useCloud } from "../lib/sync/provider";
import { PwaApp } from "./PwaApp";

vi.mock("../lib/sync/provider", () => ({ useCloud: vi.fn() }));
vi.mock("../lib/sync/auth", () => ({ signUpWithPassword: vi.fn() }));
vi.mock("./coordinator", () => ({
  CoordinatorApp: () => <h1 data-testid="coordinator-health">Workspace health</h1>,
}));

describe("hosted welcome and account entry", () => {
  beforeEach(() => {
    vi.stubGlobal("scrollTo", vi.fn());
    vi.mocked(useCloud).mockReturnValue({
      phase: "signed-out",
      signIn: vi.fn(),
    } as unknown as ReturnType<typeof useCloud>);
  });

  it("shows welcome and a path to sign in or create an account to new visitors", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PwaApp />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Service, organized." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create an account/i })).toHaveAttribute(
      "href",
      "/create-account",
    );
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/sign-in");
    expect(screen.getByRole("link", { name: /explore.*demo/i })).toHaveAttribute(
      "href",
      "/judge/demo/#/welcome",
    );
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("opens a create-account form without requiring an existing login", async () => {
    vi.mocked(signUpWithPassword).mockResolvedValue({ needsVerification: true });
    render(
      <MemoryRouter initialEntries={["/create-account"]}>
        <PwaApp />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Sam Volunteer" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.org" } });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "sampleStrongPass1!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "sampleStrongPass1!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() =>
      expect(signUpWithPassword).toHaveBeenCalledWith(
        "Sam Volunteer",
        "sam@example.org",
        "sampleStrongPass1!",
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/check your email/i);
  });

  it("lets an unauthenticated visitor open the sign-in page from a deep link", () => {
    render(
      <MemoryRouter initialEntries={["/sign-in"]}>
        <PwaApp />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Your next shift is waiting." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create an account/i })).toHaveAttribute(
      "href",
      "/create-account",
    );
  });
});

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
