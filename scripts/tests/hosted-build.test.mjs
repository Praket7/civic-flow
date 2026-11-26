import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    await mkdir(path.join(dir, "judge"));
    const page = await readFile(new URL("../../public/judge/index.html", import.meta.url), "utf8");
    await writeFile(path.join(dir, "judge", "index.html"), page);
    await promoteHostedPwa(dir);
    const compiled = await readFile(path.join(dir, "judge", "index.html"), "utf8");
    const validator = compiled.match(/<script id="application-validator">([\s\S]*?)<\/script>/);
    assert.ok(validator, "hosted showcase includes the actual application validator");
    const window = {};
    runInNewContext(validator[1], { window });
    const draft = {
      title: "Food pantry shift",
      cause: "food",
      description: "Pack groceries and prepare food boxes for distribution.",
      address: "100 Sample Street",
      capacity: "12",
      duration: "2 hours",
      requirements: "",
    };
    assert.equal(window.civicflowValidateOpportunity(draft).valid, true);
    assert.equal(window.civicflowValidateOpportunity({ ...draft, capacity: "0" }).valid, false);
    const offline = await readFile(path.join(dir, "judge", "offline.html"), "utf8");
    assert.match(offline, /<html lang="en" data-offline>/);
    assert.equal((offline.match(/src="data:image\/png;base64,/g) || []).length, 5);
    assert.doesNotMatch(offline, /src="\/judge\/screenshots\//);
    assert.match(offline, /window\.civicflowValidateOpportunity =/);
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

test("public judging page points at the actual application and labels its data", async () => {
  const html = await readFile(new URL("../../public/judge/index.html", import.meta.url), "utf8");
  assert.match(html, /href="https:\/\/civic-flow-demo\.vercel\.app\/"/);
  assert.match(html, /sample data/i);
  assert.match(html, /offline/i);
  assert.doesNotMatch(html, /id="present-start"|id="present-bar"|data-stage=/);
  assert.match(html, /id="compare-greedy"/);
  assert.match(html, /id="compare-opt"/);
});

test("judging copy is product-led rather than instructions or scoring claims", async () => {
  const html = await readFile(new URL("../../public/judge/index.html", import.meta.url), "utf8");
  assert.match(html, /From scheduling to reporting/);
  assert.match(html, /Built to be inspected/);
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

test("the worker does not turn unrelated navigation or private requests into offline assets", async () => {
  const source = await readFile(new URL("../../public/sw.js", import.meta.url), "utf8");
  const listeners = new Map();
  const sw = {
    location: { origin: "https://civicflow.example.org" },
    addEventListener: (type, handler) => listeners.set(type, handler),
  };
  runInNewContext(source, { self: sw, URL });
  const handleFetch = listeners.get("fetch");
  for (const [route, mode] of [
    ["/unrelated", "navigate"],
    ["/account.json", "cors"],
    ["/api/private", "cors"],
    ["/judge/demo/", "navigate"],
  ]) {
    let intercepted = false;
    handleFetch({
      request: { method: "GET", url: sw.location.origin + route, mode },
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, route);
  }
});

test("the judging response blocks direct connections to other origins", async () => {
  const config = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
  const judge = config.headers.find((entry) => entry.source === "/judge/(.*)");
  const csp = judge.headers.find((entry) => entry.key === "Content-Security-Policy");
  assert.match(csp.value, /connect-src 'self' blob:;/);
});

test("retired sample hostname redirects to the requested app, without reverse redirects", async () => {
  const config = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
  const sampleHost = "civic-flow-sample-praket7.vercel.app";
  for (const source of ["/", "/judge/demo", "/judge/demo/", "/(.*)"]) {
    const redirect = config.redirects.find(
      (entry) =>
        entry.source === source && entry.has.some((condition) => condition.value === sampleHost),
    );
    assert.equal(redirect.destination, "https://civic-flow-demo.vercel.app/");
  }
  assert.ok(config.redirects.every((entry) => !entry.destination.includes(sampleHost)));
});

test("showcase matching fills the most eligible seats before maximizing score", async () => {
  const page = await readFile(new URL("../../public/judge/index.html", import.meta.url), "utf8");
  const source = page.match(/<script id="showcase-model">([\s\S]*?)<\/script>/);
  assert.ok(source);
  const context = {};
  runInNewContext(source[1], context);
  const solve = context.solveMatching;
  const simple = [
    [92, 98],
    [76, null],
  ];
  assert.equal(solve(simple, "greedy").filled, 1);
  assert.equal(solve(simple, "optimized").filled, 2);
  for (let mask = 0; mask < 512; mask++) {
    const matrix = Array.from({ length: 3 }, (_, i) =>
      Array.from({ length: 3 }, (_, j) =>
        mask & (1 << (i * 3 + j)) ? (i * 17 + j * 29 + mask) % 101 : null,
      ),
    );
    let bestFilled = -1;
    let bestScore = -1;
    function visit(seat, used, filled, score) {
      if (seat === 3) {
        if (filled > bestFilled || (filled === bestFilled && score > bestScore)) {
          bestFilled = filled;
          bestScore = score;
        }
        return;
      }
      visit(seat + 1, used, filled, score);
      for (let i = 0; i < 3; i++) {
        if (!(used & (1 << i)) && matrix[i][seat] !== null) {
          visit(seat + 1, used | (1 << i), filled + 1, score + matrix[i][seat]);
        }
      }
    }
    visit(0, 0, 0, 0);
    const result = solve(matrix, "optimized");
    assert.equal(result.filled, bestFilled, "coverage " + mask);
    assert.equal(result.score, bestScore, "score " + mask);
  }
});
