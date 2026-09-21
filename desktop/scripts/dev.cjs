// Watches and compiles source; only a window's explicit Apply updates running processes.
const { spawn } = require("node:child_process");
const {
  watch,
  mkdirSync,
  mkdtempSync,
  cpSync,
  rmSync,
  readFileSync,
} = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");
const { once } = require("node:events");
const root = path.resolve(__dirname, "../..");
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const dataDir = argument("--data-dir");
const lease = Number(argument("--lock-fd"));
const live = process.argv.includes("--live");
const testPort = process.argv.includes("--test-port")
  ? argument("--test-port")
  : null;
const python = path.join(root, ".venv/bin/python");
mkdirSync(path.join(root, "desktop/.dev-pending"), { recursive: true });
const compiled = mkdtempSync(path.join(root, "desktop/.dev-pending/session-"));
const viteCache = mkdtempSync(path.join(root, "desktop/.dev-pending/vite-"));
const compileArgs = [
  path.join(root, "node_modules/typescript/bin/tsc"),
  "-p",
  "desktop/tsconfig.json",
  "--outDir",
  compiled,
  "--noEmitOnError",
];
let electron,
  vite,
  applying = false,
  rebuilding = false,
  revision = 0;
let pending = new Set(),
  watchers = [],
  timer,
  restorePath = "/";
const versions = new Map();
const configFingerprint = () => {
  try {
    return createHash("sha256")
      .update(readFileSync(path.join(dataDir, "backend/config.toml")))
      .digest("hex");
  } catch {
    return null;
  }
};
let configDigest = configFingerprint();
let loadedDigest = "";
let state = {
  live,
  pending: [],
  phase: "ready",
  message: "页面修改即时更新",
  generation: 0,
};

function send(type, value = {}) {
  if (electron?.connected) electron.send({ type, ...value });
}
function publish(phase = "ready", message = "检测到更新，点击应用") {
  state = { ...state, pending: [...pending], phase, message };
  send("state", { state });
}
function command(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe", lease],
      ...options,
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(output) : reject(new Error(output || "检查失败")),
    );
  });
}
function dataCommand(action) {
  return command(python, [
    path.join(root, "desktop/backend/development_data.py"),
    "--data-dir",
    dataDir,
    "--lock-fd",
    "3",
    ...(live ? ["--live"] : []),
    ...(action === "remember" ? ["--config-digest", loadedDigest] : []),
    action,
  ]);
}
async function checkAndCompile() {
  if (rebuilding || applying) return;
  rebuilding = true;
  const checkedRevision = revision;
  publish("checking", "正在检查修改…");
  try {
    if (pending.has("backend"))
      await command(python, [
        path.join(root, "desktop/scripts/check_python.py"),
      ]);
    if (pending.has("desktop")) await command(process.execPath, compileArgs);
    await dataCommand("check");
    publish("ready");
  } catch (error) {
    // Configuration diagnostics are deliberately value-free; compiler output stays in the terminal.
    console.error(error.message);
    publish("error", "检查未通过，请查看终端；修复后会重新检查");
  } finally {
    rebuilding = false;
    if (revision !== checkedRevision) void checkAndCompile();
  }
}
function changed(kind) {
  pending.add(kind);
  revision += 1;
  versions.set(kind, revision);
  clearTimeout(timer);
  timer = setTimeout(() => void checkAndCompile(), 350);
}
function waitMessage(type) {
  return new Promise((resolve, reject) => {
    const owned = electron;
    const timeout = setTimeout(() => finish(new Error("更新等待超时")), 120000);
    const listener = (message) => {
      if (message.type === type) finish(null, message);
    };
    const exited = () => finish(new Error("开发窗口已退出"));
    function finish(error, value) {
      clearTimeout(timeout);
      owned.off("message", listener);
      owned.off("exit", exited);
      if (error) reject(error);
      else resolve(value);
    }
    owned.on("message", listener);
    owned.once("exit", exited);
  });
}
async function apply() {
  if (applying || rebuilding || state.phase !== "ready" || !pending.size)
    return;
  applying = true;
  const batch = new Set(pending),
    checkedRevision = revision;
  const appliedVersions = new Map(versions);
  publish("applying", "正在应用更新…");
  try {
    if (batch.has("backend"))
      await command(python, [
        path.join(root, "desktop/scripts/check_python.py"),
      ]);
    await dataCommand("check");
    if (checkedRevision !== revision)
      throw new Error("检查期间源码再次变化，请重新应用");
    const needsStop =
      batch.has("backend") || batch.has("config") || batch.has("desktop");
    if (needsStop) {
      const stopped = waitMessage("backend-stopped");
      send("stop-backend");
      await stopped;
    }
    if (batch.has("config")) console.log((await dataCommand("backup")).trim());
    if (batch.has("desktop")) {
      const exited = once(electron, "exit");
      send("restart");
      await exited;
      const ready = launchElectron();
      await ready;
    } else {
      const done = waitMessage("updated");
      send("update", {
        restartBackend: needsStop,
        reloadPage: batch.has("page"),
      });
      const result = await done;
      if (!result.success) throw new Error("后端启动失败");
      if (result.configDigest) loadedDigest = result.configDigest;
    }
    await dataCommand("remember");
    for (const kind of batch)
      if (versions.get(kind) === appliedVersions.get(kind))
        pending.delete(kind);
    state.generation += 1;
    publish("ready", pending.size ? "仍有新修改待应用" : "更新已应用");
  } catch (error) {
    console.error(error.message);
    publish("error", "更新未完成，修复后点击重新检查；数据保持原位");
  } finally {
    applying = false;
    if (revision !== checkedRevision) void checkAndCompile();
  }
}
function launchElectron() {
  const executable = require("electron");
  const running = mkdtempSync(path.join(root, "desktop/.dev-run-"));
  cpSync(compiled, running, { recursive: true });
  const env = {
    ...process.env,
    FPL_DEV_SESSION: "1",
    FPL_DEV_DATA_DIR: dataDir,
    FPL_DEV_LIVE: live ? "1" : "0",
    FPL_DEV_VITE_URL: vite.resolvedUrls.local[0].replace(/\/$/, ""),
    FPL_DEV_RESTORE_PATH: restorePath,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = spawn(
    executable,
    [
      ...(testPort && !live ? [`--remote-debugging-port=${testPort}`] : []),
      path.join(running, "main.js"),
    ],
    {
      cwd: root,
      detached: true,
      stdio: ["inherit", "inherit", "inherit", "ipc", lease],
      env,
    },
  );
  electron.on("message", (message) => {
    if (message.type === "ready") {
      if (message.configDigest) loadedDigest = message.configDigest;
      send("state", { state });
      if (message.success)
        console.log(
          `开发窗口已就绪 · ${live ? "正式数据" : "开发数据"} · ${dataDir}`,
        );
      if (message.success)
        void dataCommand("remember").catch(() =>
          publish("error", "配置快照保存失败，请检查权限"),
        );
    }
    if (message.type === "backend-crashed") changed("backend");
    if (message.type === "apply") void apply();
    if (message.type === "check") void checkAndCompile();
    if (
      message.type === "location" &&
      typeof message.path === "string" &&
      message.path.startsWith("/") &&
      !message.path.startsWith("//")
    )
      restorePath = message.path;
  });
  electron.on("exit", () => {
    rmSync(running, { recursive: true, force: true });
    if (!applying) void close();
  });
  return waitMessage("ready").then((message) => {
    if (!message.success) {
      pending.add("backend");
      publish("error", "开发后端启动失败，请修复后重试");
      if (applying) throw new Error("开发后端启动失败，请修复后重试");
    }
  });
}
async function close() {
  clearTimeout(timer);
  watchers.forEach((watcher) => watcher.close());
  await vite?.close();
  rmSync(compiled, { recursive: true, force: true });
  rmSync(viteCache, { recursive: true, force: true });
  process.exit(0);
}
async function main() {
  await command(process.execPath, compileArgs);
  const previousTermListeners = new Set(process.listeners("SIGTERM"));
  const { createServer } = await import("vite");
  vite = await createServer({
    root: path.join(root, "web"),
    configFile: path.join(root, "web/vite.config.ts"),
    mode: "desktop",
    cacheDir: path.join(viteCache, "node_modules/.vite"),
    server: {
      host: "127.0.0.1",
      port: 0,
      proxy: {},
      fs: {
        deny: [
          "**/.env*",
          "**/config.toml",
          "**/.runtime/**",
          "**/.git/**",
          "**/.venv/**",
        ],
      },
    },
  });
  // Vite full reloads must travel through the editor's unsaved-change guard.
  const channel = vite.environments.client.hot;
  const originalSend = channel.send.bind(channel);
  channel.send = (payload, ...rest) => {
    if (payload?.type === "full-reload") {
      changed("page");
      return;
    }
    originalSend(payload, ...rest);
  };
  await vite.listen();
  // Vite's standalone SIGTERM handler exits immediately. This supervisor owns shutdown
  // and calls vite.close() only after Electron's unsaved-change guard approves quitting.
  for (const listener of process.listeners("SIGTERM"))
    if (!previousTermListeners.has(listener))
      process.removeListener("SIGTERM", listener);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => send("quit"));
  mkdirSync(path.join(dataDir, "backend"), { recursive: true, mode: 0o700 });
  for (const [directory, kind, accept] of [
    ["backend", "backend", (name) => name.endsWith(".py")],
    ["db", "backend", (name) => name.endsWith(".py")],
    ["desktop/src", "desktop", (name) => name.endsWith(".ts")],
    ["desktop/backend", "backend", (name) => name.endsWith(".py")],
    [path.join(dataDir, "backend"), "config", (name) => name === "config.toml"],
  ])
    watchers.push(
      watch(
        path.resolve(root, directory),
        { recursive: true },
        (_event, file) => {
          if (file && accept(String(file))) {
            if (kind === "config") {
              const next = configFingerprint();
              if (next === configDigest) return;
              const initial = configDigest === null && next !== null;
              configDigest = next;
              if (initial) return; // Initial bootstrap, not a replacement of loaded configuration.
            }
            changed(kind);
          }
        },
      ),
    );
  await launchElectron();
  setInterval(() => {
    try {
      process.kill(Number(process.env.FPL_DEV_PARENT_PID), 0);
    } catch {
      electron?.disconnect();
      void close();
    }
  }, 1000).unref();
}
main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
