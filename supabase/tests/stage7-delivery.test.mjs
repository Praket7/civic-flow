import assert from "node:assert/strict";
import test from "node:test";
import { asAnon, asOwner, asUser, createDatabase, ids, query, seed } from "./harness.mjs";

test("public push configuration reveals only the public key", async () => {
  const db = await createDatabase();
  try {
    await query(db, "select public.save_vapid_keys('public-test', 'private-test')");
    for (const read of [
      () => asAnon(db, () => query(db, "select public.vapid_public_key() as key")),
      () => asUser(db, ids.volunteerUserA, () => query(db, "select public.vapid_public_key() as key")),
    ]) {
      assert.equal((await read())[0].key, "public-test");
    }
    await assert.rejects(
      asUser(db, ids.volunteerUserA, () => query(db, "select private_key from private.push_keys")),
      /permission denied/i,
    );
  } finally {
    await db.close();
  }
});

test("an expired delivery lease is reclaimed and its old completion is rejected", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const [notification] = await query(
      db,
      "insert into public.notifications (organization_id, kind, title, audience, volunteer_id) values ($1, 'reminder', 'Lease test', 'volunteer', $2) returning id",
      [ids.orgA, ids.volunteerA],
    );
    const [delivery] = await query(
      db,
      "insert into public.notification_deliveries (organization_id, notification_id, user_id, channel, dedupe_key, status, attempts, claimed_at) values ($1, $2, $3, 'push', 'lease-test', 'sending', 1, now() - interval '16 minutes') returning id",
      [ids.orgA, notification.id, ids.volunteerUserA],
    );
    const [claim] = await asOwner(db, () =>
      query(db, "select public.dispatch_reminders(50) as result"),
    );
    const job = claim.result.jobs.find((candidate) => candidate.deliveryId === delivery.id);
    assert.equal(job.attempts, 2);
    const complete = (attempt) =>
      asOwner(db, () =>
        query(db, "select public.complete_delivery_attempt($1, $2, 'sent') as result", [
          delivery.id,
          attempt,
        ]),
      );
    assert.equal((await complete(1))[0].result.status, "stale_attempt");
    assert.equal((await complete(2))[0].result.status, "ok");
    assert.equal((await complete(2))[0].result.status, "stale_attempt");
    const [final] = await query(db, "select status, attempts from public.notification_deliveries");
    assert.deepEqual(final, { status: "sent", attempts: 2 });
  } finally {
    await db.close();
  }
});

test("a scheduled push is skipped when its recipient loses membership", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const [notification] = await query(
      db,
      "insert into public.notifications (organization_id, kind, title, audience, volunteer_id) values ($1, 'reminder', 'Revocation test', 'volunteer', $2) returning id",
      [ids.orgA, ids.volunteerA],
    );
    await query(
      db,
      "insert into public.notification_deliveries (organization_id, notification_id, user_id, channel, dedupe_key) values ($1, $2, $3, 'push', 'revoked-test')",
      [ids.orgA, notification.id, ids.volunteerUserA],
    );
    await query(
      db,
      "update public.organization_memberships set status = 'disabled' where organization_id = $1 and user_id = $2",
      [ids.orgA, ids.volunteerUserA],
    );
    const [claim] = await asOwner(db, () =>
      query(db, "select public.dispatch_reminders(50) as result"),
    );
    assert.equal(claim.result.claimed, 0);
    const [final] = await query(db, "select status from public.notification_deliveries");
    assert.equal(final.status, "skipped");
  } finally {
    await db.close();
  }
});
