#!/usr/bin/env node
/**
 * Independent smoke of the compiled FBLA judging build in a fresh Chromium
 * profile. Unlike HTML asset checks, this verifies the actual React router,
 * seeded sign-in, and navigation through the coordinator UI.
 *
 * Run after pnpm build:hosted (with a publishable Supabase key). This script
 * starts Vite preview locally and does not contact or modify Supabase.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.JUDGE_PREVIEW_PORT || 5265);
const cdpPort = Number(process.env.JUDGE_CDP_PORT || 9356);
const base = `http://127.0.0.1:${port}`;
const chromeBin = [
  process.env.CHROME,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((candidate) => candidate && existsSync(candidate));

if (!chromeBin) {
  console.error("Judge flow smoke requires headless Chrome (set CHROME to its binary).");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(action, label, limitMs = 20_000) {
  const end = Date.now() + limitMs;
  while (Date.now() < end) {
    try {
      const value = await action();
      if (value) return value;
    } catch {
      // Browser/server may still be initializing.
    }
    await sleep(180);
  }
  throw new Error(`Timed out: ${label}`);
}

const profile = await mkdtemp(path.join(tmpdir(), "civicflow-judge-"));
let server;
let chrome;
let socket;
try {
  server = spawn(
    process.execPath,
    [path.join(root, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: root, stdio: process.env.CI ? "inherit" : "ignore" },
  );
  await until(async () => (await fetch(`${base}/judge/`)).ok, "hosted preview server");

  for (const [url, required] of [
    ["/", "CivicFlow Volunteer"],
    ["/judge/", "Competition Review"],
    ["/judge/demo/", "CivicFlow"],
  ]) {
    const response = await fetch(base + url);
    assert.equal(response.status, 200, `GET ${url}`);
    assert.match(await response.text(), new RegExp(required), `entry ${url}`);
  }

  chrome = spawn(
    chromeBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      ...(process.env.CI ? ["--no-sandbox"] : []),
      "--window-size=1280,850",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: process.env.CI ? ["ignore", "ignore", "inherit"] : "ignore" },
  );
  await until(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok, "Chromium DevTools");
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const target = targets.find((row) => row.type === "page");
  assert.ok(target?.webSocketDebuggerUrl, "Chromium page target is available");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let serial = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (!payload.id || !pending.has(payload.id)) return;
    const handlers = pending.get(payload.id);
    pending.delete(payload.id);
    if (payload.error) handlers.reject(new Error(JSON.stringify(payload.error)));
    else handlers.resolve(payload.result);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (response.exceptionDetails) throw new Error("Browser expression failed");
    return response.result?.value;
  }
  async function open(url) {
    await send("Page.navigate", { url: base + url });
    await until(() => evaluate('document.readyState === "complete"'), `navigation to ${url}`);
  }
  async function heading(expected) {
    return until(
      async () => {
        const value = await evaluate('document.querySelector("h1")?.textContent?.trim() || ""');
        return value.toLowerCase().includes(expected.toLowerCase()) ? value : false;
      },
      `heading contains "${expected}"`,
    );
  }

  await open("/judge/");
  await heading("More time for service");
  await open("/judge/demo/#/welcome");
  await heading("Service, organized");
  await until(
    () => evaluate('Array.from(document.querySelectorAll("button")).some(b => (b.textContent || "").includes("Explore the demo"))'),
    "the sample workspace launch button",
  );
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").includes("Explore the demo")).click()');
  await until(
    () => evaluate('window.location.hash.startsWith("#/coordinator/")'),
    "demo coordinator route",
  );
  await until(
    () => evaluate('document.querySelector("main h1")?.textContent?.trim() || ""'),
    "coordinator dashboard heading",
  );
  for (const [route, title] of [
    ["/coordinator/autoroster", "AutoRoster"],
    ["/coordinator/schedule", "Schedule"],
    ["/coordinator/reports", "Reports"],
  ]) {
    await open(`/judge/demo/#${route}`);
    await heading(title);
    assert.equal(
      await evaluate('window.location.pathname'),
      "/judge/demo/",
      "hash navigation must stay within the isolated judging app",
    );
  }
  console.log("Judge browser flow passed: public review, sample launch, AutoRoster, schedule and reports.");
} finally {
  socket?.close();
  chrome?.kill();
  server?.kill();
  await rm(profile, { recursive: true, force: true });
}
