import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoWorkspace } from "../dataset";
import { createDefaultSnapshot } from "../previewRepository";
import { createPreviewBackupStore } from "./backupStore";

describe("browser-only backup fixtures", () => {
  let org = "A";
  const snapshot = createDefaultSnapshot();
  const store = createPreviewBackupStore(
    (key) => org + ":" + key,
    () => demoWorkspace,
    () => snapshot,
  );
  beforeEach(() => {
    localStorage.clear();
    org = "A";
  });

  it("clones snapshots and uses a fixed-size demo checksum", () => {
    const before = JSON.stringify(snapshot);
    const backup = store.makeBackup(snapshot, "manual", "fixture");
    expect(backup.meta.sha256).toHaveLength(64);
    expect(store.validSnapshot(backup.snapshot)).toBe(true);
    backup.snapshot.savedOpportunityIds.push("new");
    expect(JSON.stringify(snapshot)).toBe(before);
    store.writeBackups([backup]);
    org = "B";
    expect(store.readBackups()).toEqual([]);
    org = "A";
    expect(store.readBackups()).toHaveLength(1);
  });
  it("refuses corrupt or partial records without a crash", () => {
    expect(store.validSnapshot({ registrations: [] })).toBe(false);
    localStorage.setItem("A:civicflow.backups.v1", '{"meta"');
    expect(store.readBackups()).toEqual([]);
    localStorage.setItem("A:civicflow.backups.v1", JSON.stringify([{ meta: {}, snapshot: {} }]));
    expect(store.readBackups()).toEqual([]);
  });
  it("flags a backup whose stored payload no longer matches its checksum", () => {
    const backup = store.makeBackup(snapshot, "manual", "before-edit");
    backup.snapshot.savedOpportunityIds.push("tampered-id");
    store.writeBackups([backup]);
    expect(store.readBackups()[0].meta.integrity).toBe("failed");
    expect(store.readBackups()[0].meta.sha256).toBe(backup.meta.sha256);
  });
  it("flags incomplete snapshots even when their checksum was recomputed", () => {
    const backup = store.makeBackup(snapshot, "manual", "before-edit");
    const partial = { ...backup.snapshot, audit: null };
    localStorage.setItem(
      "A:civicflow.backups.v1",
      JSON.stringify([{ ...backup, snapshot: partial, meta: { ...backup.meta, sha256: "" } }]),
    );
    expect(store.readBackups()[0].meta.integrity).toBe("failed");
  });
  it("does not advertise a saved backup when browser storage is unavailable", () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    try {
      expect(store.listBackupMeta()).toEqual([]);
      expect(() => store.writeBackups([store.makeBackup(snapshot, "manual", "full")])).toThrow();
    } finally {
      write.mockRestore();
    }
  });
  it("retains at most twenty snapshots", () => {
    store.writeBackups(
      Array.from({ length: 25 }, (_, index) => store.makeBackup(snapshot, "manual", String(index))),
    );
    expect(store.readBackups()).toHaveLength(20);
  });
});
