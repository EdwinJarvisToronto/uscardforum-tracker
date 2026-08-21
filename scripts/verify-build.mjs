import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = resolve(repositoryRoot, "apps/web/dist");
const indexPath = resolve(distDirectory, "index.html");
assert.ok(existsSync(indexPath), "apps/web/dist/index.html does not exist");

const html = readFileSync(indexPath, "utf8");
const cspContent = html.match(
  /<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=(["'])(.*?)\1[^>]*>/i,
)?.[2];
assert.ok(cspContent, "production CSP is missing");
assert.deepEqual(
  cspContent
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive.startsWith("connect-src")),
  ["connect-src https://api.github.com"],
  "production CSP must only allow the exact GitHub API connection",
);
assert.doesNotMatch(
  html,
  /(?:src|href)=["']\/(?!\/)/,
  "asset URLs must be relative for GitHub Pages project sites",
);
assert.doesNotMatch(
  html,
  /<(?:script|img|iframe)\b[^>]*\bsrc=["']https?:\/\//i,
  "production HTML must not load remote scripts, images, or frames",
);
assert.doesNotMatch(
  html,
  /<link\b[^>]*\bhref=["']https?:\/\//i,
  "production HTML must not load remote linked resources",
);
assert.doesNotMatch(
  html,
  /<!-- production-csp -->/,
  "production CSP placeholder was not replaced",
);

const repositoryUrl =
  "https://github.com/EdwinJarvisToronto/uscardforum-tracker";
const remoteReferences = [
  ...html.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)["']/gi),
].map((match) => match[1]);
assert.deepEqual(
  remoteReferences,
  [repositoryUrl],
  "the repository must be the only remote navigation target",
);

const starAnchor = html.match(
  /<a\b[^>]*\bid=["']github-star-link["'][^>]*>/i,
)?.[0];
assert.ok(starAnchor, "GitHub Star link is missing");
assert.match(starAnchor, /target=["']_blank["']/i, "Star link must open a new tab");
assert.match(
  starAnchor,
  /rel=["'][^"']*\bnoopener\b[^"']*\bnoreferrer\b[^"']*["']/i,
  "Star link must isolate the newly opened tab",
);

const localAssets = [...html.matchAll(/(?:src|href)=["']\.\/([^"']+)["']/g)]
  .map((match) => match[1])
  .filter(Boolean);
assert.ok(localAssets.length >= 3, "expected local script, stylesheet, and favicon");
for (const asset of localAssets) {
  assert.ok(existsSync(resolve(distDirectory, asset)), `missing built asset: ${asset}`);
}

const builtJavaScript = localAssets
  .filter((asset) => asset.endsWith(".js"))
  .map((asset) => readFileSync(resolve(distDirectory, asset), "utf8"))
  .join("\n");
assert.match(
  builtJavaScript,
  /https:\/\/api\.github\.com\/repos\/EdwinJarvisToronto\/uscardforum-tracker/,
  "built app must request the exact public repository endpoint",
);

console.log(`Verified ${localAssets.length} local assets and production CSP.`);
