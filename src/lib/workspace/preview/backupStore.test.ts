import { beforeEach, describe, expect, it } from "vitest";
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
  it("retains at most twenty snapshots", () => {
    store.writeBackups(
      Array.from({ length: 25 }, (_, index) => store.makeBackup(snapshot, "manual", String(index))),
    );
    expect(store.readBackups()).toHaveLength(20);
  });
});
