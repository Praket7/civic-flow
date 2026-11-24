import assert from "node:assert/strict";
import test from "node:test";
import { isExplicitDenial, validateStagingTarget } from "../live-hosted-auth-smoke.mjs";

test("staging smoke refuses production, mismatched origins and privileged keys", () => {
  const key = "sb_publishable_test";
  const ref = "staging-example";
  const url = "https://" + ref + ".supabase.co";
  assert.equal(validateStagingTarget(url, key, ref).url, url);
  assert.throws(() =>
    validateStagingTarget(
      "https://imzdblvljdcbnxtwbmbw.supabase.co",
      key,
      "imzdblvljdcbnxtwbmbw",
    ),
  );
  assert.throws(() => validateStagingTarget(url, key, "other"));
  assert.throws(() => validateStagingTarget(url, "sb_secret_test", ref));
  assert.throws(() => validateStagingTarget(url, "", ref));
});

test("network failures and unknown RPC responses are not authorization evidence", () => {
  assert.equal(isExplicitDenial({ data: { status: "forbidden" } }), true);
  assert.equal(isExplicitDenial({ error: { code: "42501" } }), true);
  assert.equal(isExplicitDenial({ error: { message: "network unavailable" } }), false);
  assert.equal(isExplicitDenial({ data: null }), false);
});
