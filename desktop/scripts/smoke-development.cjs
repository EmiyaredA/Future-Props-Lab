// Real Electron + Vite + Python; all business data and accounts are disposable.
const { spawn } = require("node:child_process");
const {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} = require("node:fs");
const { createServer } = require("node:net");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");
const root = path.resolve(__dirname, "../..");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      /* starting/restarting */
    }
    await pause(250);
  }
  throw new Error("Development smoke timed out");
}
async function main() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "fpl-hot-smoke-"));
  const probe = `development_probe_${randomUUID().replaceAll("-", "")}`;
  const files = [
    path.join(root, `desktop/backend/${probe}.py`),
    path.join(root, `desktop/src/${probe}.ts`),
    path.join(root, `web/src/${probe}.css`),
    path.join(root, `web/${probe}.html`),
    path.join(root, `web/src/${probe}.tsx`),
  ];
  const portServer = createServer().listen(0, "127.0.0.1");
  await once(portServer, "listening");
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  let child = spawn(
    path.join(root, ".venv/bin/python"),
    [
      "desktop/scripts/dev.py",
      "--test-data-dir",
      directory,
      "--test-port",
      String(port),
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "",
    browser,
    page;
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const connect = async () => {
    browser = await until(() =>
      chromium.connectOverCDP(`http://127.0.0.1:${port}`),
    );
    page = await until(() =>
      browser
        .contexts()[0]
        ?.pages()
        .find((p) => p.url().startsWith("http:")),
    );
    await page.waitForFunction(() =>
      Boolean(window.futurePropsDesktop?.developmentStatus),
    );
  };
  const state = () =>
    page.evaluate(() => window.futurePropsDesktop.developmentStatus());
  const pending = async (kind) =>
    until(async () => {
      const value = await state();
      return value.phase === "ready" && value.pending.includes(kind);
    });
  const apply = async () => {
    const before = (await state()).generation;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("future-props:development-apply")),
    );
    await until(async () => (await state()).generation > before);
  };
  try {
    await connect();
    await page.getByLabel("账号", { exact: true }).fill("hot-test");
    await page.getByLabel("显示名称", { exact: true }).fill("隔离热加载验收");
    await page
      .getByLabel("密码", { exact: true })
      .fill("Isolated-hot-test-29471!");
    await page
      .getByLabel("确认密码", { exact: true })
      .fill("Isolated-hot-test-29471!");
    await page.getByRole("button", { name: "创建管理员并进入" }).click();
    await page.waitForURL("**/home");
    if ((await state()).pending.length) {
      await pending("config");
      await apply();
    }
    const origin = new URL(page.url()).origin;
    await page.evaluate(() => window.futurePropsDesktop.enableAgent());
    const descriptor = () =>
      JSON.parse(
        readFileSync(path.join(directory, "agent/connection.json"), "utf8"),
      );
    const firstSocket = descriptor().socket_path;
    const duplicate = spawn(
      path.join(root, ".venv/bin/python"),
      ["desktop/scripts/dev.py", "--test-data-dir", directory],
      { cwd: root, stdio: "ignore" },
    );
    assert.equal((await once(duplicate, "exit"))[0], 1);
    assert.equal((await fetch(origin + "/ready")).status, 403);
    await page.evaluate(() => {
      window.__hotDraft = "unsaved-fixture";
    });
    writeFileSync(files[2], ":root { --development-probe: one; }\n");
    await page.evaluate(async (name) => {
      await import(`/src/${name}.css`);
    }, probe);
    writeFileSync(files[2], ":root { --development-probe: two; }\n");
    await until(() =>
      page.evaluate(
        () =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--development-probe")
            .trim() === "two",
      ),
    );
    assert.equal(
      await page.evaluate(() => window.__hotDraft),
      "unsaved-fixture",
    );
    console.log(
      "PASS CSS HMR preserves page state; gateway denies unauthenticated access",
    );
    const component = (label) => `import {createElement, useState} from "react";
import {createRoot} from "react-dom/client";
export default function DevelopmentProbe() { const [count, setCount] = useState(0); return createElement("button", {id:"fpl-development-probe", onClick:()=>setCount(count+1)}, "${label}:"+count); }
if (!document.getElementById("fpl-probe-container")) { const div=document.createElement("div"); div.id="fpl-probe-container"; document.body.append(div); createRoot(div).render(createElement(DevelopmentProbe)); }
`;
    writeFileSync(files[4], component("one"));
    await page.evaluate(async (name) => {
      await import(`/src/${name}.tsx`);
    }, probe);
    await page.locator("#fpl-development-probe").click();
    await until(
      async () =>
        (await page.locator("#fpl-development-probe").textContent()) ===
        "one:1",
    );
    writeFileSync(files[4], component("two"));
    await until(
      async () =>
        (await page.locator("#fpl-development-probe").textContent()) ===
        "two:1",
    );
    writeFileSync(
      files[3],
      "<!doctype html><title>isolated reload fixture</title>",
    );
    await pending("page");
    await page.evaluate(() => {
      window.__cancelReload = (event) => event.preventDefault();
      window.addEventListener(
        "future-props:before-workspace-switch",
        window.__cancelReload,
      );
    });
    await page.evaluate(() =>
      window.dispatchEvent(new Event("future-props:development-apply")),
    );
    assert.equal(
      await page.evaluate(() => window.__hotDraft),
      "unsaved-fixture",
    );
    await page.evaluate(() =>
      window.removeEventListener(
        "future-props:before-workspace-switch",
        window.__cancelReload,
      ),
    );
    await apply();
    await page.waitForURL("**/home");
    assert.equal(await page.evaluate(() => window.__hotDraft), undefined);
    await page.evaluate(() => {
      window.__hotDraft = "unsaved-fixture";
    });
    console.log(
      "PASS React Fast Refresh preserves component state; full reload waits for explicit guarded approval",
    );

    writeFileSync(files[0], "this is invalid python !!!\n");
    await until(async () => (await state()).phase === "error");
    assert.equal(
      await page.evaluate(async () => (await fetch("/ready")).status),
      200,
    );
    for (let i = 0; i < 8; i++) writeFileSync(files[0], `VALUE = ${i}\n`);
    await pending("backend");
    const before = (await state()).generation;
    await apply();
    assert.equal((await state()).generation, before + 1);
    assert.equal(new URL(page.url()).origin, origin);
    assert.notEqual(descriptor().socket_path, firstSocket);
    assert.equal(existsSync(firstSocket), false);
    assert.equal(
      (await page.evaluate(() => window.futurePropsDesktop.agentStatus()))
        .connected,
      true,
    );
    assert.equal(
      await page.evaluate(() => window.__hotDraft),
      "unsaved-fixture",
    );
    console.log(
      "PASS compile error recovery; burst coalescing; manual backend restart preserves origin and draft",
    );

    // The exact cancelable event is also exercised against real editor guards in component tests.
    await page.evaluate(() => {
      window.__cancelUpdate = (event) => event.preventDefault();
      window.addEventListener(
        "future-props:before-workspace-switch",
        window.__cancelUpdate,
      );
    });
    writeFileSync(files[1], "export const fixture = 1;\n");
    await pending("desktop");
    await page.evaluate(() =>
      window.dispatchEvent(new Event("future-props:development-apply")),
    );
    await pause(600);
    assert.equal(
      await page.evaluate(() => window.__hotDraft),
      "unsaved-fixture",
    );
    assert((await state()).pending.includes("desktop"));
    await page.evaluate(() =>
      window.removeEventListener(
        "future-props:before-workspace-switch",
        window.__cancelUpdate,
      ),
    );
    const closed = page.waitForEvent("close");
    await page.evaluate(() =>
      window.dispatchEvent(new Event("future-props:development-apply")),
    );
    await closed;
    await connect();
    await page.waitForURL("**/home");
    await until(async () => (await state()).phase === "ready");
    assert.equal(
      await page.evaluate(async () => (await fetch("/ready")).status),
      200,
    );
    console.log(
      "PASS unsaved cancellation keeps old runtime; Electron restart restores route and login",
    );
    await page.evaluate(() => {
      window.__cancelQuit = (event) => event.preventDefault();
      window.addEventListener(
        "future-props:before-workspace-switch",
        window.__cancelQuit,
      );
    });
    child.kill("SIGTERM");
    await pause(700);
    assert.equal(child.exitCode, null);
    assert.equal(
      await page.evaluate(async () => (await fetch("/ready")).status),
      200,
    );
    await page.evaluate(() =>
      window.removeEventListener(
        "future-props:before-workspace-switch",
        window.__cancelQuit,
      ),
    );
    child.kill("SIGTERM");
    await until(() => child.exitCode !== null);
    console.log("PASS normal quit cleans up the developer session");
    assert.equal(
      existsSync(path.join(directory, "agent/connection.json")),
      false,
    );
    await browser.close();
    child = spawn(
      path.join(root, ".venv/bin/python"),
      [
        "desktop/scripts/dev.py",
        "--test-data-dir",
        directory,
        "--test-port",
        String(port),
      ],
      { cwd: root, stdio: "ignore" },
    );
    await connect();
    await page.waitForURL("**/home");
    const orphanOrigin = new URL(page.url()).origin;
    const orphanPid = descriptor().pid;
    child.kill("SIGKILL"); // Only the disposable launcher: simulate unexpected parent death.
    await until(async () => {
      try {
        await fetch(orphanOrigin + "/ready");
        return false;
      } catch {
        return !existsSync(path.join(directory, "agent/connection.json"));
      }
    }, 20000);
    await until(() => {
      try {
        process.kill(orphanPid, 0);
        return false;
      } catch {
        return true;
      }
    }, 20000);
    console.log(
      "PASS parent crash closes gateway and Agent socket without touching another App",
    );
  } catch (error) {
    console.error(output.slice(-8000));
    throw error;
  } finally {
    for (const file of files) rmSync(file, { force: true });
    await browser?.close().catch(() => {});
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    await until(
      () => child.exitCode !== null || child.signalCode !== null,
      15000,
    ).catch(() => child.kill("SIGKILL"));
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
