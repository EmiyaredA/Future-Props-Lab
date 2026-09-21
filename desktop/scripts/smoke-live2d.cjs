// Real Electron window navigation and persistence, exclusively disposable data.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { createServer } = require("node:net");
const { once } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const root = path.resolve(__dirname, "../..");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      /* startup */
    }
    await pause(300);
  }
  throw new Error("Live2D desktop startup timed out");
}
async function main() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "fpl-live2d-desktop-"));
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const child = spawn(
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
    browser;
  child.stdout.on("data", (data) => (output += data));
  child.stderr.on("data", (data) => (output += data));
  try {
    browser = await until(() =>
      chromium.connectOverCDP(`http://127.0.0.1:${port}`),
    );
    const context = browser.contexts()[0];
    const page = await until(() =>
      context.pages().find((p) => p.url().startsWith("http:")),
    );
    await page.getByLabel("账号", { exact: true }).fill("live2d-test");
    await page.getByLabel("显示名称", { exact: true }).fill("角色工坊隔离验收");
    await page
      .getByLabel("密码", { exact: true })
      .fill("Live2D-local-test-47391!");
    await page
      .getByLabel("确认密码", { exact: true })
      .fill("Live2D-local-test-47391!");
    await page.getByRole("button", { name: "创建管理员并进入" }).click();
    await page.waitForURL("**/home");
    await page.goto(new URL("/apps/live2d-workshop", page.url()).href);
    await page
      .getByRole("button", { name: "新建角色", exact: true })
      .click({ timeout: 30000 });
    await page.getByLabel("项目名称").fill("桌面角色验收");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    const editor = await until(() =>
      context
        .pages()
        .find((p) => p.url().includes("/live2d-workshop/projects/")),
    );
    await expect(editor.locator(".l2-editor")).toBeVisible({ timeout: 30000 });
    await editor
      .locator('input[type="file"]')
      .setInputFiles(
        path.join(root, "web/public/brand/live2d-workshop-mark.png"),
      );
    await expect(editor.locator(".l2-tree-name")).toHaveCount(1, {
      timeout: 30000,
    });
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(editor.locator(".l2-title")).toContainText("已保存");
    await editor.reload();
    await expect(editor.locator(".l2-tree-name")).toHaveCount(1, {
      timeout: 30000,
    });
    const screenshot = path.join(os.tmpdir(), "fpl-live2d-desktop-smoke.png");
    await editor.screenshot({ path: screenshot });
    console.log(
      `PASS isolated Electron entry, editor window, import and saved reopen: ${screenshot}`,
    );
  } catch (error) {
    console.error(output.slice(-7000));
    throw error;
  } finally {
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
