#!/usr/bin/env node
// Mutating acceptance test: only a separately provisioned staging fixture.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { validateStagingTarget } from "./live-hosted-auth-smoke.mjs";

function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing staging setting: " + name);
  return value;
}

function check(ok, message) {
  if (!ok) throw new Error(message);
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const url = requireValue("CIVICFLOW_SMOKE_SUPABASE_URL");
  const key = requireValue("CIVICFLOW_SMOKE_SUPABASE_ANON_KEY");
  validateStagingTarget(url, key, requireValue("CIVICFLOW_SMOKE_STAGING_PROJECT_REF"));
  check(
    requireValue("CIVICFLOW_SMOKE_WRITE_CONSENT") === "disposable-fixture-only",
    "Explicit staging mutation consent is required.",
  );
  const org = requireValue("CIVICFLOW_SMOKE_ORGANIZATION_ID");
  const shift = requireValue("CIVICFLOW_SMOKE_SHIFT_ID");
  check(uuid.test(org) && uuid.test(shift), "Invalid fixture identifiers.");
  const clients = [];
  let attempted = false;
  let actors = [];
  async function login(label, roles) {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    clients.push(client);
    const { data, error } = await client.auth.signInWithPassword({
      email: requireValue("CIVICFLOW_SMOKE_" + label + "_EMAIL"),
      password: requireValue("CIVICFLOW_SMOKE_" + label + "_PASSWORD"),
    });
    check(!error && data.user?.email_confirmed_at && data.session, label + " sign-in failed");
    const ws = await client.rpc("my_workspaces");
    check(!ws.error && ws.data?.status === "ok", label + " workspace fetch failed");
    const membership = ws.data.workspaces.find(
      (w) => w.organizationId === org && w.status === "active" && roles.includes(w.role),
    );
    check(membership, label + " has incorrect fixture membership");
    return { client, userId: data.user.id, membership, replica: randomUUID() };
  }

  async function readShift(coordinator) {
    const result = await coordinator.client
      .from("shifts")
      .select("capacity,confirmed,waitlisted,status,starts_at")
      .eq("organization_id", org)
      .eq("id", shift)
      .single();
    check(!result.error && result.data, "Fixture read failed");
    return result.data;
  }

  async function command(actor, operationId, type) {
    const result = await actor.client.rpc("apply_command", {
      p_operation_id: operationId,
      p_organization_id: org,
      p_replica_id: actor.replica,
      p_command: type,
      p_base_revision: null,
      p_entity_versions: {},
      p_payload: {
        shiftId: shift,
        membershipEpoch: actor.membership.membershipEpoch,
        allowWaitlist: true,
      },
      p_client_created_at: new Date().toISOString(),
    });
    check(!result.error && result.data, "Command response unavailable");
    return result.data;
  }

  let coordinator;
  try {
    coordinator = await login("COORD_A", ["owner", "coordinator"]);
    actors = [await login("VOL_A", ["volunteer"]), await login("VOL_A2", ["volunteer"])];
    check(
      new Set([coordinator.userId, ...actors.map((actor) => actor.userId)]).size === 3,
      "Fixture accounts must be distinct",
    );
    const before = await readShift(coordinator);
    check(
      before.capacity === 1 &&
        before.confirmed === 0 &&
        before.waitlisted === 0 &&
        before.status === "scheduled" &&
        Date.parse(before.starts_at) > Date.now(),
      "Fixture must be an empty future one-seat shift",
    );

    const operations = actors.map(() => randomUUID());
    attempted = true;
    const responses = await Promise.allSettled(
      actors.map((actor, i) => command(actor, operations[i], "REGISTER_FOR_SHIFT")),
    );
    check(responses.every((response) => response.status === "fulfilled"), "Race RPC failed");
    const results = responses.map((response) => response.value);
    check(results.every((result) => result.status === "applied"), "Race command refused");
    check(
      results.filter((result) => result.data?.waitlisted === true).length === 1,
      "Expected exactly one waitlisted volunteer",
    );
    const after = await readShift(coordinator);
    check(after.confirmed === 1 && after.waitlisted === 1, "Last-seat capacity was violated");

    for (const [i, actor] of actors.entries()) {
      const replay = await command(actor, operations[i], "REGISTER_FOR_SHIFT");
      check(replay.status === "already_applied", "Lost-response replay was not idempotent");
    }
    const afterReplay = await readShift(coordinator);
    check(
      afterReplay.confirmed === 1 && afterReplay.waitlisted === 1,
      "Replay changed authoritative capacity",
    );
    console.log("Concurrent last-seat claims and lost-response replay: PASS");
  } finally {
    try {
      if (attempted) {
        const cancellations = await Promise.allSettled(
          actors.map((actor) => command(actor, randomUUID(), "CANCEL_REGISTRATION")),
        );
        check(
          cancellations.every(
            (result) => result.status === "fulfilled" && result.value.status === "applied",
          ),
          "Fixture cleanup commands failed; inspect staging before rerun",
        );
        const clean = await readShift(coordinator);
        check(clean.confirmed === 0 && clean.waitlisted === 0, "Fixture cleanup not verified");
        console.log("Fixture returned to empty capacity: PASS");
      }
    } finally {
      await Promise.allSettled(clients.map((client) => client.auth.signOut()));
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Staging capacity test failed");
  process.exitCode = 1;
});
