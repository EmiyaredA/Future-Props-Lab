import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";

const sourcePath = path.resolve(
  "web/src/features/galgame-workshop/galgame-workshop.css",
);
const outputDir = path.resolve(
  "web/src/features/galgame-workshop/styles",
);
const source = fs.readFileSync(sourcePath, "utf8");
const root = postcss.parse(source, { from: sourcePath });
const chunks = [];
let current = [];
let currentLines = 0;

for (const node of root.nodes) {
  const text = node.toString();
  const lines = text.split("\n").length + 1;
  if (current.length && currentLines + lines > 1800) {
    chunks.push(current.join("\n\n"));
    current = [];
    currentLines = 0;
  }
  current.push(text);
  currentLines += lines;
}
if (current.length) chunks.push(current.join("\n\n"));

fs.mkdirSync(outputDir, { recursive: true });
for (const entry of fs.readdirSync(outputDir)) {
  if (/^part-\d+\.css$/.test(entry)) fs.unlinkSync(path.join(outputDir, entry));
}
const imports = [];
chunks.forEach((content, index) => {
  const filename = `part-${String(index + 1).padStart(2, "0")}.css`;
  fs.writeFileSync(path.join(outputDir, filename), `${content}\n`);
  imports.push(`@import "./styles/${filename}";`);
});
fs.writeFileSync(sourcePath, `${imports.join("\n")}\n`);
