/**
 * Competition evidence, not a public installer or production attestation.
 * Read the actual exported PDF, reconcile its text to the captured source
 * table, then bind the evidence to the exact checked-out source and version.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function compactText(text) {
  return text.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
}

export function verifyRenderedRows(rows, extractedText) {
  assert.ok(Array.isArray(rows) && rows.length > 1, "missing source rows");
  assert.ok(rows[0].length > 1, "missing source columns");
  const actual = compactText(extractedText);
  assert.ok(actual.length > 20, "rendered PDF has no substantial extractable text");
  for (const row of rows) {
    assert.equal(row.length, rows[0].length, "ragged source table");
    for (const cell of row) {
      assert.equal(typeof cell, "string");
      const value = compactText(cell);
      if (value) assert.ok(actual.includes(value), "rendered PDF missing source value: " + cell);
    }
  }
}

export function fileDigest(file) {
  assert.ok(lstatSync(file).isFile(), "evidence must be a regular file: " + file);
  const bytes = readFileSync(file);
  assert.ok(bytes.length > 0, "empty evidence: " + file);
  return {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function buildManifest(root, names, identity) {
  assert.match(identity.sourceSha, /^[a-f0-9]{40}$/);
  assert.match(identity.version, /^\d+\.\d+\.\d+$/);
  assert.equal(new Set(names).size, names.length, "duplicate evidence paths");
  const artifacts = {};
  for (const name of [...names].sort()) {
    assert.match(name, /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/, "invalid evidence filename");
    artifacts[name] = fileDigest(path.join(root, name));
  }
  return { schemaVersion: 1, ...identity, artifacts };
}

export function verifyManifest(root, manifest) {
  assert.equal(manifest.schemaVersion, 1);
  const { schemaVersion: _schemaVersion, artifacts, ...identity } = manifest;
  assert.ok(Object.keys(artifacts).length > 0, "empty manifest");
  assert.deepEqual(buildManifest(root, Object.keys(artifacts), identity), manifest);
}

function run() {
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const dir = path.join(root, "competition-evidence");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (process.env.EXPECTED_SOURCE_SHA) {
    assert.equal(sourceSha, process.env.EXPECTED_SOURCE_SHA, "not the requested source candidate");
  }
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  execFileSync(process.execPath, ["scripts/check-release-version.mjs", "v" + version], {
    cwd: root,
    stdio: "inherit",
  });
  const rows = JSON.parse(readFileSync(path.join(dir, "report-source-rows.json"), "utf8"));
  const pdf = path.join(dir, "report.pdf");
  const pdfInfo = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
  const pageCount = Number(pdfInfo.match(/^Pages:\s+(\d+)/m)?.[1]);
  assert.ok(Number.isInteger(pageCount) && pageCount >= 1, "PDF has no pages");
  const extracted = execFileSync("pdftotext", ["-raw", pdf, "-"], { encoding: "utf8" });
  verifyRenderedRows(rows, extracted);
  writeFileSync(path.join(dir, "report-rendered-text.txt"), extracted);
  execFileSync("pdftoppm", ["-r", "100", "-png", pdf, path.join(dir, "report-page")]);
  const screenshots = readdirSync(dir).filter((name) => /^\d\d-.*\.png$/.test(name));
  assert.equal(screenshots.length, 12, "expected twelve connected journey screenshots");
  const pages = readdirSync(dir).filter((name) => /^report-page-\d+\.png$/.test(name));
  assert.equal(pages.length, pageCount, "each PDF page must have a raster review image");
  const benchmark = readFileSync(path.join(dir, "benchmark.txt"), "utf8");
  assert.equal(
    (benchmark.match(/AutoRoster comparison: candidates=/g) || []).length,
    3,
    "missing measured baseline cases",
  );
  assert.match(benchmark, /candidates=1000, seats=250/);
  assert.match(benchmark, /test result: ok/);
  const required = [
    "report.pdf",
    "report.csv",
    "report-source-rows.json",
    "report-rendered-text.txt",
    "benchmark.txt",
    "toolchain.txt",
    "known-answer.txt",
    "browser-journey.txt",
    ...screenshots,
    ...pages,
  ];
  const manifest = buildManifest(dir, required, {
    sourceSha,
    version,
    kind: "synthetic-competition-evidence",
    deployment: "not a production release; build uses a synthetic publishable key",
    publicJudgingUrl: "https://civic-flow-demo.vercel.app/judge/demo/#/welcome",
    pdfPages: pageCount,
    sourceRows: rows.length - 1,
  });
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  verifyManifest(dir, JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")));
  console.log("Competition evidence verified:", sourceSha, version, pageCount, "PDF pages");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
