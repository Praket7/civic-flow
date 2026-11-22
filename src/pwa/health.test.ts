import { describe, expect, it } from "vitest";
import { reminderDispatchIsRecent, verifiedBackupIsRecent } from "./health";

const now = "2026-11-22T17:30:00.000Z";

describe("operational health signals", () => {
  it("rejects an uploaded backup without evidence of verification", () => {
    expect(
      verifiedBackupIsRecent(
        {
          status: "succeeded",
          finishedAt: "2026-11-22T16:30:00.000Z",
          verifiedAt: null,
          ageHours: 1,
        },
        now,
      ),
    ).toBe(false);
  });

  it("accepts a recent backup with a verified timestamp", () => {
    expect(
      verifiedBackupIsRecent(
        {
          status: "succeeded",
          finishedAt: "2026-11-22T16:30:00.000Z",
          verifiedAt: "2026-11-22T17:00:00.000Z",
          ageHours: 1,
        },
        now,
      ),
    ).toBe(true);
  });

  it("rejects stale and future-dated backups", () => {
    const base = {
      status: "succeeded",
      verifiedAt: "2026-11-21T17:00:00.000Z",
      ageHours: 50,
    };
    expect(
      verifiedBackupIsRecent({ ...base, finishedAt: "2026-11-20T15:00:00.000Z" }, now),
    ).toBe(false);
    expect(
      verifiedBackupIsRecent(
        { ...base, finishedAt: "2026-11-22T18:00:00.000Z" },
        now,
      ),
    ).toBe(false);
  });

  it("requires a recent successful reminder dispatch", () => {
    expect(
      reminderDispatchIsRecent(
        { job: "reminders", status: "succeeded", startedAt: "2026-11-22T17:15:00Z" },
        now,
      ),
    ).toBe(true);
    expect(
      reminderDispatchIsRecent(
        { job: "reminders", status: "succeeded", startedAt: "2026-10-30T21:43:54Z" },
        now,
      ),
    ).toBe(false);
    expect(
      reminderDispatchIsRecent(
        { job: "reminders", status: "failed", startedAt: "2026-11-22T17:15:00Z" },
        now,
      ),
    ).toBe(false);
    expect(
      reminderDispatchIsRecent(
        { job: "backup", status: "succeeded", startedAt: "2026-11-22T17:15:00Z" },
        now,
      ),
    ).toBe(false);
  });
});
