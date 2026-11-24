import assert from "node:assert/strict";
import test from "node:test";
import { asUser, createDatabase, ids, query, seed, sendCommand } from "./harness.mjs";

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

test("shared installations have independent account and tenant device state", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const register = (user, org) =>
      asUser(
        db,
        user,
        () => query(db, "select public.register_device($1, $2) as result", [org, ids.replicaA]),
        { commit: true },
      );
    assert.equal((await register(ids.volunteerUserA, ids.orgA))[0].result.status, "ok");
    assert.equal((await register(ids.volunteerUserA2, ids.orgA))[0].result.status, "ok");
    assert.equal((await register(ids.ownerB, ids.orgB))[0].result.status, "ok");
    const [report] = await asUser(
      db,
      ids.volunteerUserA2,
      () =>
        query(db, "select public.report_device_state($1, $2, 99) as result", [
          ids.orgA,
          ids.replicaA,
        ]),
      { commit: true },
    );
    assert.equal(report.result.status, "ok");
    const devices = await query(db, "select user_id, cursor from sync.devices where id = $1", [
      ids.replicaA,
    ]);
    assert.equal(devices.length, 3);
    const cursor = (user) => Number(devices.find((device) => device.user_id === user).cursor);
    assert.equal(cursor(ids.volunteerUserA), 0);
    assert.equal(cursor(ids.volunteerUserA2), 99);
    assert.equal(cursor(ids.ownerB), 0);
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

test("operation replay cannot cross account or tenant and rejected work remains rejected", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const operationId = "99999999-9999-4999-8999-999999999991";
    const options = {
      organizationId: ids.orgA,
      operationId,
      command: "REGISTER_FOR_SHIFT",
      payload: { shiftId: ids.shiftSingle },
    };
    const first = await sendCommand(db, ids.volunteerUserA, options);
    assert.equal(first.status, "applied");
    const replay = await sendCommand(db, ids.volunteerUserA2, options);
    assert.equal(replay.status, "forbidden");
    assert.equal(replay.code, "operation_owner_mismatch");
    assert.equal(replay.data, undefined);
    const foreign = await sendCommand(db, ids.ownerB, {
      ...options,
      organizationId: ids.orgB,
    });
    assert.equal(foreign.status, "forbidden");
    const losing = { ...options, operationId: "99999999-9999-4999-8999-999999999992" };
    const refused = await sendCommand(db, ids.volunteerUserA2, losing);
    const retried = await sendCommand(db, ids.volunteerUserA2, losing);
    assert.equal(refused.status, "conflict");
    assert.equal(retried.status, "conflict");
    assert.equal(retried.code, "capacity_full");
  } finally {
    await db.close();
  }
});

test("broadcast and recipient notifications never cross tenant or revoked membership boundaries", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await query(
      db,
      "insert into public.notifications (organization_id, kind, title, audience, volunteer_id) values ($1, 'reminder', 'A broadcast', 'all', null), ($2, 'reminder', 'B broadcast', 'all', null), ($1, 'reminder', 'A recipient', 'volunteer', $3)",
      [ids.orgA, ids.orgB, ids.volunteerA],
    );
    const titles = async (user) => {
      const rows = await asUser(db, user, () =>
        query(db, "select title from public.notifications order by title"),
      );
      return rows.map((row) => row.title);
    };
    assert.deepEqual(await titles(ids.volunteerUserA), ["A broadcast", "A recipient"]);
    assert.deepEqual(await titles(ids.volunteerUserA2), ["A broadcast"]);
    assert.deepEqual(await titles(ids.ownerB), ["B broadcast"]);
    await query(
      db,
      "update public.organization_memberships set status = 'disabled' where organization_id = $1 and user_id = $2",
      [ids.orgA, ids.volunteerUserA],
    );
    assert.deepEqual(await titles(ids.volunteerUserA), []);
    assert.deepEqual(await titles(ids.volunteerUserA2), ["A broadcast"]);
  } finally {
    await db.close();
  }
});
