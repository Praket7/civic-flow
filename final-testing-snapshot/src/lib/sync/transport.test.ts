import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { classifyError } from "../errors";
import type { CommandEnvelope } from "./protocol";
import { createSupabaseTransport } from "./transport";

const envelope = {
  command: "CREATE_OPPORTUNITY",
  operationId: "operation-test",
  organizationId: "org-a",
  replicaId: "replica-a",
  baseWorkspaceRevision: 1,
  entityVersions: {},
  payload: {},
  clientCreatedAt: "2026-11-23T08:00:00Z",
} as CommandEnvelope;

describe("hosted and desktop error contract parity", () => {
  it("keeps provider SQLSTATE while withholding internal SQL messages", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23505", message: "INSERT INTO private_accounts duplicate" },
    });
    const transport = createSupabaseTransport({ rpc } as unknown as SupabaseClient);
    let caught: unknown;
    try {
      await transport.push(envelope);
    } catch (error) {
      caught = error;
    }
    expect(classifyError(caught)).toMatchObject({ category: "conflict", retryable: false });
    expect(classifyError(caught).message).not.toContain("INSERT");
  });
  it("classifies access-denied pull requests correctly", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { status: 403, message: "Forbidden" } });
    const transport = createSupabaseTransport({ rpc } as unknown as SupabaseClient);
    await expect(transport.pull("other-org", 0, 20)).rejects.toMatchObject({ status: 403 });
  });
  it("preserves successful command arguments and response", async () => {
    const result = { status: "applied", workspaceRevision: 2 };
    const rpc = vi.fn().mockResolvedValue({ data: result, error: null });
    const transport = createSupabaseTransport({ rpc } as unknown as SupabaseClient);
    expect(await transport.push(envelope)).toEqual(result);
    expect(rpc).toHaveBeenCalledWith(
      "apply_command",
      expect.objectContaining({ p_operation_id: "operation-test", p_organization_id: "org-a" }),
    );
  });
});
