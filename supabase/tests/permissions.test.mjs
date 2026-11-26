import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  asAnon,
  asOwner,
  asUser,
  createDatabase,
  ids,
  query,
  seed,
  sendCommand,
} from "./harness.mjs";

let db;

before(async () => {
  db = await createDatabase();
  await seed(db);
});

after(async () => {
  await db?.close();
});

async function permission(role, signature) {
  const sql = "select has_function_privilege($1::name, $2::text, 'EXECUTE') as allowed";
  const rows = await query(db, sql, [role, signature]);
  return rows[0].allowed;
}

test("client functions are explicitly allowlisted", async () => {
  const allowed = [
    "public.apply_command(uuid,uuid,uuid,text,bigint,jsonb,jsonb,timestamptz)",
    "public.pull_changes(uuid,bigint,integer)",
    "public.bootstrap_workspace(uuid)",
    "private.is_member(uuid)",
    "sync.change_row(text,uuid,text,integer,bigint)",
  ];

  for (const signature of allowed) {
    assert.equal(await permission("authenticated", signature), true, signature);
  }
});

test("untrusted callers cannot invoke privileged internal commands", async () => {
  const internal = [
    "sync.cmd_create_opportunity(uuid,uuid,text,jsonb,jsonb,bigint)",
    "sync.cmd_apply_roster_plan(uuid,uuid,text,jsonb,jsonb,bigint)",
    "sync.dispatch(uuid,uuid,text,text,jsonb,jsonb,bigint)",
    "private.seed_notification_rules(uuid)",
    "private.member_role(uuid)",
  ];
  for (const signature of internal) {
    assert.equal(await permission("authenticated", signature), false, signature);
    assert.equal(await permission("anon", signature), false, signature);
  }

  // Forging a coordinator role cannot bypass the public command entry point.
  const sql = `select sync.cmd_create_opportunity(
    $1::uuid, $2::uuid, 'owner', $3::jsonb, '{}'::jsonb, 0::bigint
  )`;
  const payload = { title: "Privilege bypass", slug: "privilege-bypass" };
  const params = [ids.orgA, ids.volunteerUserA, JSON.stringify(payload)];

  await assert.rejects(
    asUser(db, ids.volunteerUserA, () => query(db, sql, params)),
    /permission denied/i,
  );

  const countSQL =
    "select count(*)::int as n from public.opportunities where slug = 'privilege-bypass'";
  const [record] = await query(db, countSQL);
  assert.equal(record.n, 0);
});

test("service-only RPCs cannot be executed by untrusted roles", async () => {
  const serviceOnly = [
    "public.read_vapid_keys()",
    "public.save_vapid_keys(text,text)",
    "public.dispatch_reminders(integer)",
    "public.complete_delivery(uuid,text,text,text)",
    "public.record_server_job(text,text,text)",
  ];
  for (const signature of serviceOnly) {
    assert.equal(await permission("anon", signature), false, signature);
    assert.equal(await permission("authenticated", signature), false, signature);
    assert.equal(await permission("service_role", signature), true, signature);
  }
  assert.equal(await permission("anon", "public.vapid_public_key()"), true);
});

test("raw change log is visible only within active organizations", async () => {
  const sql = "select count(*)::int as n from sync.sync_changes where organization_id = $1";
  const [otherOrganization] = await asOwner(db, () => query(db, sql, [ids.orgB]));
  assert.ok(otherOrganization.n > 0, "fixture must contain another organization's change log");

  const rows = await asUser(db, ids.volunteerUserA, () =>
    query(db, "select distinct organization_id from sync.sync_changes"),
  );
  assert.deepEqual(
    rows.map((row) => row.organization_id),
    [ids.orgA],
  );

  const policySQL =
    "select relrowsecurity as enabled from pg_class where oid = 'sync.sync_changes'::regclass";
  const [rls] = await query(db, policySQL);
  assert.equal(rls.enabled, true);
});

test("revoked users lose access to the raw change log", async () => {
  const sql =
    "update public.organization_memberships set status = 'disabled' where organization_id = $1 and user_id = $2";
  await asOwner(db, () => query(db, sql, [ids.orgA, ids.volunteerUserA2]));

  const rows = await asUser(db, ids.volunteerUserA2, () =>
    query(db, "select sequence from sync.sync_changes"),
  );
  assert.equal(rows.length, 0);
});

test("public command authority still accepts a valid coordinator request", async () => {
  const response = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "CREATE_OPPORTUNITY",
    payload: { title: "Permission Smoke Test", slug: "permission-smoke" },
  });
  assert.equal(response.status, "applied");
});

test("all internal sync tables use row-level security", async () => {
  const names = ["devices", "entity_tables", "processed_operations", "sync_changes"];
  for (const name of names) {
    const [row] = await query(
      db,
      "select relrowsecurity as enabled from pg_class where oid = $1::regclass",
      [`sync.${name}`],
    );
    assert.equal(row.enabled, true, `sync.${name} must have RLS`);
  }
});

test("authenticated replication can read the static catalog but not internal state", async () => {
  const [catalog] = await asUser(db, ids.ownerA, () =>
    query(db, "select count(*)::int as n from sync.entity_tables"),
  );
  assert.ok(catalog.n > 0, "workspace bootstrap needs the entity-type catalog");

  await assert.rejects(
    asAnon(db, () => query(db, "select * from sync.entity_tables limit 1")),
    /permission denied/i,
  );

  for (const name of ["devices", "processed_operations"]) {
    await assert.rejects(
      asUser(db, ids.ownerA, () => query(db, `select * from sync.${name} limit 1`)),
      /permission denied/i,
      `sync.${name} must not be readable directly`,
    );
  }
});

test("reviewed signed-in RPCs are unavailable to anonymous callers", async () => {
  const reviewed = [
    "public.apply_command(uuid,uuid,uuid,text,bigint,jsonb,jsonb,timestamptz)",
    "public.ensure_profile(text)",
    "public.health_snapshot(uuid)",
    "public.mark_all_notifications_read(uuid)",
    "public.mark_notification_read(uuid)",
    "public.my_workspaces()",
    "public.register_device(uuid,uuid,text,text)",
    "public.register_push_subscription(uuid,text,text,text,text)",
    "public.report_device_state(uuid,uuid,bigint,integer,timestamptz,text)",
    "public.revoke_push_subscription(text)",
    "public.save_notification_preferences(uuid,boolean,boolean,boolean,boolean,time,time,integer)",
  ];
  for (const signature of reviewed) {
    assert.equal(await permission("anon", signature), false, signature);
    assert.equal(await permission("authenticated", signature), true, signature);
    const [definition] = await query(
      db,
      "select proconfig from pg_proc where oid = $1::regprocedure",
      [signature],
    );
    assert.ok(
      definition.proconfig.some((setting) => setting === 'search_path=""'),
      signature,
    );
  }
});
