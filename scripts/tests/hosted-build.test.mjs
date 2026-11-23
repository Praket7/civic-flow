import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { assertHostedConfiguration, promoteHostedPwa } from "../prepare-hosted-build.mjs";

test("hosted publishing refuses missing or placeholder project keys", () => {
  for (const key of ["", "your-key-here", "sb_secret_private", "undefined"]) {
    assert.throws(
      () => assertHostedConfiguration({ VITE_SUPABASE_ANON_KEY: key }),
      /key|token|publishable/i,
    );
  }
  assert.throws(
    () =>
      assertHostedConfiguration({
        VITE_SUPABASE_URL: "http://localhost:54321",
        VITE_SUPABASE_ANON_KEY: "sb_publishable_publickey",
      }),
    /HTTPS/,
  );
});

test("hosted publishing accepts only public project credentials", () => {
  assert.equal(
    assertHostedConfiguration({
      VITE_SUPABASE_ANON_KEY: "sb_publishable_publickey",
      VITE_SUPABASE_URL: "https://imzdblvljdcbnxtwbmbw.supabase.co",
    }).url,
    "https://imzdblvljdcbnxtwbmbw.supabase.co",
  );

  const jwt = (role) =>
    [
      Buffer.from('{"alg":"HS256"}').toString("base64url"),
      Buffer.from(JSON.stringify({ role })).toString("base64url"),
      "public-test-signature",
    ].join(".");
  assert.doesNotThrow(() => assertHostedConfiguration({ VITE_SUPABASE_ANON_KEY: jwt("anon") }));
  assert.throws(
    () => assertHostedConfiguration({ VITE_SUPABASE_ANON_KEY: jwt("service_role") }),
    /privileged/,
  );
});

test("hosted publishing replaces only the built index, keeping desktop sources intact", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "civicflow-hosted-"));
  const demo = '<html><title>CivicFlow</title><script src="/assets/main-demo.js"></script></html>';
  const hosted =
    '<html><title>CivicFlow Volunteer</title><script type="module" src="/assets/pwa-real.js"></script></html>';
  try {
    await writeFile(path.join(dir, "index.html"), demo);
    await writeFile(path.join(dir, "pwa.html"), hosted);
    await promoteHostedPwa(dir);
    assert.equal(await readFile(path.join(dir, "index.html"), "utf8"), hosted);
    assert.equal(await readFile(path.join(dir, "pwa.html"), "utf8"), hosted);
    assert.equal(await readFile(path.join(dir, "judge", "demo", "index.html"), "utf8"), demo);
    assert.ok(
      (await readFile(path.join(dir, "judge", "screenshots", "autoroster.png"))).byteLength >
        100_000,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("hosted publishing leaves index untouched when PWA bundle is not verified", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "civicflow-hosted-"));
  const demo = "<html>CivicFlow demo</html>";
  try {
    await writeFile(path.join(dir, "index.html"), demo);
    await writeFile(path.join(dir, "pwa.html"), "<html>broken</html>");
    await assert.rejects(promoteHostedPwa(dir), /PWA entrypoint missing/);
    assert.equal(await readFile(path.join(dir, "index.html"), "utf8"), demo);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("public judging page points at the isolated sample and labels its data", async () => {
  const html = await readFile(new URL("../../public/judge/index.html", import.meta.url), "utf8");
  assert.match(html, /\/judge\/demo\/#\/welcome/);
  assert.match(html, /sample data/i);
  assert.match(html, /offline/i);
});

test("judging copy is product-led rather than instructions or scoring claims", async () => {
  const html = await readFile(new URL("../../public/judge/index.html", import.meta.url), "utf8");
  assert.match(html, /Every open shift has a clear path to being filled/);
  assert.match(html, /Thoughtful details\. Dependable decisions/);
  assert.doesNotMatch(
    html,
    /Judge the working program|Try a bad value|Verify stored records|Change the analysis|New York prejudging · 200 points|How to evaluate the program/,
  );
});

test("volunteer service worker leaves judging pages outside its PWA shell cache", async () => {
  const source = await readFile(new URL("../../public/sw.js", import.meta.url), "utf8");
  const listeners = new Map();
  const sw = {
    location: { origin: "https://civicflow.example.org" },
    addEventListener: (type, handler) => listeners.set(type, handler),
  };
  runInNewContext(source, { self: sw, URL });
  const handleFetch = listeners.get("fetch");
  assert.equal(typeof handleFetch, "function");
  for (const route of ["/judge", "/judge/", "/judge/demo/", "/judge/screenshots/autoroster.png"]) {
    let intercepted = false;
    handleFetch({
      request: {
        method: "GET",
        url: "https://civicflow.example.org" + route,
        mode: "navigate",
      },
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, route + " must bypass the PWA service worker");
  }
});
