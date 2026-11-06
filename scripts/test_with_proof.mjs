import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const local = join(root, ".local/test-with-proof");
const [command, ...args] = process.argv.slice(2);

function run(program, argv, options) {
  const result = spawnSync(program, argv, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (command === "playwright") {
  if (args.includes("--version")) {
    run(process.execPath, [
      join(root, "node_modules/@playwright/test/cli.js"),
      "--version",
    ]);
  } else {
    if (!process.env.TWP_EVENTS)
      throw new Error("Use TestWithProof to start this runner.");
    const sandbox = mkdtempSync(join(realpathSync(local), "browser-"));
    const config = join(sandbox, "config.toml");
    writeFileSync(
      config,
      "[agent_workbench]\nenabled = false\n[cloud_control]\nenabled = false\n",
    );
    const webPort = process.env.FPL_TWP_WEB_PORT || "13131";
    const apiPort = process.env.FPL_TWP_API_PORT || "19131";
    for (const port of [webPort, apiPort]) {
      if (!/^\d{4,5}$/.test(port) || Number(port) > 65535)
        throw new Error("Invalid test port");
    }
    const env = Object.fromEntries(
      ["PATH", "HOME", "TMPDIR", "LANG", "TWP_EVENTS", "TWP_REPORT"].map(
        (key) => [key, process.env[key]],
      ),
    );
    Object.assign(env, {
      FPL_E2E_CONFIG_FILE: config,
      FPL_E2E_DATABASE_PATH: join(sandbox, "test.db"),
      FPL_E2E_AUTH_STATE: join(sandbox, "auth.json"),
      FPL_E2E_API_PORT: apiPort,
      FPL_E2E_WEB_PORT: webPort,
      FPL_E2E_WEB_COMMAND: `npm run dev -- --port ${webPort} --strictPort`,
      FPL_E2E_CHROME_PATH: process.env.FPL_TWP_CHROME_PATH,
    });
    run(
      process.execPath,
      [
        join(root, "node_modules/@playwright/test/cli.js"),
        "test",
        "--config",
        "playwright.test-with-proof.config.ts",
        ...args,
      ],
      { cwd: join(root, "web"), env },
    );
  }
} else {
  const ignored = spawnSync(
    "git",
    ["check-ignore", ".local/test-with-proof/.testwithproof/runs"],
    { cwd: root },
  );
  if (ignored.status !== 0)
    throw new Error("TestWithProof output directory must be ignored by Git.");
  mkdirSync(join(local, ".testwithproof"), { recursive: true });
  copyFileSync(
    join(root, "web/e2e/test-with-proof.catalog.yaml"),
    join(local, ".testwithproof/catalog.yaml"),
  );
  writeFileSync(
    join(local, "testwithproof.config.ts"),
    `export default ${JSON.stringify(
      {
        name: "Future Props Lab",
        root: "../..",
        executors: {
          browser: {
            type: "playwright",
            command: process.execPath,
            args: ["scripts/test_with_proof.mjs", "playwright"],
            dependencies: "real",
            timeoutMs: 480000,
          },
        },
      },
      null,
      2,
    )};\n`,
  );
  run(
    "twp",
    ["--project", local, ...(command ? [command, ...args] : ["--help"])],
    { cwd: root },
  );
}
