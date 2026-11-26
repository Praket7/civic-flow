/** Fails CI if the main interactive entrypoints grow without review. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const assets = resolve(
  process.env.CIVICFLOW_DIST_ASSETS ?? fileURLToPath(new URL("../dist/assets/", import.meta.url)),
);
const entries = readdirSync(assets);
const budgets = [
  { name: "main JavaScript", pattern: /^main-[\w-]+\.js$/, maxKiB: 315 },
  { name: "shared bridge JavaScript", pattern: /^bridge-[\w-]+\.js$/, maxKiB: 235 },
  { name: "volunteer PWA JavaScript", pattern: /^pwa-[\w-]+\.js$/, maxKiB: 35 },
  { name: "main CSS", pattern: /^main-[\w-]+\.css$/, maxKiB: 80 },
];

let failed = false;
const results = budgets.map(({ name, pattern, maxKiB }) => {
  const matching = entries.filter((name) => pattern.test(name));
  if (matching.length !== 1) {
    failed = true;
    console.error(`Expected exactly one ${name} asset, found ${matching.length}`);
    return { name, error: "missing or ambiguous asset" };
  }
  const bytes = gzipSync(readFileSync(join(assets, matching[0]))).byteLength;
  const maximum = maxKiB * 1024;
  if (bytes > maximum) failed = true;
  const status = bytes > maximum ? "FAIL" : "pass";
  console.log(`${status} ${name}: ${(bytes / 1024).toFixed(1)} KiB gzip (budget ${maxKiB} KiB)`);
  return {
    name,
    file: matching[0],
    gzipBytes: bytes,
    budgetBytes: maximum,
    passed: bytes <= maximum,
  };
});

writeFileSync(
  resolve(assets, "../bundle-budget-report.json"),
  JSON.stringify({ results }, null, 2),
);
if (failed) process.exitCode = 1;
