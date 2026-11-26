import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const problems = [];
const required = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "docs/architecture.md",
  "docs/deployment.md",
  "docs/operations.md",
  "docs/testing.md",
];
const ignored = new Set([".git", "node_modules", "target", "dist", ".secrets", "gen"]);

function* markdown(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* markdown(path);
    else if (entry.isFile() && entry.name.endsWith(".md")) yield path;
  }
}

for (const path of required) {
  if (!existsSync(join(root, path))) problems.push(`Missing documentation: ${path}`);
}

for (const path of markdown(root)) {
  const source = readFileSync(path, "utf8").replace(/\x60{3}[\s\S]*?\x60{3}/g, "");
  for (const match of source.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const link = match[1];
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(link)) continue;
    try {
      const target = resolve(dirname(path), decodeURI(link.split("#")[0]));
      if (!existsSync(target)) problems.push(`${relative(root, path)}: missing link ${link}`);
    } catch {
      problems.push(`${relative(root, path)}: invalid link ${link}`);
    }
  }
}

try {
  execFileSync(process.execPath, [join(root, "scripts/update-readme-facts.mjs"), "--check"], {
    stdio: "inherit",
  });
} catch {
  problems.push("README facts are stale; run pnpm docs:update.");
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Documentation checks passed.");
