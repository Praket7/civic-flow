import { invokeAuthed, repositoryToken } from "../nativeSession";
import type { ConflictRow, OutboxRow } from "./db";
import type { SyncStore } from "./engine";
import type { Change, CommandResult } from "./protocol";

/**
 * The same `SyncStore` the volunteer app implements with Dexie, backed by the
 * desktop's encrypted SQLite replica. The engine is not forked: cursor,
 * conflict and retry behavior stay identical in both shells.
 */
export class TauriSyncStore implements SyncStore {
  private readonly token = repositoryToken();
  private organizationId = "";
  private userId = "";
  async activate(userId: string, organizationId: string): Promise<void> {
    this.userId = userId;
    this.organizationId = organizationId;
  }
  private invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    return invokeAuthed<T>(command, args, this.token);
  }

  async recoverStaleSending(cutoff: number, now: number): Promise<number> {
    return this.invoke<number>("sync_recover_stale_sending", { cutoff, now, organizationId: this.organizationId, userId: this.userId });
  }

  async nextReady(userId: string, organizationId: string, now: number): Promise<OutboxRow | null> {
    return this.invoke<OutboxRow | null>("sync_next_ready", { userId, organizationId, now });
  }

  async markSending(id: number): Promise<void> {
    await this.invoke("sync_mark_sending", { id, now: Date.now() });
  }

  async markSent(id: number, result: CommandResult): Promise<void> {
    await this.invoke("sync_mark_sent", { id, result });
  }

  async markRetry(id: number, error: string, nextAttemptAt: number): Promise<void> {
    await this.invoke("sync_mark_retry", { id, error, nextAttemptAt });
  }

  async markRefused(id: number, result: CommandResult, conflict: ConflictRow): Promise<void> {
    await this.invoke("sync_mark_refused", { id, result, conflict });
  }

  async pendingCount(userId: string, organizationId: string): Promise<number> {
    return this.invoke<number>("sync_pending_count", { userId, organizationId });
  }

  async openConflictCount(organizationId: string): Promise<number> {
    return this.invoke<number>("sync_open_conflict_count", { organizationId });
  }

  async readCursor(organizationId: string): Promise<number> {
    return this.invoke<number>("sync_read_cursor", { organizationId });
  }

  async applyPull(organizationId: string, changes: Change[], cursor: number): Promise<void> {
    await this.invoke("sync_apply_changes", { organizationId, changes, cursor });
  }

  async readRevision(organizationId: string): Promise<number> {
    return this.invoke<number>("sync_read_revision", { organizationId });
  }

  async writeRevision(organizationId: string, revision: number): Promise<void> {
    await this.invoke("sync_write_revision", { organizationId, revision });
  }
}

/** The Rust status row, the same shape the replica screen renders. */
export interface ReplicaStatus {
  organizationId: string | null;
  configured: boolean;
  userId: string | null;
  mode: string;
  replicaId: string | null;
  membershipEpoch: number;
  cursor: number;
  revision: number;
  entities: number;
  pending: number;
  conflicts: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export async function configureReplica(input: {
  organizationId: string;
  userId: string;
  membershipEpoch: number;
  hostedAccessToken?: string;
  anonKey?: string;
}): Promise<ReplicaStatus> {
  return invokeAuthed<ReplicaStatus>("sync_configure", input);
}

export async function applyBootstrap(input: {
  organizationId: string;
  userId: string;
  membershipEpoch: number;
  payload: unknown;
}): Promise<ReplicaStatus> {
  return invokeAuthed<ReplicaStatus>("sync_apply_bootstrap", input);
}

export async function replicaStatus(organizationId: string): Promise<ReplicaStatus> {
  return invokeAuthed<ReplicaStatus>("sync_status", { organizationId });
}

export async function listReplicaWorkspaces(): Promise<string[]> {
  return invokeAuthed<string[]>("sync_list_workspaces");
}

export async function readReplicaEntities(
  organizationId: string,
  entity: string,
  limit = 500,
): Promise<Record<string, unknown>[]> {
  return invokeAuthed<Record<string, unknown>[]>("sync_entities", { organizationId, entity, limit });
}

/**
 * Every live report row, grouped by server entity type. Reports cannot use the
 * paged `readReplicaEntities` read: a year-to-date total that stops at the
 * newest page is wrong, not merely incomplete on screen.
 */
export async function readReplicaReportEntities(
  organizationId: string,
): Promise<Record<string, Record<string, unknown>[]>> {
  return invokeAuthed<Record<string, Record<string, unknown>[]>>("sync_report_entities", {
    organizationId,
  });
}

export function readReplicaWorkspaceEntities(organizationId: string): Promise<Record<string, Record<string, unknown>[]>> {
  return invokeAuthed("sync_workspace_entities", { organizationId });
}
