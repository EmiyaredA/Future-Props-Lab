import fs from "node:fs";
import path from "node:path";

const dist = path.resolve(process.env.FPL_WEB_DIST_DIR || "dist", "assets");
const jsLimit = 500 * 1024;
// ELK ships its GWT layout engine as one precompiled worker. Keep a bounded,
// separately fetched worker budget; application and other vendor JS stay at 500 KiB.
const elkWorkerLimit = 1600 * 1024;
const cssLimit = 150 * 1024;
const galgameCssBaseline = 369_600;
const galgameCssLimit = Math.floor(galgameCssBaseline * 0.9);
const galgameCssPrefixes = [
  "galgame-shell-",
  "story-authoring-",
  "character-stage-",
  "assets-and-player-",
];

const violations = [];
const manifestPath = path.join(path.dirname(dist), ".vite/manifest.json");
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const visited = new Set();
  const active = [];
  function visit(key) {
    const index = active.indexOf(key);
    if (index !== -1) {
      violations.push(
        `Circular static chunks: ${active.slice(index).concat(key).join(" -> ")}`,
      );
      return;
    }
    if (visited.has(key)) return;
    active.push(key);
    for (const imported of manifest[key]?.imports || []) visit(imported);
    active.pop();
    visited.add(key);
  }
  for (const key of Object.keys(manifest)) visit(key);
}
let galgameCssBytes = 0;
for (const entry of fs.readdirSync(dist)) {
  const file = path.join(dist, entry);
  const size = fs.statSync(file).size;
  const limit = /^elk-worker\.min-[\w-]+\.js$/.test(entry)
    ? elkWorkerLimit
    : jsLimit;
  if (entry.endsWith(".js") && size > limit)
    violations.push(`${entry}: ${(size / 1024).toFixed(1)} KiB JS`);
  if (entry.endsWith(".css") && size > cssLimit)
    violations.push(`${entry}: ${(size / 1024).toFixed(1)} KiB CSS`);
  if (
    entry.endsWith(".css") &&
    galgameCssPrefixes.some((prefix) => entry.startsWith(prefix))
  )
    galgameCssBytes += size;
}
if (galgameCssBytes > galgameCssLimit)
  violations.push(
    `Galgame CSS total: ${(galgameCssBytes / 1024).toFixed(1)} KiB ` +
      `(limit ${(galgameCssLimit / 1024).toFixed(1)} KiB)`,
  );
if (violations.length) {
  throw new Error(`Bundle budget exceeded:\n${violations.join("\n")}`);
}
