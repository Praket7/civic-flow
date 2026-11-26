import assert from "node:assert/strict";
import test from "node:test";
import { asUser, createDatabase, ids, query, seed } from "./harness.mjs";

test("notification reads preserve tenant and recipient scope after policy optimization", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (const [org, user, label] of [
      [ids.orgA, ids.volunteerUserA, "a"],
      [ids.orgA, ids.volunteerUserA2, "a2"],
      [ids.orgB, ids.ownerB, "b"],
    ]) {
      await query(
        db,
        "insert into public.notification_preferences (organization_id, user_id) values ($1, $2)",
        [org, user],
      );
      await query(
        db,
        "insert into public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth) values ($1, $2, $3, 'p', 'a')",
        [org, user, `https://push.example.test/${label}`],
      );
      await query(
        db,
        "insert into public.notification_deliveries (organization_id, user_id, channel, dedupe_key) values ($1, $2, 'push', $3)",
        [org, user, label],
      );
      const [update] = await query(
        db,
        "insert into public.organization_updates (organization_id, kind, title) values ($1, 'announcement', $2) returning id",
        [org, label],
      );
      await query(
        db,
        "insert into public.organization_update_reads (organization_id, update_id, user_id) values ($1, $2, $3)",
        [org, update.id, user],
      );
    }
    const visible = async (table, user) => {
      const rows = await asUser(db, user, () =>
        query(db, `select user_id from public.${table} order by user_id`),
      );
      return rows.map((row) => row.user_id);
    };
    for (const table of [
      "notification_preferences",
      "push_subscriptions",
      "notification_deliveries",
      "organization_update_reads",
    ]) {
      assert.deepEqual(await visible(table, ids.volunteerUserA), [ids.volunteerUserA]);
      assert.deepEqual(await visible(table, ids.ownerB), [ids.ownerB]);
      assert.deepEqual(
        await visible(table, ids.coordinatorA),
        table === "notification_deliveries" ? [ids.volunteerUserA, ids.volunteerUserA2] : [],
      );
    }
    await query(
      db,
      "update public.organization_memberships set status = 'disabled' where organization_id = $1 and user_id = $2",
      [ids.orgA, ids.volunteerUserA],
    );
    for (const table of [
      "notification_preferences",
      "push_subscriptions",
      "notification_deliveries",
      "organization_update_reads",
    ]) {
      assert.deepEqual(await visible(table, ids.volunteerUserA), []);
    }
  } finally {
    await db.close();
  }
});

test("global diagnostic tables remain closed even if SELECT is accidentally granted", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await query(db, "insert into public.backup_runs (status) values ('succeeded')");
    await query(
      db,
      "insert into public.server_job_runs (job, status) values ('test', 'succeeded')",
    );
    for (const table of ["backup_runs", "server_job_runs"]) {
      await assert.rejects(
        asUser(db, ids.ownerA, () => query(db, `select id from public.${table}`)),
        /permission denied/i,
      );
      await db.exec(`grant select on public.${table} to authenticated`);
      for (const user of [ids.ownerA, ids.coordinatorA, ids.ownerB, ids.volunteerUserA]) {
        assert.deepEqual(
          await asUser(db, user, () => query(db, `select id from public.${table}`)),
          [],
        );
      }
    }
    const [health] = await asUser(db, ids.coordinatorA, () =>
      query(db, "select public.health_snapshot($1) as result", [ids.orgA]),
    );
    assert.equal(health.result.status, "ok");
  } finally {
    await db.close();
  }
});
