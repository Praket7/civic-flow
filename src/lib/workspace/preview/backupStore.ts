import type { BackupSnapshot, DemoWorkspace, SessionSnapshot } from "../../../types/domain";
/** Browser-local demo backups, not encrypted or cryptographically authenticated. */
export function createPreviewBackupStore(
  scoped: (key: string) => string,
  getWorkspace: () => DemoWorkspace,
  getSnapshot: () => SessionSnapshot,
) {
  const BACKUP_KEY = "civicflow.backups.v1";
  const BACKUP_RETENTION = 20;
  interface StoredBackup {
    meta: BackupSnapshot;
    snapshot: SessionSnapshot;
  }

  function previewChecksum(value: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x1000193;
    for (let index = 0; index < value.length; index += 1) {
      h1 = Math.imul(h1 ^ value.charCodeAt(index), 0x01000193) >>> 0;
      h2 = Math.imul(h2 + value.charCodeAt(index), 0x85ebca6b) >>> 0;
    }
    const block = (seed: number) => (seed >>> 0).toString(16).padStart(8, "0");
    return (block(h1) + block(h2) + block(h1 ^ h2) + block(h1 + h2)).repeat(2);
  }

  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  function validSnapshot(value: unknown): value is SessionSnapshot {
    if (!isRecord(value)) return false;
    return (
      Array.isArray(value.savedOpportunityIds) &&
      isRecord(value.attendance) &&
      isRecord(value.hoursDecisions) &&
      Array.isArray(value.applications) &&
      Array.isArray(value.waitlist) &&
      isRecord(value.settings) &&
      Array.isArray(value.createdOpportunities) &&
      Array.isArray(value.registrations) &&
      Array.isArray(value.audit) &&
      isRecord(value.volunteerProfile) &&
      Array.isArray(value.credentials) &&
      Array.isArray(value.verifications) &&
      Array.isArray(value.impactMetrics) &&
      Array.isArray(value.savedViews) &&
      Array.isArray(value.retention)
    );
  }

  function backupCounts(snapshot: SessionSnapshot) {
    return {
      volunteers: getWorkspace().volunteers.length,
      programs: getWorkspace().opportunities.length,
      shifts: getWorkspace().shifts.length,
      hours: getWorkspace().hourEntries.length + getWorkspace().mayaEntries.length,
      notifications: getWorkspace().notifications.length,
      audit: snapshot.audit.length,
    };
  }

  function backupRows(snapshot: SessionSnapshot): number {
    const counts = backupCounts(snapshot);
    return (
      counts.volunteers +
      counts.programs +
      counts.shifts +
      counts.hours +
      counts.notifications +
      counts.audit +
      snapshot.savedOpportunityIds.length +
      snapshot.applications.length +
      snapshot.waitlist.length +
      snapshot.registrations.length +
      Object.values(snapshot.attendance).flat().length +
      Object.keys(snapshot.hoursDecisions).length
    );
  }

  function makeBackup(
    snapshot: SessionSnapshot,
    kind: BackupSnapshot["kind"],
    note: string,
  ): StoredBackup {
    const stored: StoredBackup = {
      meta: {
        id: `backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        kind,
        bytes: 0,
        rows: backupRows(snapshot),
        note,
        counts: backupCounts(snapshot),
        sha256: "",
        schemaVersion: 3,
        integrity: "ok",
      },
      snapshot: clone(snapshot),
    };
    const payload = JSON.stringify(stored.snapshot);
    stored.meta.bytes = new TextEncoder().encode(payload).length;
    stored.meta.sha256 = previewChecksum(payload);
    return stored;
  }

  function readBackups(): StoredBackup[] {
    try {
      const raw = localStorage.getItem(scoped(BACKUP_KEY));
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((entry): entry is StoredBackup => {
          if (!isRecord(entry) || !isRecord(entry.meta) || !isRecord(entry.snapshot)) return false;
          const meta = entry.meta;
          return (
            typeof meta.id === "string" &&
            typeof meta.createdAt === "string" &&
            (meta.kind === "manual" || meta.kind === "automatic") &&
            typeof meta.bytes === "number" &&
            typeof meta.rows === "number" &&
            typeof meta.note === "string" &&
            isRecord(meta.counts)
          );
        })
        .map((entry) => {
          // This lightweight browser-only checksum detects accidental edits;
          // it is not an authentication signature or encrypted backup.
          const checksum = previewChecksum(JSON.stringify(entry.snapshot));
          const intact =
            validSnapshot(entry.snapshot) &&
            (!entry.meta.sha256 || entry.meta.sha256 === checksum) &&
            entry.meta.integrity !== "failed";
          return {
            ...entry,
            meta: {
              ...entry.meta,
              sha256: entry.meta.sha256 || checksum,
              schemaVersion: entry.meta.schemaVersion || 3,
              integrity: intact ? "ok" : "failed",
            },
          };
        });
    } catch {
      return [];
    }
  }

  function writeBackups(backups: StoredBackup[]): void {
    localStorage.setItem(scoped(BACKUP_KEY), JSON.stringify(backups.slice(0, BACKUP_RETENTION)));
  }

  function ensureBackups(): StoredBackup[] {
    const stored = readBackups();
    if (stored.length > 0) {
      if (stored.length > BACKUP_RETENTION) {
        const retained = stored.slice(0, BACKUP_RETENTION);
        writeBackups(retained);
        return retained;
      }
      return stored;
    }
    const baseline = makeBackup(getSnapshot(), "automatic", "Initial workspace snapshot");
    try {
      writeBackups([baseline]);
      return [baseline];
    } catch {
      return [];
    }
  }

  function listBackupMeta(): BackupSnapshot[] {
    return ensureBackups().map((entry) => entry.meta);
  }

  return {
    clone,
    isRecord,
    validSnapshot,
    makeBackup,
    readBackups,
    writeBackups,
    ensureBackups,
    listBackupMeta,
  };
}
