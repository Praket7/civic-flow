import type { Table } from "dexie";
import {
  applyChanges,
  replicaId,
  replicaScope,
  volunteerDb,
  type ConflictRow,
  type OutboxRow,
  type VolunteerDatabase,
} from "./db";
import type { SyncStore } from "./engine";
import type { Change, CommandResult, CommandType } from "./protocol";
import { withMembershipEpoch } from "./protocol";

export class DexieSyncStore implements SyncStore {
  private owner: string | undefined;
  private epoch = 0;

  constructor(private readonly db: VolunteerDatabase = volunteerDb()) {}

  async activate(userId: string, _organizationId: string, membershipEpoch = 0): Promise<void> {
    this.owner = userId;
    this.epoch = membershipEpoch;
  }

  private scope(organizationId: string): string {
    return replicaScope(organizationId, this.owner, this.epoch);
  }

  private get outbox(): Table<OutboxRow, number> {
    return this.db.outbox;
  }

  async recoverStaleSending(cutoff: number, now: number): Promise<number> {
    return this.db.transaction("rw", this.outbox, async () => {
    const stale = await this.outbox
      .where("sendingAt")
      .below(cutoff)
      .filter((row) => row.state === "sending")
      .toArray();
    for (const row of stale) {
      if (row.id === undefined) continue;
      await this.outbox.update(row.id, {
        state: "pending",
        sendingAt: null,
        nextAttemptAt: now,
        lastError: "Recovered an interrupted upload. It will be retried.",
      });
    }
    return stale.length;
    });
  }

  async nextReady(userId: string, organizationId: string, now: number): Promise<OutboxRow | null> {
    // Scoped by account as well as organization: work queued by one person is
    // never uploaded by whoever signs in next, even in the same organization.
    const rows = await this.outbox
      .where("[userId+organizationId+state]")
      .anyOf([[userId, organizationId, "pending"], [userId, organizationId, "sending"]])
      .sortBy("id");
    const earliest = rows[0];
    // A backed-off command is a barrier. Skipping it would let an UPDATE reach
    // the server before the CREATE it depends on.
    if (!earliest || earliest.state !== "pending" || earliest.nextAttemptAt > now) return null;
    return earliest;
  }

  async claimReady(userId: string, organizationId: string, now: number): Promise<OutboxRow | null> {
    return this.db.transaction("rw", this.outbox, async () => {
      const row = await this.nextReady(userId, organizationId, now);
      if (!row || row.id === undefined) return null;
      await this.outbox.update(row.id, { state: "sending", sendingAt: now });
      return row;
    });
  }

  async markSending(id: number): Promise<void> {
    await this.outbox.update(id, { state: "sending", sendingAt: Date.now() });
  }

  async markSent(id: number, result: CommandResult): Promise<void> {
    await this.outbox.update(id, { state: "sent", result, lastError: null, sendingAt: null });
  }

  async markRetry(id: number, error: string, nextAttemptAt: number): Promise<void> {
    await this.db.transaction("rw", this.outbox, async () => {
    const row = await this.outbox.get(id);
    if (!row) return;
    await this.outbox.update(id, {
      state: "pending",
      attempts: row.attempts + 1,
      lastError: error,
      nextAttemptAt,
      sendingAt: null,
    });
    });
  }

  async markRefused(id: number, result: CommandResult, conflict: ConflictRow): Promise<void> {
    await this.db.transaction("rw", this.outbox, this.db.conflicts, async () => {
      await this.outbox.update(id, {
        state: "conflict",
        result,
        lastError: conflict.message,
        sendingAt: null,
      });
      await this.db.conflicts.put(conflict);
    });
  }

  async pendingCount(userId: string, organizationId: string): Promise<number> {
    return this.outbox
      .where("[userId+organizationId+state]")
      .anyOf([[userId, organizationId, "pending"], [userId, organizationId, "sending"]])
      .count();
  }

  async openConflictCount(organizationId: string): Promise<number> {
    return this.db.conflicts
      .where("organizationId")
      .equals(organizationId)
      .filter((row) => row.status === "open" && (!this.owner || row.userId === this.owner))
      .count();
  }

  async readCursor(organizationId: string): Promise<number> {
    const row = await this.db.meta.get(`cursor:${this.scope(organizationId)}`);
    return row ? Number(row.value) || 0 : 0;
  }

  async applyPull(organizationId: string, changes: Change[], cursor: number): Promise<void> {
    await applyChanges(this.scope(organizationId), changes, cursor);
  }

  async readRevision(organizationId: string): Promise<number> {
    const row = await this.db.meta.get(`revision:${this.scope(organizationId)}`);
    return row ? Number(row.value) || 0 : 0;
  }

  async writeRevision(organizationId: string, revision: number): Promise<void> {
    await this.db.meta.put({ key: `revision:${this.scope(organizationId)}`, value: String(revision) });
  }
}

export interface QueueInput {
  /** The account doing the work; the row is only ever drained for this user. */
  userId: string;
  organizationId: string;
  membershipEpoch: number;
  command: CommandType;
  payload: Record<string, unknown>;
  entityVersions?: Record<string, number>;
  baseRevision?: number;
}

/**
 * Writes the intent before anything else happens. If the browser dies between
 * this call and the upload, the intent is still here on the next launch.
 */
export async function queueCommand(input: QueueInput): Promise<OutboxRow> {
  const db = volunteerDb();
  const envelope = withMembershipEpoch(
    {
      operationId: crypto.randomUUID(),
      replicaId: await replicaId(),
      userId: input.userId,
      organizationId: input.organizationId,
      command: input.command,
      membershipEpoch: input.membershipEpoch,
      baseWorkspaceRevision: input.baseRevision ?? 0,
      entityVersions: input.entityVersions ?? {},
      payload: input.payload,
      clientCreatedAt: new Date().toISOString(),
    },
    input.membershipEpoch,
  );
  const row: OutboxRow = {
    operationId: envelope.operationId,
    organizationId: input.organizationId,
    userId: input.userId,
    command: input.command,
    envelope,
    createdAt: envelope.clientCreatedAt,
    state: "pending",
    attempts: 0,
    lastError: null,
    nextAttemptAt: 0,
    sendingAt: null,
    result: null,
  };
  const id = await db.outbox.add(row);
  return { ...row, id };
}

/** Resolve an owned conflict only if its replacement was durably queued. */
export async function retryQueuedConflict(conflictId: string, input: QueueInput): Promise<void> {
  const db = volunteerDb();
  await db.transaction("rw", db.conflicts, db.outbox, db.meta, async () => {
    const conflict = await db.conflicts.get(conflictId);
    if (!conflict || conflict.userId !== input.userId || conflict.organizationId !== input.organizationId || conflict.status !== "open") {
      throw new Error("This conflict is no longer available.");
    }
    await queueCommand({ ...input, command: conflict.command as CommandType, payload: conflict.localPayload });
    await db.conflicts.update(conflictId, { status: "resolved", resolvedAt: new Date().toISOString() });
  });
}
