// Real Electron + Vite + Python, with disposable account and database.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { createServer } = require("node:net");
const { once } = require("node:events");
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
      const result = await fn();
      if (result) return result;
    } catch { /* startup */ }
    await pause(250);
  }
  throw new Error("Amadeus desktop smoke timed out");
}

async function main() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "fpl-amadeus-smoke-"));
  const listener = createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(path.join(root, ".venv/bin/python"), [
    "desktop/scripts/dev.py", "--test-data-dir", directory, "--test-port", String(port),
  ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  let browser;
  try {
    browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`));
    const page = await until(() => browser.contexts()[0]?.pages().find((item) =>
      item.url().startsWith("http:") && !item.url().includes("amadeus.html")));
    await page.waitForFunction(() => Boolean(window.futurePropsDesktop?.openAmadeus));
    await page.getByLabel("账号", { exact: true }).fill("amadeus-smoke");
    await page.getByLabel("显示名称", { exact: true }).fill("Amadeus 隔离验收");
    await page.getByLabel("密码", { exact: true }).fill("Isolated-amadeus-smoke-29471!");
    await page.getByLabel("确认密码", { exact: true }).fill("Isolated-amadeus-smoke-29471!");
    await page.getByRole("button", { name: "创建管理员并进入" }).click();
    await page.waitForURL("**/home");

    await page.getByRole("button", { name: "打开 Amadeus" }).click();
    const assistant = await until(() => browser.contexts()[0]?.pages().find((item) =>
      item.url().includes("/amadeus.html")));
    await assistant.getByRole("heading", { name: "你好，我是 Amadeus" }).waitFor();
    await assistant.locator('[data-avatar-renderer="model"]').first().waitFor();
    assert.equal(await assistant.locator('[data-avatar-state="idle"]').count(), 2);
    assert.equal(await assistant.evaluate(() => window.futurePropsDesktop.amadeusAlwaysOnTop()), true);
    await assistant.getByRole("button", { name: "取消悬浮置顶" }).click();
    assert.equal(await assistant.evaluate(() => window.futurePropsDesktop.amadeusAlwaysOnTop()), false);
    assert.equal(
      await assistant.getByRole("button", { name: "保持悬浮在应用上方" }).getAttribute("aria-pressed"),
      "false",
    );
    await assistant.getByRole("button", { name: "保持悬浮在应用上方" }).click();
    assert.equal(await assistant.evaluate(() => window.futurePropsDesktop.amadeusAlwaysOnTop()), true);
    assert.equal(
      await assistant.getByRole("button", { name: "取消悬浮置顶" }).getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("button", { name: "打开 Amadeus" }).click();
    assert.equal(browser.contexts()[0].pages().filter((item) =>
      item.url().includes("/amadeus.html")).length, 1);
    assert.equal(await assistant.getByRole("button", { name: "选择模型" }).count(), 1);
    assert.equal(await assistant.getByRole("button", { name: "选取控件" }).count(), 1);
    if (process.env.FPL_AMADEUS_SCREENSHOT)
      await assistant.screenshot({ path: process.env.FPL_AMADEUS_SCREENSHOT });
    await assistant.getByRole("button", { name: "关闭窗口" }).click();
    await page.getByRole("button", { name: "打开 Amadeus" }).click();
    assert.equal(browser.contexts()[0].pages().filter((item) =>
      item.url().includes("/amadeus.html")).length, 1);
    await assistant.getByRole("button", { name: "历史对话" }).click();
    await assistant.getByRole("button", { name: "新建对话", exact: true }).click();
    await assistant.getByRole("button", { name: "能力", exact: true }).click();
    await assistant.getByText("工具 API", { exact: false }).first().waitFor();
    await assistant.getByRole("button", { name: "关闭能力配置" }).click();
    await assistant.getByRole("button", { name: "会话文件", exact: true }).click();
    await assistant.getByText("暂无文件").waitFor();
    await assistant.getByRole("button", { name: "收起会话文件" }).click();
    await assistant.getByRole("button", { name: "历史对话" }).click();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("future-props:amadeus-context", {
      detail: { path: "/demo/visual", application: "视觉创作工坊", projectId: "sample-project",
        title: "示例画布", selection: { id: "node-1", name: "开场画面", value: "图像" }, unsaved: true },
    })));
    await until(async () => (await assistant.evaluate(() => window.futurePropsDesktop.amadeusContexts()))
      .some((item) => item.projectId === "sample-project" && item.selection?.name === "开场画面" && item.unsaved));
    const contextPanel = assistant.getByRole("region", { name: "当前上下文" });
    await contextPanel.getByText("示例画布").waitFor();
    await contextPanel.getByText("开场画面 · 图像").waitFor();
    assert.equal(await contextPanel.getByRole("button", { name: "收起详情" })
      .getAttribute("aria-expanded"), "true");
    if (process.env.FPL_AMADEUS_CONTEXT_SCREENSHOT)
      await assistant.screenshot({ path: process.env.FPL_AMADEUS_CONTEXT_SCREENSHOT });
    const originalViewport = assistant.viewportSize();
    const originalTheme = await assistant.evaluate(() => document.documentElement.dataset.theme);
    await assistant.setViewportSize({ width: 400, height: 500 });
    await assistant.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    const narrowLayout = await assistant.evaluate(() => ({
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      contextBottom: document.querySelector(".amadeus-context-panel").getBoundingClientRect().bottom,
      composerTop: document.querySelector(".amadeus-bottom").getBoundingClientRect().top,
      composerBottom: document.querySelector(".amadeus-bottom").getBoundingClientRect().bottom,
      panelBackground: getComputedStyle(document.querySelector(".amadeus-context-panel")).backgroundColor,
    }));
    assert.ok(narrowLayout.documentWidth <= narrowLayout.viewportWidth, "narrow context must not overflow horizontally");
    assert.ok(narrowLayout.contextBottom < narrowLayout.composerTop, "chat must remain between context and composer");
    assert.ok(narrowLayout.composerBottom <= 500, "composer must stay in the viewport");
    assert.equal(narrowLayout.panelBackground, "rgb(27, 31, 28)");
    if (process.env.FPL_AMADEUS_CONTEXT_NARROW_SCREENSHOT)
      await assistant.screenshot({ path: process.env.FPL_AMADEUS_CONTEXT_NARROW_SCREENSHOT });
    await assistant.evaluate((theme) => {
      if (theme) document.documentElement.dataset.theme = theme;
      else delete document.documentElement.dataset.theme;
    }, originalTheme);
    if (originalViewport) await assistant.setViewportSize(originalViewport);
    await assistant.evaluate(async () => {
      const source = (await window.futurePropsDesktop.amadeusContexts())
        .find((item) => item.projectId === "sample-project");
      await window.futurePropsDesktop.publishAmadeusMutation({
        application: "*", projectId: "sample-project",
        userId: source.userId, workspaceId: source.workspaceId,
      });
    });
    await page.getByRole("alert").filter({ hasText: "Amadeus 已更新项目" }).waitFor();
    await page.getByRole("button", { name: "关闭提示" }).click();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("future-props:amadeus-context", {
      detail: { path: "/apps", application: "应用首页", projectId: undefined, title: "应用" },
    })));
    await until(async () => (await assistant.evaluate(() => window.futurePropsDesktop.amadeusContexts()))
      .some((item) => item.application === "应用首页" && !item.selection && !item.unsaved));
    await assistant.getByRole("button", { name: "选取控件" }).click();
    await assistant.locator('[data-avatar-state="listening"]').first().waitFor();
    await page.getByRole("button", { name: "新建窗口" }).hover();
    assert.match(await page.locator(".amadeus-picker-label").textContent(), /^1\. 新建窗口/);
    await page.getByRole("button", { name: "新建窗口" }).click();
    await assistant.locator('[data-avatar-state="idle"]').first().waitFor();
    await assistant.getByRole("button", { name: "选取控件" }).click();
    await assistant.locator('[data-avatar-state="listening"]').first().waitFor();
    await page.keyboard.press("Escape");
    await assistant.locator('[data-avatar-state="idle"]').first().waitFor();
    assert.equal(browser.contexts()[0].pages().filter((item) =>
      item.url().startsWith("http:") && !item.url().includes("amadeus.html")).length, 1);
    await assistant.getByText(/1\. 新建窗口/).last().waitFor();
    console.log("PASS Amadeus singleton, always-on-top, history, capabilities, files, context UI, context reset and safe control picking");
  } catch (error) {
    console.error(output.slice(-2000));
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), pause(10000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
