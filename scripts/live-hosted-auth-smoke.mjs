#!/usr/bin/env node
/**
 * Read-only, end-to-end Supabase authorization smoke test.
 * Run only against an isolated staging project with three real seeded accounts.
 * No privileged key, database writes, or user identities are logged.
 */
import { createClient } from "@supabase/supabase-js";

const required = (name) => {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error("Missing staging smoke-test environment variable: " + name);
  return value;
};

function ensure(condition, description) {
  if (!condition) throw new Error("Hosted authorization failed: " + description);
}

async function session(label, emailVariable, passwordVariable, projectUrl, anonKey) {
  const client = createClient(projectUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: required(emailVariable),
    password: required(passwordVariable),
  });
  ensure(!error && data?.user?.id && data?.session?.access_token, label + " cannot sign in");
  ensure(data.user.email_confirmed_at, label + " email is not verified");
  const workspaces = await client.rpc("my_workspaces");
  ensure(!workspaces.error && workspaces.data?.status === "ok", label + " workspace read");
  return { client, account: data.user, workspaces: workspaces.data.workspaces ?? [] };
}

async function pull(client, orgId) {
  const { data, error } = await client.rpc("pull_changes", {
    p_organization_id: orgId,
    p_after: 0,
    p_limit: 1,
  });
  return { data, error };
}

async function expectForbidden(client, orgId, label) {
  const result = await pull(client, orgId);
  ensure(
    result.data?.status === "forbidden" ||
      (result.error &&
        /forbidden|permission|not authorized|access denied/i.test(result.error.message)),
    label + " could access an unrelated organization",
  );
}

export async function verifyHostedAccess() {
  const url = required("CIVICFLOW_SMOKE_SUPABASE_URL");
  const key = required("CIVICFLOW_SMOKE_SUPABASE_ANON_KEY");
  ensure(
    /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url),
    "staging origin must be a managed HTTPS project",
  );
  ensure(!key.startsWith("sb_secret_"), "server secret passed as an anonymous key");

  const [coordinator, volunteer, foreign] = await Promise.all([
    session(
      "coordinator A",
      "CIVICFLOW_SMOKE_COORD_A_EMAIL",
      "CIVICFLOW_SMOKE_COORD_A_PASSWORD",
      url,
      key,
    ),
    session(
      "volunteer A",
      "CIVICFLOW_SMOKE_VOL_A_EMAIL",
      "CIVICFLOW_SMOKE_VOL_A_PASSWORD",
      url,
      key,
    ),
    session(
      "coordinator B",
      "CIVICFLOW_SMOKE_COORD_B_EMAIL",
      "CIVICFLOW_SMOKE_COORD_B_PASSWORD",
      url,
      key,
    ),
  ]);

  const coordinatorOrg = coordinator.workspaces.find(
    (w) => w.status === "active" && ["owner", "coordinator"].includes(w.role),
  );
  const volunteerOrg = volunteer.workspaces.find(
    (w) =>
      w.organizationId === coordinatorOrg?.organizationId &&
      w.role === "volunteer" &&
      w.status === "active",
  );
  const foreignOrg = foreign.workspaces.find(
    (w) => w.status === "active" && w.organizationId !== coordinatorOrg?.organizationId,
  );
  ensure(
    coordinatorOrg && volunteerOrg && foreignOrg,
    "test memberships are not properly isolated",
  );

  ensure(
    !coordinator.workspaces.some((w) => w.organizationId === foreignOrg.organizationId),
    "coordinator A enumerated organization B",
  );
  ensure(
    !foreign.workspaces.some((w) => w.organizationId === coordinatorOrg.organizationId),
    "coordinator B enumerated organization A",
  );
  for (const [label, subject, orgId] of [
    ["coordinator A", coordinator, coordinatorOrg.organizationId],
    ["volunteer A", volunteer, coordinatorOrg.organizationId],
    ["coordinator B", foreign, foreignOrg.organizationId],
  ]) {
    const result = await pull(subject.client, orgId);
    ensure(!result.error && result.data?.status === "ok", label + " cannot sync own organization");
  }

  await Promise.all([
    expectForbidden(coordinator.client, foreignOrg.organizationId, "coordinator A"),
    expectForbidden(volunteer.client, foreignOrg.organizationId, "volunteer A"),
    expectForbidden(foreign.client, coordinatorOrg.organizationId, "coordinator B"),
  ]);

  const health = await coordinator.client.rpc("health_snapshot", {
    p_organization_id: coordinatorOrg.organizationId,
  });
  ensure(!health.error && health.data?.status === "ok", "coordinator cannot see workspace health");
  const healthVolunteer = await volunteer.client.rpc("health_snapshot", {
    p_organization_id: coordinatorOrg.organizationId,
  });
  ensure(
    healthVolunteer.error || healthVolunteer.data?.status !== "ok",
    "volunteer can see staff health",
  );

  await Promise.all([
    coordinator.client.auth.signOut(),
    volunteer.client.auth.signOut(),
    foreign.client.auth.signOut(),
  ]);
  console.log(
    "Hosted staging sign-in, email verification, membership, own-org sync and cross-org denial: PASS",
  );
}

if (import.meta.url === new URL("file://" + process.argv[1]).href) {
  verifyHostedAccess().catch((error) => {
    // Errors intentionally omit account names, tokens, and backend response bodies.
    console.error(error instanceof Error ? error.message : "Hosted smoke test failed");
    process.exitCode = 1;
  });
}
