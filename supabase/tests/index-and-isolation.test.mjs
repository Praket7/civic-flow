import assert from "node:assert/strict";
import test from "node:test";

import { asAnon, asUser, createDatabase, ids, query, seed } from "./harness.mjs";

test("public tables keep RLS and foreign key lookups have covering indexes", async () => {
  const db = await createDatabase();
  try {
    const unsecured = await query(
      db,
      `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    assert.deepEqual(unsecured, []);
    const indexes = await query(
      db,
      "select indexname from pg_indexes where schemaname = 'public' and indexname like 'cf_fk_%'",
    );
    assert.equal(indexes.length, 51);
    const syncIndexes = await query(
      db,
      "select indexname from pg_indexes where schemaname = 'sync' and indexname = 'cf_fk_devices_user_id'",
    );
    assert.equal(syncIndexes.length, 1);
    await seed(db);
    for (const user of [ids.ownerA, ids.coordinatorA, ids.volunteerUserA, ids.volunteerUserA2]) {
      const rows = await asUser(db, user, () =>
        query(db, "select id from public.shifts where organization_id = $1", [ids.orgB]),
      );
      assert.deepEqual(rows, [], "another organization's shifts must remain invisible");
    }
    for (const user of [ids.ownerA, ids.coordinatorA, ids.volunteerUserA, ids.volunteerUserA2]) {
      const profiles = await asUser(db, user, () => query(db, "select id from public.profiles"));
      assert.ok(profiles.every((row) => row.id === user));
      const membership = await asUser(db, user, () =>
        query(
          db,
          "select user_id from public.organization_memberships where organization_id = $1",
          [ids.orgB],
        ),
      );
      assert.deepEqual(membership, []);
    }
    await assert.rejects(
      asAnon(db, () => query(db, "select id from public.organizations")),
      /permission denied/i,
    );
  } finally {
    await db.close();
  }
});
