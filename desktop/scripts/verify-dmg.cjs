// Installation acceptance in a fresh temporary Applications-like directory.
const { mkdtempSync, mkdirSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const { verifyApp } = require("./verify-app.cjs");

if (!process.argv[2]) throw new Error("Usage: verify-dmg.cjs <dmg-path>");
const root = path.resolve(__dirname, "../..");
const directory = mkdtempSync(path.join(os.tmpdir(), "fpl-dmg-install-"));
const mount = path.join(directory, "volume");
const installed = path.join(directory, "Applications/Future Props Lab.app");
const evidence = path.join(root, "desktop/out/validation/dmg");
mkdirSync(mount);
execFileSync(
  "hdiutil",
  [
    "attach",
    "-nobrowse",
    "-readonly",
    "-mountpoint",
    mount,
    path.resolve(process.argv[2]),
  ],
  { stdio: "inherit" },
);
try {
  const source = path.join(mount, "Future Props Lab.app");
  execFileSync("ditto", [source, installed]);
  verifyApp(installed, evidence);
  execFileSync(process.execPath, [path.join(__dirname, "smoke.cjs")], {
    cwd: os.tmpdir(),
    stdio: "inherit",
    env: {
      ...process.env,
      FPL_TEST_APP_EXECUTABLE: path.join(
        installed,
        "Contents/MacOS/Future Props Lab",
      ),
      FPL_TEST_REPLACE_APP_FROM: source,
      FPL_TEST_EVIDENCE_DIR: evidence,
    },
  });
} finally {
  execFileSync("hdiutil", ["detach", mount], { stdio: "inherit" });
}
