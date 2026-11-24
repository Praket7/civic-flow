import assert from "node:assert/strict";
import test from "node:test";
import { schedulerAuthorized } from "../../supabase/functions/_shared/scheduler-auth.mjs";

test("only the configured high-entropy scheduler token authorizes dispatch", () => {
  const configured = "A".repeat(64);
  assert.equal(schedulerAuthorized(configured, configured), true);
  for (const token of [undefined, null, "", "short", "B".repeat(64), configured + "A"]) {
    assert.equal(schedulerAuthorized(configured, token), false);
  }
  assert.equal(schedulerAuthorized(undefined, configured), false);
  assert.equal(schedulerAuthorized("short", "short"), false);
});
