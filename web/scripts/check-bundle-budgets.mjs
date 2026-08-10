import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";

const dist = path.resolve("dist/assets");
const jsLimit = 500 * 1024;
const cssLimit = 150 * 1024;
const cssTarget = 140 * 1024;

function splitCss(file) {
  const source = fs.readFileSync(file, "utf8");
  if (Buffer.byteLength(source) <= cssLimit) return;
  const root = postcss.parse(source, { from: file });
  const chunks = [];
  let current = [];
  let currentBytes = 0;
  for (const node of root.nodes) {
    const text = node.toString();
    const bytes = Buffer.byteLength(text) + 2;
    if (bytes > cssTarget) {
      throw new Error(`CSS top-level rule exceeds budget: ${path.basename(file)}`);
    }
    if (current.length && currentBytes + bytes > cssTarget) {
      chunks.push(current.join("\n"));
      current = [];
      currentBytes = 0;
    }
    current.push(text);
    currentBytes += bytes;
  }
  if (current.length) chunks.push(current.join("\n"));

  const extension = path.extname(file);
  const stem = path.basename(file, extension);
  const imports = chunks.map((content, index) => {
    const part = `${stem}.part-${String(index + 1).padStart(2, "0")}${extension}`;
    fs.writeFileSync(path.join(path.dirname(file), part), `${content}\n`);
    return `@import url("./${part}");`;
  });
  fs.writeFileSync(file, `${imports.join("\n")}\n`);
}

for (const entry of fs.readdirSync(dist)) {
  if (entry.endsWith(".css")) splitCss(path.join(dist, entry));
}

const violations = [];
for (const entry of fs.readdirSync(dist)) {
  const file = path.join(dist, entry);
  const size = fs.statSync(file).size;
  if (entry.endsWith(".js") && size > jsLimit)
    violations.push(`${entry}: ${(size / 1024).toFixed(1)} KiB JS`);
  if (entry.endsWith(".css") && size > cssLimit)
    violations.push(`${entry}: ${(size / 1024).toFixed(1)} KiB CSS`);
}
if (violations.length) {
  throw new Error(`Bundle budget exceeded:\n${violations.join("\n")}`);
}
