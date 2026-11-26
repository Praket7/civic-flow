import assert from "node:assert/strict";
import test from "node:test";

import { asAnon, asOwner, asUser, createDatabase, ids, query } from "./harness.mjs";

test("database scheduler credentials are short-lived, single-use and service-only", async () => {
  const db = await createDatabase();
  try {
    const issue = async () => {
      const [row] = await query(db, "select private.issue_reminder_scheduler_nonce() as nonce");
      return row.nonce;
    };
    const consume = (nonce) =>
      asOwner(db, async () => {
        await db.exec("set local role service_role");
        const [row] = await query(
          db,
          "select public.consume_reminder_scheduler_nonce($1) as accepted",
          [nonce],
        );
        return row.accepted;
      });

    const nonce = await issue();
    assert.match(nonce, /^[0-9a-f]{64}$/);
    await assert.rejects(
      asAnon(db, () => query(db, "select public.consume_reminder_scheduler_nonce($1)", [nonce])),
      /permission denied/i,
    );
    await assert.rejects(
      asUser(db, ids.volunteerUserA, () =>
        query(db, "select public.consume_reminder_scheduler_nonce($1)", [nonce]),
      ),
      /permission denied/i,
    );
    await assert.rejects(
      asUser(db, ids.volunteerUserA, () =>
        query(db, "select private.issue_reminder_scheduler_nonce()"),
      ),
      /permission denied/i,
    );
    assert.equal(await consume("invalid"), false);
    assert.equal(await consume("0".repeat(64)), false);
    assert.equal(await consume(nonce), true);
    assert.equal(await consume(nonce), false);

    const expired = await issue();
    await query(
      db,
      "update private.reminder_scheduler_nonces set expires_at = now() - interval '1 minute'",
    );
    assert.equal(await consume(expired), false);
  } finally {
    await db.close();
  }
});
