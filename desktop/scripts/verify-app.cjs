// Read-only validation of the final signed App; manifest lives OUTSIDE the signature.
const { execFileSync } = require("node:child_process");
const {
  readdirSync,
  statSync,
  readFileSync,
  lstatSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");

function verifyApp(appPath, outputDir) {
  const run = (command, args) =>
    execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  run("codesign", ["--verify", "--deep", "--strict", appPath]);
  const infoPlist = path.join(appPath, "Contents/Info.plist");
  const iconName = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIconFile",
    infoPlist,
  ]).trim();
  if (!iconName) throw new Error("Missing CFBundleIconFile");
  const iconFile = path.join(
    appPath,
    "Contents/Resources",
    iconName.endsWith(".icns") ? iconName : `${iconName}.icns`,
  );
  if (!existsSync(iconFile))
    throw new Error(`Missing desktop icon resource: ${iconFile}`);
  const expectedIcon = path.join(__dirname, "../assets/app-icon.icns");
  const digest = (file) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  if (digest(iconFile) !== digest(expectedIcon))
    throw new Error("Packaged desktop icon does not match the project icon");
  const inventory = [];
  function visit(directory) {
    for (const entry of readdirSync(directory)) {
      const file = path.join(directory, entry);
      if (lstatSync(file).isSymbolicLink()) continue;
      if (statSync(file).isDirectory()) {
        visit(file);
        continue;
      }
      const relative = path.relative(appPath, file);
      if (
        [".env", "future-props.db"].includes(entry) ||
        relative.split(path.sep).includes(".runtime")
      )
        throw new Error(`Forbidden resource: ${relative}`);
      const kind = run("file", ["-b", file]);
      if (kind.includes("Mach-O")) {
        if (!run("lipo", ["-archs", file]).includes("arm64"))
          throw new Error(`Not arm64: ${relative}`);
        if (
          /\/opt\/homebrew\/|\/usr\/local\//.test(
            run("otool", ["-m", "-L", file]),
          )
        )
          throw new Error(`External library: ${relative}`);
      }
      inventory.push({
        path: relative,
        bytes: statSync(file).size,
        sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
      });
    }
  }
  visit(appPath);
  const executable = path.join(
    appPath,
    "Contents/Resources/fpl-server/fpl-server",
  );
  const native = JSON.parse(
    execFileSync(executable, ["--self-test-resources"], {
      cwd: "/tmp",
      env: { PATH: "/usr/bin:/bin" },
      encoding: "utf8",
    }),
  );
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    path.join(outputDir, "app-manifest.json"),
    JSON.stringify(
      {
        app: path.basename(appPath),
        signing: "ad-hoc, not notarized",
        icon: path.relative(appPath, iconFile),
        native,
        inventory,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Validated ${inventory.length} signed App resources and native exports`,
  );
}
module.exports = { verifyApp };
if (require.main === module) {
  if (!process.argv[2] || !process.argv[3])
    throw new Error("Usage: verify-app.cjs <app-path> <output-dir>");
  verifyApp(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
}
