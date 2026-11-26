import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyReleaseAssets } from "../verify-release-assets.mjs";

test("release gate refuses version, signature and missing-asset mismatches", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "civicflow-release-"));
  try {
    const platforms = {};
    for (const [platform, asset] of [
      ["darwin-aarch64", "CivicFlow.dmg"],
      ["windows-x86_64", "CivicFlow.msi"],
      ["linux-x86_64", "CivicFlow.AppImage"],
    ]) {
      await writeFile(path.join(dir, asset), "test fixture");
      await writeFile(path.join(dir, asset + ".sig"), "fixture-signature");
      platforms[platform] = {
        signature: "fixture-signature",
        url: "https://github.com/Praket7/civic-flow/releases/download/v1.2.3/" + asset,
      };
    }
    const manifest = { version: "1.2.3", platforms };
    const save = () => writeFile(path.join(dir, "latest.json"), JSON.stringify(manifest));
    await save();
    await verifyReleaseAssets(dir, "v1.2.3");
    await assert.rejects(verifyReleaseAssets(dir, "v1.2.4"), /version/);
    platforms["linux-x86_64"].signature = "wrong";
    await save();
    await assert.rejects(verifyReleaseAssets(dir, "v1.2.3"), /signature/);
    platforms["linux-x86_64"].signature = "fixture-signature";
    platforms["linux-x86_64"].url += ".missing";
    await save();
    await assert.rejects(verifyReleaseAssets(dir, "v1.2.3"), /asset missing/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
