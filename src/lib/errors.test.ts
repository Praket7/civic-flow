import { describe, expect, it } from "vitest";
import { classifyError, messageOf } from "./errors";

describe("cross-platform recovery errors", () => {
  it("preserves meaningful validation messages and field hints", () => {
    expect(
      classifyError({
        code: "VALIDATION",
        message: "The end time must be later than the start time.",
        field: "endsAt",
        action: "Choose a later time.",
      }),
    ).toMatchObject({
      category: "validation",
      message: "The end time must be later than the start time.",
      field: "endsAt",
      action: "Choose a later time.",
      retryable: false,
    });
  });

  it("understands revision conflicts returned from the native bridge", () => {
    const error = classifyError({ code: "STALE_REVISION", message: "Plan is out of date." });
    expect(error.category).toBe("conflict");
    expect(error.action).toContain("Refresh");
    expect(error.retryable).toBe(true);
  });

  it("provides clear recovery from network failure", () => {
    const error = classifyError(new TypeError("Failed to fetch"));
    expect(error.category).toBe("offline");
    expect(error.message).toContain("connection");
    expect(error.action).toContain("Check");
  });

  it("does not show raw SQL, file paths or stack traces from storage errors", () => {
    const raw = { code: "DATABASE", message: "SQLITE_BUSY /private/account.sqlite SELECT *" };
    expect(messageOf(raw)).not.toContain("SQLITE_BUSY");
    expect(classifyError(raw).category).toBe("storage");
  });

  it("offers useful action for expired sessions and forbidden operations", () => {
    expect(classifyError({ code: "401" }).action).toContain("Sign in");
    expect(classifyError({ code: "42501" }).category).toBe("permission");
  });

  it("keeps string/JS errors readable without leaking object stringification", () => {
    expect(messageOf(new Error("Enter a value."))).toBe("Enter a value.");
    expect(messageOf("Invalid shift.")).toBe("Invalid shift.");
    expect(messageOf({ unexpected: "data" }, "Please try again.")).toBe("Please try again.");
  });
});
