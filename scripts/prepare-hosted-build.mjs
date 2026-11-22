#!/usr/bin/env node
/**
 * Production web deployment gate.
 *
 * Desktop/Tauri keeps the multi-entry Vite build and its local demo.
 * The public hosted build serves ONLY the Supabase-backed PWA at /.
 * Never publish the local browser-preview entrypoint on the main domain.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const DEFAULT_URL = "https://imzdblvljdcbnxtwbmbw.supabase.co";

export function assertHostedConfiguration(env = process.env) {
  const url = (env.VITE_SUPABASE_URL || DEFAULT_URL).trim();
  const key = (env.VITE_SUPABASE_ANON_KEY || "").trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
    throw new Error("Hosted build requires the HTTPS Supabase project origin.");
  }
  if (!key || /^(undefined|null|changeme|placeholder|your[-_])/i.test(key)) {
    throw new Error("Hosted build requires VITE_SUPABASE_ANON_KEY (a publishable/anon key).");
  }
  // A service-role JWT and a modern sb_secret_* key must NEVER be compiled into a browser.
  if (key.startsWith("sb_secret_")) {
    throw new Error("Refusing to embed a Supabase secret key in a browser build.");
  }
  if (key.split(".").length === 3) {
    let payload;
    try {
      payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    } catch (error) {
      throw new Error("Invalid Supabase anon JWT.", { cause: error });
    }
    if (payload.role !== "anon") {
      throw new Error("Browser build requires an anon JWT, not a privileged token.");
    }
  } else if (!/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key)) {
    throw new Error("Hosted build expects a Supabase publishable key or legacy anon JWT.");
  }
  return { url, key };
}

export async function promoteHostedPwa(dist) {
  const index = path.join(dist, "index.html");
  const pwa = path.join(dist, "pwa.html");
  const [demoHtml, pwaHtml] = await Promise.all([readFile(index, "utf8"), readFile(pwa, "utf8")]);
  if (!demoHtml.includes("<html") || !demoHtml.includes("CivicFlow")) {
    throw new Error("Cannot verify the built desktop/demo entrypoint.");
  }
  if (!pwaHtml.includes("CivicFlow Volunteer") || !/src="\/assets\/pwa-[^"]+\.js"/.test(pwaHtml)) {
    throw new Error("Built PWA entrypoint missing; refusing to publish the demo.");
  }
  if (/src="\/assets\/main-[^"]+\.js"/.test(pwaHtml)) {
    throw new Error("PWA unexpectedly imports the browser demo entrypoint.");
  }
  // The built entry document is replaced only AFTER all validation succeeds.
  // The source index.html and Tauri's build:web output are never modified.
  await writeFile(index, pwaHtml, "utf8");
  return index;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    assertHostedConfiguration();
    if (process.argv.includes("--check-config")) {
      console.log("Hosted public Supabase configuration is valid.");
    } else {
      const dist = path.resolve("dist");
      const out = await promoteHostedPwa(dist);
      console.log(
        "Hosted release ready: the Supabase-backed PWA is the root entrypoint (" + out + ").",
      );
    }
  } catch (error) {
    console.error("Hosted release blocked:", error.message);
    process.exitCode = 1;
  }
}
