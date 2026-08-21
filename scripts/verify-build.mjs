import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = resolve(repositoryRoot, "apps/web/dist");
const indexPath = resolve(distDirectory, "index.html");
assert.ok(existsSync(indexPath), "apps/web/dist/index.html does not exist");

const html = readFileSync(indexPath, "utf8");
assert.match(
  html,
  /Content-Security-Policy[^>]+connect-src 'none'/,
  "production CSP must disable network connections",
);
assert.doesNotMatch(
  html,
  /(?:src|href)=["']\/(?!\/)/,
  "asset URLs must be relative for GitHub Pages project sites",
);
assert.doesNotMatch(
  html,
  /(?:src|href)=["']https?:\/\//,
  "production HTML must not load remote assets",
);
assert.doesNotMatch(
  html,
  /<!-- production-csp -->/,
  "production CSP placeholder was not replaced",
);

const localAssets = [...html.matchAll(/(?:src|href)=["']\.\/([^"']+)["']/g)]
  .map((match) => match[1])
  .filter(Boolean);
assert.ok(localAssets.length >= 3, "expected local script, stylesheet, and favicon");
for (const asset of localAssets) {
  assert.ok(existsSync(resolve(distDirectory, asset)), `missing built asset: ${asset}`);
}

console.log(`Verified ${localAssets.length} local assets and production CSP.`);
