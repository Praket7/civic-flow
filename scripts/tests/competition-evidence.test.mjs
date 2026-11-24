import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildManifest, verifyManifest, verifyRenderedRows } from "../competition-evidence.mjs";

test("rendered PDF extraction must contain every source cell", () => {
  const rows = [
    ["Volunteer", "Approved minutes"],
    ["Maya Chen", "75"],
  ];
  assert.doesNotThrow(() => verifyRenderedRows(rows, "Volunteer Approved minutes\nMaya\nChen 75"));
  assert.throws(() => verifyRenderedRows(rows, "Volunteer Approved minutes Maya Chen 70"));
  assert.throws(() => verifyRenderedRows(rows, " "));
  assert.throws(() =>
    verifyRenderedRows([rows[0], ["Maya Chen"]], "Volunteer Approved minutes Maya Chen 75"),
  );
});

test("manifest pins content, refuses duplicates and detects tampering", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "civicflow-evidence-"));
  try {
    const identity = { sourceSha: "a".repeat(40), version: "0.1.2" };
    const name = "report.csv";
    writeFileSync(path.join(dir, name), "Approved minutes\n75\n");
    const manifest = buildManifest(dir, [name], identity);
    assert.doesNotThrow(() => verifyManifest(dir, manifest));
    assert.throws(() => buildManifest(dir, [name, name], identity));
    assert.throws(() => buildManifest(dir, ["../report.csv"], identity));
    writeFileSync(path.join(dir, name), "Approved minutes\n70\n");
    assert.throws(() => verifyManifest(dir, manifest));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
