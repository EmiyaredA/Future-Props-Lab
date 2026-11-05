import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";

const root = path.resolve(process.env.FPL_WEB_DIST_DIR || "dist");
const digest = (buffer) => createHash("sha256").update(buffer).digest("hex");
const files = [];
const precompress = process.env.FPL_STUDIO_PRECOMPRESS !== "0";
const publicRoots = new Set([
  "assets",
  "brand",
  "docs",
  "voice-vad",
  "providers",
  "presentation-templates",
]);
const pages = new Set([
  "index.html",
  "docs.html",
  "amadeus.html",
]);
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Release cannot contain symlinks");
    if (entry.isDirectory()) {
      walk(file);
      continue;
    }
    const name = path.relative(root, file).split(path.sep).join("/");
    if (
      name.startsWith(".vite/") ||
      ["build.json", "manifest.json"].includes(name) ||
      /\.(br|gz)$/.test(name)
    )
      continue;
    if (
      name.split("/").some((part) => part.startsWith(".")) ||
      (!pages.has(name) && !publicRoots.has(name.split("/")[0])) ||
      /\.(map|toml|sqlite|db|pem|key|py|ts|tsx)$/.test(name)
    )
      throw new Error(`Unexpected release file: ${name}`);
    const body = fs.readFileSync(file);
    files.push({ path: name, bytes: body.length, sha256: digest(body) });
    if (precompress && /\.(html|js|css|json|svg|txt|wasm)$/.test(name)) {
      for (const [extension, compressed] of [
        ["gz", gzipSync(body, { level: 9 })],
        [
          "br",
          brotliCompressSync(body, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 9 },
          }),
        ],
      ]) {
        if (compressed.length < body.length) {
          fs.writeFileSync(`${file}.${extension}`, compressed);
          files.push({
            path: `${name}.${extension}`,
            bytes: compressed.length,
            sha256: digest(compressed),
          });
        }
      }
    }
  }
}
walk(root);
files.sort((a, b) => a.path.localeCompare(b.path));
const build_id = digest(JSON.stringify(files));
fs.writeFileSync(
  path.join(root, "build.json"),
  JSON.stringify({ build_id }) + "\n",
);
const build = fs.readFileSync(path.join(root, "build.json"));
files.push({ path: "build.json", bytes: build.length, sha256: digest(build) });
fs.writeFileSync(
  path.join(root, "manifest.json"),
  JSON.stringify({ build_id, files }, null, 2) + "\n",
);

// HTML entry plus the one unconditional bootstrap import. SignedInApp remains deferred.
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, ".vite/manifest.json"), "utf8"),
);
const required = new Set();
function visit(key, bootstrap = false) {
  const chunk = manifest[key];
  if (!chunk || required.has(chunk.file)) return;
  required.add(chunk.file);
  for (const css of chunk.css || []) required.add(css);
  for (const imported of chunk.imports || []) visit(imported);
  if (bootstrap)
    for (const imported of chunk.dynamicImports || [])
      if (manifest[imported]?.name === "main") visit(imported);
}
visit("index.html", true);
const initialGzipBytes = [...required].reduce(
  (sum, name) =>
    sum + gzipSync(fs.readFileSync(path.join(root, name)), { level: 9 }).length,
  0,
);
const report = { build_id, initialGzipBytes, required: [...required].sort() };
console.log(JSON.stringify(report, null, 2));
if (initialGzipBytes > 300 * 1024)
  throw new Error(
    `Login compressed budget exceeded: ${initialGzipBytes} bytes`,
  );
fs.rmSync(path.join(root, ".vite"), { recursive: true });
