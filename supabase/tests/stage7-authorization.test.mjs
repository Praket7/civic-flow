import assert from "node:assert/strict";
import test from "node:test";
import { asUser, createDatabase, ids, query, seed } from "./harness.mjs";

test("staff RPCs fail closed for outsiders and volunteers; staff still has access", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (const name of ["health_snapshot", "delivery_health"]) {
      for (const [user, expected] of [
        [ids.ownerB, "forbidden"],
        [ids.volunteerUserA, "forbidden"],
        [ids.coordinatorA, "ok"],
      ]) {
        const [row] = await asUser(db, user, () =>
          query(db, `select public.${name}($1::uuid) as result`, [ids.orgA]),
        );
        assert.equal(row.result.status, expected, name);
      }
    }
  } finally {
    await db.close();
  }
});

test("replica registration and reporting cannot transfer another user's device", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const register = (user, org) =>
      asUser(
        db,
        user,
        () =>
          query(db, "select public.register_device($1, $2) as result", [org, ids.replicaA]),
        { commit: true },
      );
    assert.equal((await register(ids.volunteerUserA, ids.orgA))[0].result.status, "ok");
    assert.equal((await register(ids.volunteerUserA2, ids.orgA))[0].result.status, "forbidden");
    assert.equal((await register(ids.ownerB, ids.orgB))[0].result.status, "forbidden");
    const [report] = await asUser(db, ids.volunteerUserA2, () =>
      query(db, "select public.report_device_state($1, $2, 99) as result", [
        ids.orgA,
        ids.replicaA,
      ]),
    );
    assert.equal(report.result.status, "forbidden");
    const [device] = await query(db, "select user_id, cursor from sync.devices where id = $1", [
      ids.replicaA,
    ]);
    assert.equal(device.user_id, ids.volunteerUserA);
    assert.equal(Number(device.cursor), 0);
  } finally {
    await db.close();
  }
});

test("active push endpoints cannot be hijacked by another account", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const register = (user) =>
      asUser(
        db,
        user,
        () =>
          query(
            db,
            "select public.register_push_subscription($1, 'https://push.example.test/a', 'p', 'a') as result",
            [ids.orgA],
          ),
        { commit: true },
      );
    assert.equal((await register(ids.volunteerUserA))[0].result.status, "ok");
    assert.equal((await register(ids.volunteerUserA2))[0].result.status, "forbidden");
    const [subscription] = await query(db, "select user_id from public.push_subscriptions");
    assert.equal(subscription.user_id, ids.volunteerUserA);
  } finally {
    await db.close();
  }
});
