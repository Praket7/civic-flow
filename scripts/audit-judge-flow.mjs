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
      "--disable-popup-blocking",
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

  // A fresh visitor to the hosted root must reach onboarding without
  // an existing organization or Supabase password. This failed in PR #13.
  await open("/");
  await heading("Service, organized.");
  const publicEntry = await evaluate(`(() => ({
    signup: Boolean(document.querySelector('a[href="#/create-account"]')),
    signin: Boolean(document.querySelector('a[href="#/sign-in"]')),
    demo: Boolean(document.querySelector('a[href="/judge/demo/#/welcome"]')),
    passwordForm: Boolean(document.querySelector('input[type="password"]')),
  }))()`);
  assert.equal(publicEntry.signup, true, "new visitors must see account creation");
  assert.equal(publicEntry.signin, true, "returning visitors must see sign in");
  assert.equal(publicEntry.demo, true, "judges must access the sample without an account");
  assert.equal(publicEntry.passwordForm, false, "root must show welcome, not sign in");
  // Click the real CTA instead of only checking that the demo URL loads. This
  // protects the judging path from inadvertently sending visitors to sign in.
  const demoAction = await evaluate(`(() => {
    const link = document.querySelector('a[href="/judge/demo/#/welcome"]');
    return { primary: Boolean(link?.className?.includes("welcomePrimary")) };
  })()`);
  assert.equal(demoAction.primary, true, "the no-account demo must be the primary welcome action");
  await evaluate("document.querySelector('a[href=\\\"/judge/demo/#/welcome\\\"]')?.click()");
  await until(
    () => evaluate('location.pathname === "/judge/demo/" && location.hash === "#/welcome"'),
    "welcome links directly into the no-account judging sample",
  );
  await heading("Service, organized");
  assert.equal(
    await evaluate("Boolean(document.querySelector('input[type=\"password\"]'))"),
    false,
    "the sample must never start at sign in",
  );
  await open("/");
  await heading("Service, organized");
  await open("/#/create-account");
  await heading("Get started with CivicFlow");
  assert.equal(
    await evaluate(`Boolean(document.querySelector('input[autocomplete="new-password"]'))`),
    true,
    "account creation must have a password field",
  );
  await open("/#/sign-in");
  await heading("Your next shift is waiting.");
  assert.equal(
    await evaluate(`Boolean(document.querySelector('a[href="#/create-account"]'))`),
    true,
    "sign in must link back to registration",
  );

  // A mistaken sign-in deep link must never trap a judge behind credentials.
  await open("/#/sign-in");
  await heading("Your next shift is waiting.");
  const demoEscape = await evaluate(`(() => {
    const link = document.querySelector('a[href="/judge/demo/#/welcome"]');
    if (!link) return false;
    const rect = link.getBoundingClientRect();
    return rect.height >= 40 && rect.top >= 0 && rect.bottom <= innerHeight;
  })()`);
  assert.equal(
    demoEscape,
    true,
    "No-account demo link must be visible before scrolling on sign in",
  );
  await evaluate("document.querySelector('a[href=\"/judge/demo/#/welcome\"]')?.click()");
  await until(
    () => evaluate('location.pathname === "/judge/demo/" && location.hash === "#/welcome"'),
    "sign-in escape must open the sample welcome, not another password form",
  );
  await heading("Service, organized.");
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
    { width: 1280, height: 440, collapsed: false },
    { width: 1280, height: 440, collapsed: true },
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
    // At tablet-width desktop sizes the rail intentionally hides the name
    // until hover/focus, even when the stored collapsed preference is false.
    if (!collapsed && width > 1180) {
      assert.ok(
        bounds.identityBottom > 0 && bounds.identityBottom <= height + 2,
        "Coordinator identity clipped by viewport",
      );
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
    await evaluate(
      "Boolean(document.querySelector('#workspace-navigation [href*=\"accessibility\"]'))",
    ),
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
  // Stage 5: exercise focus boundaries with real keyboard events and a narrow viewport.
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(
    () => evaluate('document.querySelector("#primary-navigation")?.inert'),
    "closed mobile navigation is inert",
  );
  const key = async (name, modifiers = 0) => {
    const windowsVirtualKeyCode = name === "Escape" ? 27 : 9;
    await send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: name,
      code: name,
      modifiers,
      windowsVirtualKeyCode,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: name,
      code: name,
      modifiers,
      windowsVirtualKeyCode,
    });
  };
  await evaluate("document.querySelector('button[aria-label=\"Open navigation\"]').focus()");
  await evaluate("document.querySelector('button[aria-label=\"Open navigation\"]').click()");
  await until(
    () => evaluate('document.activeElement?.getAttribute("aria-label") === "Close navigation"'),
    "drawer moves focus to its close button",
  );
  assert.equal(
    await evaluate('document.querySelector("main")?.parentElement.inert'),
    true,
    "Background must be inert while drawer is open",
  );
  await evaluate(
    "document.querySelector('#primary-navigation button[aria-label=\"Sign out\"]').focus()",
  );
  await key("Tab");
  assert.equal(
    await evaluate('document.activeElement?.getAttribute("aria-label")'),
    "CivicFlow",
    "Tab wraps from the last drawer control to the first",
  );
  await key("Escape");
  console.log(
    "Drawer after Escape:",
    await evaluate(
      `JSON.stringify({ focus: document.activeElement?.getAttribute("aria-label"), inert: document.querySelector("#primary-navigation")?.inert, background: document.querySelector("main")?.parentElement.inert, workspace: Boolean(document.querySelector("#workspace-navigation")) })`,
    ),
  );
  await until(
    () => evaluate('document.activeElement?.getAttribute("aria-label") === "Open navigation"'),
    "Escape restores the opener",
  );
  assert.equal(
    await evaluate('document.querySelector("#primary-navigation").inert'),
    true,
    "Closed drawer must exclude keyboard focus",
  );
  await evaluate("document.querySelector('button[aria-label=\"Open navigation\"]').click()");
  await until(
    () => evaluate('!document.querySelector("#primary-navigation").inert'),
    "drawer reopened",
  );
  await evaluate(
    "document.querySelector('#primary-navigation a[aria-label=\"Schedule\"]').click()",
  );
  await heading("Schedule");
  await until(
    () => evaluate('document.activeElement?.id === "main-content"'),
    "route navigation focuses the new main content",
  );
  assert.equal(
    await evaluate('document.querySelector("#primary-navigation").inert'),
    true,
    "Navigation dismisses the drawer",
  );
  await send("Emulation.clearDeviceMetricsOverride");
  console.log(
    "Stage 5: mobile drawer focus containment, Escape, return focus, and route focus passed.",
  );

  // Stage 4: changing a real date filter must recalculate the displayed report.
  await open("/judge/demo/#/coordinator/reports/custom");
  await heading("Custom report builder");
  await until(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll("p")).some((node) => /source rows/.test(node.textContent || ""))',
      ),
    "report source row count",
  );
  assert.equal(
    await evaluate(
      '(() => {\n  const names = Array.from(document.querySelectorAll("select")).map((select) =>\n    document.querySelector(\'label[for="\' + select.id + \'"]\')?.textContent?.trim() || ""\n  );\n  return ["Date range", "Cause", "Program"].every((name) => names.includes(name));\n})()',
    ),
    true,
    "Report filter controls",
  );

  // Compare real exported data to the visible table, without reusing the app's
  // CSV implementation as the test oracle. Capture the generated download Blob
  // and the actual printable window used by the Export PDF action.
  const reportRows = await evaluate(`(() => {
    const table = Array.from(document.querySelectorAll("table")).find((item) =>
      item.caption?.textContent.trim() === "Report source records"
    );
    if (!table) return null;
    return Array.from(table.rows, (row) =>
      Array.from(row.cells, (cell) => cell.textContent.trim())
    );
  })()`);
  assert.ok(reportRows && reportRows.length > 1, "Expected a populated report");
  const armed = await evaluate(`(() => {
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob.type.includes("text/csv")) {
        void blob.text().then((value) => { window.__reportCsv = value; });
      }
      return original(blob);
    };
    const originalOpen = window.open.bind(window);
    window.open = (...args) => {
      const popup = originalOpen(...args);
      if (popup) {
        popup.print = () => {};
        window.__reportPrint = popup;
      }
      return popup;
    };
    return true;
  })()`);
  assert.equal(armed, true);
  await evaluate(`Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent.trim() === "Export CSV"
  ).click()`);
  const csv = await until(() => evaluate("window.__reportCsv"), "CSV export payload");
  const expectedCsv =
    reportRows
      .map((row) =>
        row
          .map((cell) => {
            const safe =
              /^[=@]/.test(cell) || (/^[+-]/.test(cell) && !/^[+-][0-9\s().-]*$/.test(cell))
                ? "'" + cell
                : cell;
            return /[",\r\n]/.test(safe) ? '"' + safe.replaceAll('"', '""') + '"' : safe;
          })
          .join(","),
      )
      .join("\r\n") + "\r\n";
  assert.equal(csv.replace(/^\uFEFF/, ""), expectedCsv, "CSV must match every visible source row");

  await evaluate(`Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent.trim() === "Export PDF"
  ).click()`);
  const printRows = await until(
    () =>
      evaluate(`(() => {
      const table = window.__reportPrint?.document.querySelector("table");
      if (!table) return null;
      return Array.from(table.rows, (row) =>
        Array.from(row.cells, (cell) => cell.textContent.trim())
      );
    })()`),
    "printable report rows",
  );
  assert.deepEqual(printRows, reportRows, "Printable report must match every visible source row");
  await evaluate("window.__reportPrint.close()");
  console.log("Stage 4: real CSV payload and printable export match the visible table.");

  assert.equal(
    await evaluate(
      '(() => {\n  const select = Array.from(document.querySelectorAll("select")).find((item) =>\n    document.querySelector(\'label[for="\' + item.id + \'"]\')?.textContent?.trim() === "Date range"\n  );\n  if (!select) return false;\n  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "custom");\n  select.dispatchEvent(new Event("change", { bubbles: true }));\n  return true;\n})()',
    ),
    true,
    "Change report period",
  );
  await until(
    () => evaluate("Boolean(document.querySelector('input[aria-label=\"Report start date\"]'))"),
    "custom report start date",
  );
  assert.equal(
    await evaluate(
      '(() => {\n  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;\n  for (const [label, value] of [["Report start date", "2030-01-01"], ["Report end date", "2030-01-31"]]) {\n    const input = document.querySelector(\'input[aria-label="\' + label + \'"]\');\n    if (!input) return false;\n    setter.call(input, value);\n    input.dispatchEvent(new Event("input", { bubbles: true }));\n    input.dispatchEvent(new Event("change", { bubbles: true }));\n  }\n  return true;\n})()',
    ),
    true,
    "Set future dates",
  );
  await until(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll("p")).some((node) => /0 source rows/.test(node.textContent || ""))',
      ),
    "future-only report must contain zero source rows",
  );
  console.log("Stage 4: live report filters and future period passed.");
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
