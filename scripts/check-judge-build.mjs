#!/usr/bin/env node
/**
 * Verifies built assets on an actual hosted build: the live root must not be
 * replaced by browser-local demo data, and the isolated judging walkthrough
 * must retain its own interactive bundle and five repository screenshots.
 */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const dist = path.resolve(process.argv[2] || "dist");
const read = (file) => readFileSync(path.join(dist, file), "utf8");
const root = read("index.html");
const judge = read("judge/index.html");
const sample = read("judge/demo/index.html");

assert.match(root, /CivicFlow Volunteer/, "root must serve the real hosted PWA");
assert.match(root, /\/assets\/pwa-[\w-]+\.js/, "root must load PWA JS");
assert.doesNotMatch(root, /\/assets\/main-[\w-]+\.js/, "browser-local demo must not replace the hosted PWA");
assert.match(sample, /\/assets\/main-[\w-]+\.js/, "judge demo must load the actual coordinator UI");
assert.match(judge, /\/judge\/demo\/#\/welcome/, "judge page must link to the interactive demo");
assert.match(judge, /sample data/i, "judge page must disclose its local-only sample data");
for (const name of ["mission-control", "autoroster", "schedule", "volunteer-home", "volunteer-schedule"]) {
  const screenshot = path.join(dist, "judge", "screenshots", name + ".png");
  assert.ok(statSync(screenshot).size > 100_000, "missing repository screenshot: " + name);
}
console.log("Judging build gate passed: hosted PWA root, isolated sample and five local screenshots.");
