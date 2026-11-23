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
    [
      path.join(root, "node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
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
  await until(
    async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok,
    "Chromium DevTools",
  );
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
    return until(async () => {
      const value = await evaluate('document.querySelector("h1")?.textContent?.trim() || ""');
      return value.toLowerCase().includes(expected.toLowerCase()) ? value : false;
    }, `heading contains "${expected}"`);
  }

  await open("/judge/");
  await heading("More time for service");
  await open("/judge/demo/#/welcome");
  await heading("Service, organized");
  await until(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll("button")).some(b => (b.textContent || "").includes("Explore the demo"))',
      ),
    "the sample workspace launch button",
  );
  await evaluate(
    'Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").includes("Explore the demo")).click()',
  );
  await until(
    () => evaluate('window.location.hash.startsWith("#/coordinator/")'),
    "demo coordinator route",
  );
  await until(
    () => evaluate('document.querySelector("main h1")?.textContent?.trim() || ""'),
    "coordinator dashboard heading",
  );
  // Accessibility must be available at the bottom of the coordinator sidebar,
  // immediately above the account identity, not buried in the workspace menu.
  await open("/judge/demo/#/coordinator/mission-control");
  await heading("Good morning");
  const sidebarAudit = await evaluate(`(() => {
    const aside = document.querySelector('aside[aria-label="Primary"]');
    const access = aside?.querySelector('a[aria-label="Accessibility settings"]');
    const identity = aside?.querySelector('[class*="personName"]');
    const week = document.querySelector('[aria-labelledby="mc-week"]');
    return {
      accessVisible: Boolean(access && access.getBoundingClientRect().height > 0),
      aboveIdentity: Boolean(access && identity && (access.compareDocumentPosition(identity) & Node.DOCUMENT_POSITION_FOLLOWING)),
      weekHeight: week?.getBoundingClientRect().height ?? 0,
      attentionHeight:
        document.querySelector('[aria-labelledby="mc-attention"]')?.getBoundingClientRect()
          .height ?? 0,
      barsCentered: (() => {
        if (!week) return false;
        const bars = week.querySelector('ul[aria-label="Seat fill by day"]');
        const summary = week.querySelector('[aria-label="Weekly staffing summary"]');
        const head = week.querySelector('[class*="cardHead"]');
        if (!bars || !summary || !head) return false;
        const availableCenter =
          (head.getBoundingClientRect().bottom + summary.getBoundingClientRect().top) / 2;
        const barsCenter =
          (bars.getBoundingClientRect().top + bars.getBoundingClientRect().bottom) / 2;
        return Math.abs(availableCenter - barsCenter) < 30;
      })(),
      summaryPresent: Boolean(week?.querySelector('[aria-label="Weekly staffing summary"]')),
    };
  })()`);
  assert.equal(sidebarAudit.accessVisible, true, "Accessibility control must be visible");
  assert.equal(sidebarAudit.aboveIdentity, true, "Accessibility must precede account identity");
  assert.ok(
    sidebarAudit.weekHeight > 300 &&
      Math.abs(sidebarAudit.weekHeight - sidebarAudit.attentionHeight) < 3,
    "Weekly coverage and Needs Attention must share the same card height",
  );
  assert.equal(sidebarAudit.barsCentered, true, "Bars should be vertically centered");
  assert.equal(sidebarAudit.summaryPresent, true, "Weekly chart must include staffing totals");

  // A CSS-only check is insufficient: prove all navigation actions fit in the
  // actual Chromium viewport, in the full sidebar and in the icon rail.
  for (const { width, height, collapsed } of [
    { width: 1280, height: 740, collapsed: false },
    { width: 1280, height: 620, collapsed: true },
    { width: 1024, height: 700, collapsed: false },
    { width: 1024, height: 620, collapsed: true },
    { width: 1280, height: 520, collapsed: false },
    { width: 1280, height: 520, collapsed: true },
    { width: 1024, height: 440, collapsed: false },
    { width: 1024, height: 440, collapsed: true },
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(`(() => {
      const sidebar = document.querySelector('aside[aria-label="Primary"]');
      const shell = document.querySelector('.shell[data-collapsed]');
      if (sidebar) sidebar.dataset.collapsed = "${collapsed}";
      if (shell) shell.dataset.collapsed = "${collapsed}";
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    })()`);
    // Simulate a cursor over the content, not the sidebar's hover-to-expand rail.
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.min(width - 80, 850),
      y: Math.min(height - 80, 300),
      button: "none",
    });
    await sleep(160);
    const bounds = await evaluate(`(() => {
      const aside = document.querySelector('aside[aria-label="Primary"]');
      const nav = aside?.querySelector('nav');
      const footer = aside?.querySelector('[class*="footer"]');
      const access = aside?.querySelector('[aria-label="Accessibility settings"]');
      const signOut = aside?.querySelector('button[aria-label="Sign out"]');
      const identity = aside?.querySelector('[class*="personName"]');
      const person = aside?.querySelector('[class*="person"]');
      const org = aside?.querySelector('button[aria-label^="Workspace:"]');
      const controls = [org, access, signOut, ...Array.from(nav?.querySelectorAll('a') ?? [])]
        .filter(Boolean)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            label: element.getAttribute("aria-label") ?? element.textContent?.trim(),
            visible: rect.width > 0 && rect.height >= 30 &&
              rect.top >= -1 && rect.bottom <= window.innerHeight + 1,
          };
        });
      return {
        viewport: window.innerHeight,
        sidebarBottom: aside?.getBoundingClientRect().bottom,
        footerBottom: footer?.getBoundingClientRect().bottom,
        accessBottom: access?.getBoundingClientRect().bottom,
        signOutBottom: signOut?.getBoundingClientRect().bottom,
        identityBottom: identity?.getBoundingClientRect().bottom,
        personBottom: person?.getBoundingClientRect().bottom,
        navigationOverflow: nav ? nav.scrollHeight - nav.clientHeight : Infinity,
        controls,
      };
    })()`);
    assert.ok(bounds.sidebarBottom <= height + 2, "Sidebar extends below viewport");
    assert.ok(bounds.footerBottom <= height + 2, "Account footer extends below viewport");
    assert.ok(bounds.accessBottom <= height + 2, "Accessibility clipped by viewport");
    assert.ok(bounds.signOutBottom <= height + 2, "Sign out clipped by viewport");
    assert.ok(bounds.personBottom <= height + 2, "Account avatar clipped by viewport");
    if (!collapsed) {
      assert.ok(bounds.identityBottom > 0 && bounds.identityBottom <= height + 2,
        "Coordinator identity clipped by viewport");
    }
    assert.ok(bounds.navigationOverflow <= 2, "Desktop navigation must fit without scrolling");
    assert.ok(
      bounds.controls.length >= 9 && bounds.controls.every((item) => item.visible),
      `All sidebar actions must be visible at ${width}×${height}: ${JSON.stringify(bounds)}`,
    );
    console.log(`Sidebar viewport passed: ${width}×${height}, collapsed=${collapsed}`);
  }
  await send("Emulation.clearDeviceMetricsOverride");
  await evaluate(`(() => {
    const sidebar = document.querySelector('aside[aria-label="Primary"]');
    const shell = document.querySelector('.shell[data-collapsed]');
    if (sidebar) sidebar.dataset.collapsed = "false";
    if (shell) shell.dataset.collapsed = "false";
  })()`);
  await evaluate("document.querySelector('button[aria-label^=\"Workspace:\"]')?.click()");
  assert.equal(
    await evaluate('Boolean(document.querySelector(\'[role="menu"] [href*="accessibility"]\'))'),
    false,
    "Accessibility must not remain in the workspace dropdown",
  );
  await open("/judge/demo/#/coordinator/accessibility");
  await heading("Accessibility");

  for (const [route, title] of [
    ["/coordinator/autoroster", "AutoRoster"],
    ["/coordinator/schedule", "Schedule"],
    ["/coordinator/reports", "Reports"],
  ]) {
    await open(`/judge/demo/#${route}`);
    await heading(title);
    assert.equal(
      await evaluate("window.location.pathname"),
      "/judge/demo/",
      "hash navigation must stay within the isolated judging app",
    );
  }
  console.log(
    "Judge browser flow passed: public review, sample launch, AutoRoster, schedule and reports.",
  );
} finally {
  socket?.close();

  // Chromium can still be flushing IndexedDB/profile files after kill().
  // Wait for the child to exit before removing its profile. Otherwise the
  // successful browser smoke test intermittently fails with ENOTEMPTY.
  async function stopProcess(child) {
    if (!child || child.exitCode !== null) return;
    const finished = new Promise((resolve) => {
      child.once("exit", resolve);
      child.once("error", resolve);
    });
    child.kill();
    await Promise.race([finished, sleep(3000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }

  await stopProcess(chrome);
  await stopProcess(server);
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
