import { execFileSync } from "node:child_process";

const protectedPaths = [
  "web/src/docs",
  "web/public/docs",
  "docs/architecture/documentation-coverage.md",
  "scripts/generate_sdk_docs.py",
];

const baseRef = process.env.DOCS_CENTER_BASE_REF?.trim();
const isProtected = (path) => protectedPaths.some(
  (root) => path === root || path.startsWith(root + "/"),
);
let changed = "";
try {
  if (baseRef) {
    const commits = execFileSync("git", ["rev-list", "--reverse", `${baseRef}..HEAD`], {
      encoding: "utf8",
    }).trim().split("\n").filter(Boolean);
    for (const commit of commits) {
      const parents = execFileSync("git", ["rev-list", "--parents", "-n", "1", commit], {
        encoding: "utf8",
      }).trim().split(" ");
      // Normal merges have no combined diff; conflict resolutions still need checking.
      const paths = execFileSync("git", [
        "diff-tree", "--no-commit-id", "--name-only", "-z", "-r",
        ...(parents.length > 2 ? ["--cc"] : []), commit,
      ], { encoding: "utf8" }).split("\0").filter(Boolean);
      if (paths.some(isProtected) && paths.some((path) => !isProtected(path))) {
        changed += `${commit}: ${paths.join(", ")}\n`;
      }
    }
  } else {
    changed = execFileSync("git", ["diff", "--name-only", "--", ...protectedPaths], {
      encoding: "utf8",
    }).trim();
  }
} catch (error) {
  console.error("无法检查文档中心保护路径：Git 提交检查失败。");
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
    ? `ok: protected docs-center commits are isolated since ${baseRef}`
    : "ok: no protected docs-center paths changed in the working tree",
);
