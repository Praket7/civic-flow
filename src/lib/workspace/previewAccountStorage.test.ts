import { describe, expect, it } from "vitest";
import {
  PREVIEW_ACCOUNT_KEY,
  PREVIEW_ACCOUNTS_KEY,
  previewPasswords,
  storedPreviewAccounts,
} from "./previewAccountStorage";

function storage(values: Record<string, string>): Pick<Storage, "getItem"> {
  return { getItem: (key: string) => values[key] ?? null };
}

describe("isolated preview account storage", () => {
  it("rejects malformed account rows and preserves a valid evaluation identity", () => {
    const records = storage({
      [PREVIEW_ACCOUNTS_KEY]: JSON.stringify([
        null,
        { id: 3, name: "Bad", email: "bad@example.org", role: "volunteer" },
        { id: "p-1", name: "A Volunteer", email: "v@example.org", role: "volunteer" },
      ]),
    });
    expect(storedPreviewAccounts(records)).toEqual([
      { id: "p-1", name: "A Volunteer", email: "v@example.org", role: "volunteer", volunteerId: null },
    ]);
  });

  it("does not treat an array or a corrupted payload as a password record", () => {
    expect(previewPasswords(storage({ [PREVIEW_ACCOUNT_KEY]: "[]" }))).toEqual({});
    expect(previewPasswords(storage({ [PREVIEW_ACCOUNT_KEY]: "{broken" }))).toEqual({});
  });

  it("ignores non-string values and pollution-sensitive keys", () => {
    const passwords = previewPasswords(
      storage({ [PREVIEW_ACCOUNT_KEY]: '{"demo":"sample","bad":5,"__proto__":"unsafe"}' }),
    );
    expect(passwords).toEqual({ demo: "sample" });
  });

  it("keeps the evaluation UI available if storage cannot be read", () => {
    const denied = { getItem: (): string => { throw new Error("blocked"); } };
    expect(storedPreviewAccounts(denied)).toEqual([]);
    expect(previewPasswords(denied)).toEqual({});
  });
});
