import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const roots = {
  baseline: path.resolve(process.argv[2] || "baseline/dist"),
  candidate: path.resolve(process.argv[3] || "candidate/dist"),
};
const chromeBin = [
  process.env.CHROME,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
].find((candidate) => candidate && existsSync(candidate));
assert.ok(chromeBin, "Chrome is required for a same-runner comparison");

const pages = [
  { name: "hosted welcome", route: "/", heading: "Service, organized" },
  { name: "judging showcase", route: "/judge/", heading: "More time for service" },
  { name: "interactive sample", route: "/judge/demo/", heading: "Service, organized" },
];
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

async function until(work, label, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const result = await work();
      if (result) return result;
    } catch {
      // Chrome and the document may still be starting.
    }
    await delay(40);
  }
  throw new Error("Timed out: " + label);
}

async function serve(root) {
  const server = createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const file = path.resolve(root, "." + pathname);
      assert.ok(file.startsWith(root + path.sep));
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Length": body.byteLength,
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: "http://127.0.0.1:" + server.address().port };
}

async function measure(root) {
  const profile = await mkdtemp(path.join(tmpdir(), "civicflow-startup-"));
  const { server, url } = await serve(root);
  let chrome;
  let socket;
  try {
    chrome = spawn(
      chromeBin,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--proxy-server=http://127.0.0.1:1",
        "--proxy-bypass-list=127.0.0.1;localhost",
        "--disable-quic",
        "--window-size=1280,850",
        "--remote-debugging-port=0",
        "--user-data-dir=" + profile,
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    const port = await until(async () => {
      const content = await readFile(path.join(profile, "DevToolsActivePort"), "utf8");
      return Number(content.split("\n")[0]) || false;
    }, "Chrome debugging port");
    const target = await until(async () => {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list");
      return (await response.json()).find((row) => row.type === "page")?.webSocketDebuggerUrl;
    }, "Chrome page");
    socket = new WebSocket(target);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });

    let serial = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    });
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++serial;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const answer = await send("Runtime.evaluate", { expression, returnByValue: true });
      assert.ok(!answer.exceptionDetails, "Browser measurement expression failed");
      return answer.result?.value;
    };
    await send("Page.enable");
    await send("Network.enable");
    await send("Network.setCacheDisabled", { cacheDisabled: true });
    await send("Network.setBypassServiceWorker", { bypass: true });

    const observations = [];
    for (const page of pages) {
      await send("Storage.clearDataForOrigin", { origin: url, storageTypes: "all" });
      await send("Page.navigate", { url: url + page.route });
      const metrics = await until(async () => {
        const value = await evaluate(
          "(() => {" +
            "const heading = document.querySelector('h1')?.textContent || '';" +
            "const fcp = performance.getEntriesByName('first-contentful-paint')[0];" +
            "const navigation = performance.getEntriesByType('navigation')[0];" +
            "return {path: location.pathname, heading, fcp: fcp?.startTime || 0," +
            "load: navigation?.loadEventEnd || 0, observed: performance.now()," +
            "resourceBytes: performance.getEntriesByType('resource').reduce((sum, row) => sum + row.transferSize, 0)};" +
            "})()",
        );
        if (
          value.path !== page.route ||
          !value.heading.includes(page.heading) ||
          !value.fcp ||
          !value.load
        ) {
          return false;
        }
        return value;
      }, page.name);
      observations.push({
        page: page.name,
        fcpMs: metrics.fcp,
        readyObservedMs: metrics.observed,
        loadMs: metrics.load,
        resourceBytes: metrics.resourceBytes,
      });
    }
    return observations;
  } finally {
    socket?.close();
    if (chrome && chrome.exitCode === null) {
      const stopped = new Promise((resolve) => chrome.once("exit", resolve));
      chrome.kill("SIGTERM");
      await Promise.race([stopped, delay(1000)]);
      if (chrome.exitCode === null) chrome.kill("SIGKILL");
    }
    server.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const samples = { baseline: [], candidate: [] };
for (const name of ["baseline", "candidate", "candidate", "baseline", "baseline", "candidate"]) {
  samples[name].push(...(await measure(roots[name])));
}

const report = {
  hardware: cpus()[0]?.model,
  node: process.version,
  chrome: spawnSync(chromeBin, ["--version"], { encoding: "utf8" }).stdout.trim(),
  samples,
  summary: [],
  failures: [],
};
for (const page of pages) {
  const rows = (name) => samples[name].filter((entry) => entry.page === page.name);
  const before = median(rows("baseline").map((entry) => entry.fcpMs));
  const after = median(rows("candidate").map((entry) => entry.fcpMs));
  const readyBefore = median(rows("baseline").map((entry) => entry.readyObservedMs));
  const readyAfter = median(rows("candidate").map((entry) => entry.readyObservedMs));
  report.summary.push({
    page: page.name,
    baselineFcpMs: before,
    candidateFcpMs: after,
    baselineReadyMs: readyBefore,
    candidateReadyMs: readyAfter,
  });
  if (after > before * 1.35 + 200 || readyAfter > readyBefore * 1.35 + 200) {
    report.failures.push(page.name + ": startup regression beyond 35% + 200ms");
  }
}

const bundles = {};
for (const name of ["baseline", "candidate"]) {
  const data = JSON.parse(await readFile(path.join(roots[name], "bundle-budget-report.json"), "utf8"));
  bundles[name] = Object.fromEntries(data.results.map((row) => [row.name, row.gzipBytes]));
}
report.bundles = bundles;
for (const [name, bytes] of Object.entries(bundles.baseline)) {
  if (!(bundles.candidate[name] <= bytes * 1.02 + 1024)) {
    report.failures.push(name + ": compressed bundle growth beyond 2% + 1 KiB");
  }
}
await writeFile("frontend-comparison.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
assert.deepEqual(report.failures, []);
