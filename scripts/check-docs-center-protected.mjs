import { execFileSync } from "node:child_process";

const protectedPaths = [
  "web/src/docs",
  "web/public/docs",
  "docs/architecture/documentation-coverage.md",
  "scripts/generate_sdk_docs.py",
];

const baseRef = process.env.DOCS_CENTER_BASE_REF?.trim();
const args = ["diff", "--name-only"];
if (baseRef) args.push(baseRef, "HEAD");
args.push("--", ...protectedPaths);

let changed;
try {
  changed = execFileSync("git", args, { encoding: "utf8" }).trim();
} catch (error) {
  console.error("无法检查文档中心保护路径：Git diff 执行失败。");
  if (error?.stderr) console.error(String(error.stderr));
  process.exit(1);
}

let untracked;
try {
  untracked = execFileSync("git", ["status", "--short", "--untracked-files=all", "--", ...protectedPaths], {
    encoding: "utf8",
  }).trim();
} catch (error) {
  console.error("无法检查文档中心保护路径：Git status 执行失败。");
  if (error?.stderr) console.error(String(error.stderr));
  process.exit(1);
}

if (changed || untracked) {
  console.error("文档中心保护路径发生变更：");
  if (changed) console.error(changed);
  if (untracked) console.error(untracked);
  console.error("请将文档中心内容变更与 Agent Note 整理分开提交。");
  process.exit(1);
}

console.log(
  baseRef
    ? `ok: no protected docs-center paths changed since ${baseRef}`
    : "ok: no protected docs-center paths changed in the working tree",
);
