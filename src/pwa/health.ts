/** Operational signals that must fail closed when the server cannot prove health. */
export interface BackupSignal {
  status: string;
  finishedAt: string | null;
  verifiedAt: string | null;
  ageHours: number | null;
}

export interface JobSignal {
  job: string;
  startedAt: string;
  status: string;
}

export const REMINDER_FRESHNESS_MS = 45 * 60 * 1000;
export const BACKUP_FRESHNESS_MS = 36 * 60 * 60 * 1000;

/**
 * A completed export is not the same as a verified backup. Require the server
 * to have recorded a verification timestamp and a recent completion time.
 */
export function verifiedBackupIsRecent(
  backup: BackupSignal | null | undefined,
  serverTime: string | null | undefined,
): boolean {
  if (!backup || backup.status !== "succeeded" || !backup.verifiedAt || !backup.finishedAt) {
    return false;
  }
  const now = Date.parse(serverTime ?? "");
  const finished = Date.parse(backup.finishedAt);
  const verified = Date.parse(backup.verifiedAt);
  if (![now, finished, verified].every(Number.isFinite)) return false;
  return (
    finished <= now &&
    verified >= finished &&
    verified <= now &&
    now - finished <= BACKUP_FRESHNESS_MS
  );
}

/** If the scheduler has not succeeded recently, do not call it healthy. */
export function reminderDispatchIsRecent(
  job: JobSignal | null | undefined,
  serverTime: string | null | undefined,
): boolean {
  if (!job || job.job !== "reminders" || job.status !== "succeeded") return false;
  const now = Date.parse(serverTime ?? "");
  const started = Date.parse(job.startedAt);
  return (
    Number.isFinite(now) &&
    Number.isFinite(started) &&
    started <= now &&
    now - started <= REMINDER_FRESHNESS_MS
  );
}
