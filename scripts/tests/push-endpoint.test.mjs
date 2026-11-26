import assert from "node:assert/strict";
import test from "node:test";

import { approvedPushEndpoint } from "../../supabase/functions/_shared/push-endpoint.mjs";

test("browser-operated HTTPS push services are accepted", () => {
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/test",
    "https://updates.push.services.mozilla.com/wpush/v2/test",
    "https://web.push.apple.com/Qtest",
    "https://wns2-bl2p.notify.windows.com/test",
  ]) {
    assert.equal(approvedPushEndpoint(endpoint), endpoint);
  }
});

test("arbitrary hosts, credentials, unusual ports, and unsafe URLs are rejected", () => {
  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/test",
    "https://fcm.googleapis.com.evil.example/test",
    "https://fcm.googleapis.com@evil.example/test",
    "https://evil.example@fcm.googleapis.com/test",
    "https://fcm.googleapis.com:8443/test",
    "https://127.0.0.1/test",
    "https://[::1]/test",
    "https://169.254.169.254/test",
    "https://evil.example/test",
    "https://push.apple.com.evil.example/test",
    "https://fcm.googleapis.com/test#secret",
    "https://fcm.googleapis.com\\@evil.example/test",
  ]) {
    assert.equal(approvedPushEndpoint(endpoint), null, endpoint);
  }
});
