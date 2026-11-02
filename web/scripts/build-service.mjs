import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";

import { serviceAssets } from "./service-assets.mjs";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const web = path.join(repo, "web");
const service = process.argv[2];
if (!["agents", "portal", "assets", "management"].includes(service))
  throw new Error("This service has no independent browser entry yet");
const digest = (value) => createHash("sha256").update(value).digest("hex");
function walk(directory, prefix = "") {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      if (entry.isSymbolicLink())
        throw new Error("Program sources cannot contain symlinks");
      const name = prefix + entry.name;
      return entry.isDirectory()
        ? walk(path.join(directory, entry.name), name + "/")
        : [name];
    });
}
const sources = walk(path.join(web, "src")).map((name) => "web/src/" + name);
sources.push(...serviceAssets[service].map((name) => "web/public/" + name));
sources.push(
  "web/scripts/build-service.mjs",
  "web/scripts/service-assets.mjs",
  "web/mathFontData.ts",
  "web/chunkGraph.ts",
  "web/tsconfig.json",
  "web/package.json",
);
sources.push(
  "package-lock.json",
  "web/service.config.ts",
  "web/vite.config.ts",
  "web/" + service + ".html",
);
const id = digest(
  sources
    .sort()
    .map((name) => name + ":" + digest(fs.readFileSync(path.join(repo, name))))
    .join("\n"),
).slice(0, 20);
const output = path.join(repo, ".local/service-web", service, id);
execFileSync("git", ["check-ignore", "--quiet", output], { cwd: repo });
if (fs.existsSync(output)) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(output, "build.json"), "utf8"),
  );
  if (
    manifest.service !== service ||
    manifest.build_id !== id ||
    !manifest.files.every((file) => {
      const body = fs.readFileSync(path.join(output, file.path));
      return body.length === file.bytes && digest(body) === file.sha256;
    })
  )
    throw new Error("Existing immutable program build is invalid");
  console.log(
    JSON.stringify({ service, build_id: id, root: output, reused: true }),
  );
  process.exit(0);
}
const result = spawnSync(
  process.execPath,
  [
    path.join(repo, "node_modules/vite/bin/vite.js"),
    "build",
    "--config",
    "service.config.ts",
    "--mode",
    "studio",
  ],
  {
    cwd: web,
    stdio: "inherit",
    env: {
      ...process.env,
      FPL_WEB_SERVICE: service,
      FPL_WEB_BUILD_ID: id,
      FPL_WEB_DIST_DIR: output,
    },
  },
);
if (result.status !== 0) process.exit(result.status || 1);
fs.rmSync(path.join(output, ".vite"), { recursive: true, force: true });
const files = [];
for (const name of walk(output)) {
  if (
    name.split("/").some((part) => part.startsWith(".")) ||
    /\.(map|toml|db|pem|key|py|ts|tsx)$/.test(name)
  )
    throw new Error("Unexpected program file: " + name);
  const body = fs.readFileSync(path.join(output, name));
  files.push({ path: name, bytes: body.length, sha256: digest(body) });
  if (/\.(js|css|html|svg|json)$/.test(name)) {
    for (const [extension, compressed] of [
      ["gz", gzipSync(body, { level: 9, mtime: 0 })],
      [
        "br",
        brotliCompressSync(body, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 9 },
        }),
      ],
    ]) {
      if (compressed.length < body.length) {
        fs.writeFileSync(path.join(output, name + "." + extension), compressed);
        files.push({
          path: name + "." + extension,
          bytes: compressed.length,
          sha256: digest(compressed),
        });
      }
    }
  }
}
files.sort((a, b) => a.path.localeCompare(b.path));
const apiHash = execFileSync(
  "uv",
  ["run", "python", "scripts/website/web_contract.py", service],
  { cwd: repo, encoding: "utf8" },
).trim();
const manifest = {
  api_sha256: apiHash,
  version: 1,
  service,
  build_id: id,
  entry: service + ".html",
  files,
};
fs.writeFileSync(
  path.join(output, "build.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({ service, build_id: id, root: output, files: files.length }),
);
