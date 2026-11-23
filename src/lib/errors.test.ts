import { describe, expect, it } from "vitest";
import { messageOf } from "./errors";

describe("user-facing error messages", () => {
  it("keeps meaningful native errors and strings", () => {
    expect(messageOf(new Error("Could not save the shift"))).toBe("Could not save the shift");
    expect(messageOf("Network interrupted")).toBe("Network interrupted");
  });
  it("shows error messages returned as plain provider objects", () => {
    expect(messageOf({ message: "Permission denied", status: 403 })).toBe("Permission denied");
    expect(messageOf({ error_description: "Session expired" })).toBe("Session expired");
  });
  it("does not render [object Object], null, or blank error bubbles", () => {
    expect(messageOf({ arbitrary: true }, "Try again")).toBe("Try again");
    expect(messageOf(null)).toBe("Something went wrong. Please try again.");
    expect(messageOf("   ")).toBe("Something went wrong. Please try again.");
  });
});
