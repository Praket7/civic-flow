#!/usr/bin/env node
// Verify the unpublished release assets, not just the compiler's exit code.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export async function verifyReleaseAssets(directory, tag) {
  check(/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag), "Invalid release tag");
  const names = await readdir(directory);
  for (const [platform, pattern] of [
    ["macOS", /\.dmg$/i],
    ["Windows", /\.(msi|exe)$/i],
    ["Linux", /\.(appimage|deb|rpm)$/i],
  ]) {
    check(
      names.some((name) => pattern.test(name)),
      "Missing " + platform + " installer",
    );
  }
  const manifest = JSON.parse(await readFile(path.join(directory, "latest.json"), "utf8"));
  check(manifest.version === tag.slice(1), "Updater manifest version differs from release tag");
  const platforms = Object.entries(manifest.platforms ?? {});
  for (const prefix of ["darwin", "windows", "linux"]) {
    check(
      platforms.some(([platform]) => platform.startsWith(prefix + "-")),
      "Missing " + prefix,
    );
  }
  for (const [platform, entry] of platforms) {
    check(
      typeof entry.signature === "string" && entry.signature.trim(),
      "Missing updater signature",
    );
    const url = new URL(entry.url);
    const prefix = "/Praket7/civic-flow/releases/download/" + tag + "/";
    check(
      url.protocol === "https:" &&
        url.hostname === "github.com" &&
        url.pathname.startsWith(prefix) &&
        !url.search &&
        !url.hash,
      "Unexpected updater download URL for " + platform,
    );
    const asset = decodeURIComponent(url.pathname.slice(prefix.length));
    check(asset === path.basename(asset) && names.includes(asset), "Updater asset missing");
    const signature = await readFile(path.join(directory, asset + ".sig"), "utf8");
    check(signature.trim() === entry.signature.trim(), "Updater signature does not match asset");
  }
  console.log("Draft platform assets, updater version and matching signatures: PASS");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyReleaseAssets(process.argv[2], process.argv[3]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
