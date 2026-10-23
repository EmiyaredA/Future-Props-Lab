// Real Electron + Vite + Python, with disposable account and database.
const { spawn } = require("node:child_process");
const {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} = require("node:fs");
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
    } catch {
      /* startup */
    }
    await pause(250);
  }
  throw new Error("Amadeus desktop smoke timed out");
}

async function apiJson(page, url, method = "GET", body) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const csrf = document.cookie
        .split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith("fpl_csrf="));
      const response = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(csrf
            ? { "X-CSRF-Token": decodeURIComponent(csrf.slice(9)) }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(`${response.status}: ${JSON.stringify(result)}`);
      return result;
    },
    { url, method, body },
  );
}

function sourceCli(directory, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(
      path.join(root, ".venv/bin/python"),
      [
        path.join(root, "desktop/backend/cli_entry.py"),
        "--data-dir",
        directory,
        "--profile",
        "external-smoke",
        ...args,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "",
      error = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      error += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Source CLI timed out"));
    }, 45000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code) reject(new Error(`CLI failed ${code}: ${error}`));
      else
        resolve(
          output
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line)),
        );
    });
    child.stdin.end(input);
  });
}

async function mcpCall(directory, operation, parameters) {
  const requests = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "call", arguments: { operation, parameters } },
    },
  ];
  const output = await sourceCli(
    directory,
    ["mcp", "serve"],
    requests.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  return output.find((item) => item.id === 2).result;
}

async function main() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "fpl-amadeus-smoke-"));
  const fake = path.join(directory, "codex-fixture");
  writeFileSync(
    fake,
    `#!${path.join(root, ".venv/bin/python")}\n${readFileSync(path.join(root, "tests/fixtures/code_agent_cli.py"), "utf8")}`,
    { mode: 0o700 },
  );
  mkdirSync(path.join(directory, "backend"), { recursive: true });
  writeFileSync(
    path.join(directory, "backend/config.toml"),
    `[security]\nsecrets_key="Q3kT62dvbHHXXulO5XPCR84_yXK6t-6LXz7BcIYONys="\n[code_agents]\ncodex_enabled=true\ncodex_executable=${JSON.stringify(fake)}\n`,
    { mode: 0o600 },
  );
  const listener = createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
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
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  let browser;
  try {
    browser = await until(() =>
      chromium.connectOverCDP(`http://127.0.0.1:${port}`),
    );
    const page = await until(() =>
      browser
        .contexts()[0]
        ?.pages()
        .find(
          (item) =>
            item.url().startsWith("http:") &&
            !item.url().includes("amadeus.html"),
        ),
    );
    await page.waitForFunction(() =>
      Boolean(window.futurePropsDesktop?.openAmadeus),
    );
    await page.getByLabel("账号", { exact: true }).fill("amadeus-smoke");
    await page.getByLabel("显示名称", { exact: true }).fill("Amadeus 隔离验收");
    await page
      .getByLabel("密码", { exact: true })
      .fill("Isolated-amadeus-smoke-29471!");
    await page
      .getByLabel("确认密码", { exact: true })
      .fill("Isolated-amadeus-smoke-29471!");
    await page.getByRole("button", { name: "创建管理员并进入" }).click();
    await page.waitForURL("**/home");

    await page.getByRole("button", { name: "打开 Amadeus" }).click();
    const assistant = await until(() =>
      browser
        .contexts()[0]
        ?.pages()
        .find((item) => item.url().includes("/amadeus.html")),
    );
    await assistant
      .getByRole("heading", { name: "你好，我是 Amadeus" })
      .waitFor();
    await assistant.locator('[data-avatar-renderer="model"]').first().waitFor();
    const initialWidth = await assistant.evaluate(() => innerWidth);
    assert.ok(
      initialWidth >= 850,
      `first Amadeus window should be about 900px wide, got ${initialWidth}`,
    );
    assert.equal(
      await assistant
        .getByRole("button", { name: "收起当前上下文" })
        .getAttribute("aria-expanded"),
      "true",
    );
    assert.equal(
      await assistant
        .getByRole("button", { name: "收起对话历史" })
        .getAttribute("aria-expanded"),
      "true",
    );
    assert.equal(
      await assistant
        .getByRole("button", { name: "展开数字人" })
        .getAttribute("aria-pressed"),
      "false",
    );
    const disposable = await apiJson(
      assistant,
      "/v1/amadeus/conversations",
      "POST",
    );
    const deleteTitle =
      "删除确认位置验收：" + "长对话标题与本地会话文件".repeat(5);
    await apiJson(
      assistant,
      `/v1/amadeus/conversations/${disposable.id}`,
      "PATCH",
      { expected_revision: disposable.revision, title: deleteTitle },
    );
    await assistant.reload();
    for (const theme of ["light", "dark"]) {
      await assistant.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      for (const width of [400, 900]) {
        await assistant.setViewportSize({ width, height: 700 });
        if (width === 400)
          await assistant.getByRole("button", { name: "历史对话" }).click();
        const trigger = assistant.getByRole("button", {
          name: `删除对话「${deleteTitle}」`,
        });
        const row = assistant
          .locator(".amadeus-history-row")
          .filter({ has: trigger });
        const actions = row.locator(".amadeus-history-actions");
        const historyToggle = assistant.getByRole("button", {
          name: "历史对话",
        });
        await historyToggle.focus();
        await assistant.locator(".amadeus-brand").hover();
        assert.equal(
          await actions.evaluate(
            (element) => getComputedStyle(element).opacity,
          ),
          "0",
        );
        assert.equal(
          await actions.evaluate(
            (element) => getComputedStyle(element).pointerEvents,
          ),
          "none",
        );
        const restingBounds = await row.boundingBox();
        const title = row.locator(".amadeus-history-title");
        const restingPadding = await title.evaluate((element) =>
          parseFloat(getComputedStyle(element).paddingRight),
        );
        if (
          theme === "light" &&
          width === 900 &&
          process.env.FPL_AMADEUS_HISTORY_SCREENSHOT
        )
          await assistant.screenshot({
            path: `${process.env.FPL_AMADEUS_HISTORY_SCREENSHOT}-rest.png`,
          });
        await title.focus();
        assert.equal(
          await actions.evaluate(
            (element) => getComputedStyle(element).opacity,
          ),
          "1",
        );
        await assistant.keyboard.press("Tab");
        assert.ok(
          await row
            .getByRole("button", { name: `重命名对话「${deleteTitle}」` })
            .evaluate((element) => element === document.activeElement),
        );
        await assistant.keyboard.press("Tab");
        assert.ok(
          await trigger.evaluate(
            (element) => element === document.activeElement,
          ),
        );
        await historyToggle.focus();
        assert.equal(
          await actions.evaluate(
            (element) => getComputedStyle(element).opacity,
          ),
          "0",
        );
        await row.hover();
        await until(
          () =>
            actions.evaluate(
              (element) => getComputedStyle(element).opacity === "1",
            ),
          5000,
        );
        assert.deepEqual(await row.boundingBox(), restingBounds);
        assert.ok(
          (await title.evaluate((element) =>
            parseFloat(getComputedStyle(element).paddingRight),
          )) > restingPadding,
        );
        if (
          theme === "light" &&
          width === 900 &&
          process.env.FPL_AMADEUS_HISTORY_SCREENSHOT
        )
          await assistant.screenshot({
            path: `${process.env.FPL_AMADEUS_HISTORY_SCREENSHOT}-hover.png`,
          });
        await trigger.click();
        const confirmation = assistant.getByRole("alertdialog");
        await confirmation.waitFor();
        const bounds = await confirmation.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            centerX: rect.x + rect.width / 2,
            centerY: rect.y + rect.height / 2,
            width: innerWidth,
            height: innerHeight,
            overflow: element.scrollWidth > element.clientWidth,
            inRail: Boolean(element.closest(".amadeus-side-rail")),
            background: getComputedStyle(element).backgroundColor,
          };
        });
        assert.ok(Math.abs(bounds.centerX - bounds.width / 2) < 1);
        assert.ok(Math.abs(bounds.centerY - bounds.height / 2) < 1);
        assert.ok(bounds.left >= 0 && bounds.right <= bounds.width);
        assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height);
        assert.equal(bounds.overflow, false);
        assert.equal(bounds.inRail, false);
        assert.equal(
          bounds.background,
          theme === "dark" ? "rgb(26, 29, 27)" : "rgb(255, 253, 250)",
        );
        await assistant.keyboard.press("Tab");
        assert.ok(
          await confirmation.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        );
        if (
          theme === "light" &&
          width === 900 &&
          process.env.FPL_AMADEUS_DELETE_SCREENSHOT
        )
          await assistant.screenshot({
            path: process.env.FPL_AMADEUS_DELETE_SCREENSHOT,
          });
        await assistant.keyboard.press("Escape");
        await confirmation.waitFor({ state: "detached" });
        assert.ok(
          await trigger.evaluate(
            (element) => element === document.activeElement,
          ),
        );
        assert.ok(
          (await apiJson(assistant, "/v1/amadeus/conversations")).items.some(
            (item) => item.id === disposable.id,
          ),
        );
        await assistant
          .getByRole("button", { name: `重命名对话「${deleteTitle}」` })
          .click();
        const nameInput = assistant.getByRole("textbox", { name: "对话名称" });
        await nameInput.waitFor();
        assert.ok(
          await nameInput.evaluate(
            (element) => element === document.activeElement,
          ),
        );
        const editBounds = await nameInput.evaluate((element) => {
          const row = element.closest(".amadeus-history-row");
          const rect = row.getBoundingClientRect();
          return {
            id: row.dataset.conversationId,
            height: rect.height,
            overflow: row.scrollWidth > row.clientWidth,
          };
        });
        assert.equal(editBounds.id, disposable.id);
        assert.equal(editBounds.height, restingBounds.height);
        assert.equal(editBounds.overflow, false);
        for (const control of [
          nameInput,
          assistant.getByRole("button", { name: "保存对话名称" }),
          assistant.getByRole("button", { name: "取消重命名" }),
        ]) {
          await control.focus();
          const focusClearance = await control.evaluate((element) => {
            const row = element.closest(".amadeus-history-row");
            const rowRect = row.getBoundingClientRect();
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const outset = element.matches(":focus-visible")
              ? Math.max(
                  0,
                  parseFloat(style.outlineWidth) +
                    parseFloat(style.outlineOffset),
                )
              : 0;
            const others = [...row.querySelectorAll("input, button")].filter(
              (other) => other !== element,
            );
            return {
              contained:
                rect.left - outset >= rowRect.left &&
                rect.right + outset <= rowRect.right,
              separated: others.every((other) => {
                const otherRect = other.getBoundingClientRect();
                return (
                  rect.right + outset < otherRect.left ||
                  rect.left - outset > otherRect.right
                );
              }),
            };
          });
          assert.ok(focusClearance.contained, "rename focus stays in its row");
          assert.ok(focusClearance.separated, "rename controls never overlap");
        }
        await nameInput.focus();
        assert.equal(
          await assistant.locator(".amadeus-history-dialog").count(),
          0,
        );
        await nameInput.fill("行内重命名验收");
        if (
          theme === "light" &&
          width === 900 &&
          process.env.FPL_AMADEUS_RENAME_SCREENSHOT
        )
          await assistant.screenshot({
            path: process.env.FPL_AMADEUS_RENAME_SCREENSHOT,
          });
        await nameInput.press("Escape");
        await nameInput.waitFor({ state: "detached" });
        assert.equal(
          (
            await apiJson(
              assistant,
              `/v1/amadeus/conversations/${disposable.id}`,
            )
          ).conversation.title,
          deleteTitle,
        );
      }
    }
    await assistant.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await assistant.setViewportSize({ width: initialWidth, height: 700 });
    await assistant
      .getByRole("button", { name: `重命名对话「${deleteTitle}」` })
      .focus();
    await assistant
      .getByRole("button", { name: `重命名对话「${deleteTitle}」` })
      .click();
    const nameInput = assistant.getByRole("textbox", { name: "对话名称" });
    await nameInput.fill("行内保存测试");
    await nameInput.press("Enter");
    await nameInput.waitFor({ state: "detached" });
    assert.equal(
      (await apiJson(assistant, `/v1/amadeus/conversations/${disposable.id}`))
        .conversation.title,
      "行内保存测试",
    );
    await assistant
      .getByRole("button", { name: "删除对话「行内保存测试」" })
      .click();
    await assistant
      .getByRole("alertdialog")
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await assistant.getByRole("alertdialog").waitFor({ state: "detached" });
    assert.equal(
      (await apiJson(assistant, "/v1/amadeus/conversations")).items.some(
        (item) => item.id === disposable.id,
      ),
      false,
    );
    await assistant.getByRole("button", { name: "展开数字人" }).click();
    await assistant
      .getByRole("complementary", { name: "红莉栖数字人舞台" })
      .waitFor();
    const savedCollapsedWidth = await until(() => {
      const prefs = JSON.parse(
        readFileSync(path.join(directory, "amadeus-window.json"), "utf8"),
      );
      return prefs.width === initialWidth && prefs.width;
    });
    assert.equal(savedCollapsedWidth, initialWidth);
    await assistant.getByRole("button", { name: "折叠数字人" }).click();
    await assistant
      .getByRole("complementary", { name: "红莉栖数字人舞台" })
      .waitFor({ state: "detached" });
    await assistant.getByRole("button", { name: "展开数字人" }).click();
    await assistant.reload();
    await assistant.getByRole("button", { name: "展开数字人" }).waitFor();
    assert.equal(await assistant.evaluate(() => innerWidth), initialWidth);
    assert.equal(
      await assistant
        .getByRole("button", { name: "收起对话历史" })
        .getAttribute("aria-expanded"),
      "true",
    );
    assert.equal(
      await assistant.locator('[data-avatar-state="idle"]').count(),
      2,
    );
    assert.equal(
      await assistant.evaluate(() =>
        window.futurePropsDesktop.amadeusAlwaysOnTop(),
      ),
      true,
    );
    await assistant.getByRole("button", { name: "取消悬浮置顶" }).click();
    assert.equal(
      await assistant.evaluate(() =>
        window.futurePropsDesktop.amadeusAlwaysOnTop(),
      ),
      false,
    );
    assert.equal(
      await assistant
        .getByRole("button", { name: "保持悬浮在应用上方" })
        .getAttribute("aria-pressed"),
      "false",
    );
    await assistant.getByRole("button", { name: "保持悬浮在应用上方" }).click();
    assert.equal(
      await assistant.evaluate(() =>
        window.futurePropsDesktop.amadeusAlwaysOnTop(),
      ),
      true,
    );
    assert.equal(
      await assistant
        .getByRole("button", { name: "取消悬浮置顶" })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("button", { name: "打开 Amadeus" }).click();
    assert.equal(
      browser
        .contexts()[0]
        .pages()
        .filter((item) => item.url().includes("/amadeus.html")).length,
      1,
    );
    assert.equal(
      await assistant.getByRole("combobox", { name: "选择模型" }).count(),
      1,
    );
    assert.equal(
      await assistant.getByRole("button", { name: "选取控件" }).count(),
      1,
    );
    if (process.env.FPL_AMADEUS_SCREENSHOT)
      await assistant.screenshot({ path: process.env.FPL_AMADEUS_SCREENSHOT });
    await assistant.getByRole("button", { name: "关闭窗口" }).click();
    await page.getByRole("button", { name: "打开 Amadeus" }).click();
    assert.equal(
      browser
        .contexts()[0]
        .pages()
        .filter((item) => item.url().includes("/amadeus.html")).length,
      1,
    );
    await assistant
      .getByRole("button", { name: "新建对话", exact: true })
      .click();
    await assistant.locator(".amadeus-history-title").first().click();
    assert.equal(
      await assistant
        .getByRole("button", { name: "收起对话历史" })
        .getAttribute("aria-expanded"),
      "true",
    );
    await assistant.getByRole("button", { name: "能力", exact: true }).click();
    await assistant.getByText("工具 API", { exact: false }).first().waitFor();
    await assistant.getByRole("button", { name: "关闭能力配置" }).click();
    await assistant
      .getByRole("button", { name: "会话文件", exact: true })
      .click();
    await assistant.getByText("暂无文件").waitFor();
    await assistant.getByRole("button", { name: "收起会话文件" }).click();
    await assistant.getByRole("button", { name: "收起对话历史" }).click();
    assert.equal(
      await assistant
        .getByRole("button", { name: "展开对话历史" })
        .getAttribute("aria-expanded"),
      "false",
    );
    await assistant.getByRole("button", { name: "展开对话历史" }).click();
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("future-props:amadeus-context", {
          detail: {
            path: "/demo/visual",
            application: "视觉创作工坊",
            projectId: "sample-project",
            title: "示例画布",
            selection: { id: "node-1", name: "开场画面", value: "图像" },
            unsaved: true,
          },
        }),
      ),
    );
    await until(async () =>
      (
        await assistant.evaluate(() =>
          window.futurePropsDesktop.amadeusContexts(),
        )
      ).some(
        (item) =>
          item.projectId === "sample-project" &&
          item.selection?.name === "开场画面" &&
          item.unsaved,
      ),
    );
    const contextPanel = assistant.getByRole("region", { name: "当前上下文" });
    await contextPanel.getByText("示例画布").waitFor();
    await contextPanel.getByText("开场画面 · 图像").waitFor();
    assert.equal(
      await contextPanel
        .getByRole("button", { name: "收起当前上下文" })
        .getAttribute("aria-expanded"),
      "true",
    );
    assert.equal(
      await contextPanel.getByRole("button", { name: "收起详情" }).count(),
      0,
    );
    assert.equal(await contextPanel.getByText("暂无选中控件").count(), 0);
    assert.ok(
      (await contextPanel.boundingBox()).height < 110,
      "single-window context should stay compact",
    );
    if (process.env.FPL_AMADEUS_CONTEXT_SCREENSHOT)
      await assistant.screenshot({
        path: process.env.FPL_AMADEUS_CONTEXT_SCREENSHOT,
      });
    const originalViewport = assistant.viewportSize();
    const originalTheme = await assistant.evaluate(
      () => document.documentElement.dataset.theme,
    );
    await assistant.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    for (const width of [400, 520, 900]) {
      await assistant.setViewportSize({
        width,
        height: width === 900 ? 700 : 500,
      });
      await assistant.waitForFunction(
        () =>
          document
            .querySelector(".amadeus-side-rail")
            .classList.contains("is-open") ===
          innerWidth >= 700,
      );
      const layout = await assistant.evaluate(() => {
        const rail = document
          .querySelector(".amadeus-side-rail")
          .getBoundingClientRect();
        const chat = document
          .querySelector(".amadeus-chat")
          .getBoundingClientRect();
        const composer = document
          .querySelector(".amadeus-bottom")
          .getBoundingClientRect();
        return {
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          documentWidth: document.documentElement.scrollWidth,
          railDisplay: getComputedStyle(
            document.querySelector(".amadeus-side-rail"),
          ).display,
          railRight: rail.right,
          chatLeft: chat.left,
          chatWidth: chat.width,
          composerBottom: composer.bottom,
          panelBackground: getComputedStyle(
            document.querySelector(".amadeus-context-panel"),
          ).backgroundColor,
        };
      });
      assert.ok(
        layout.documentWidth <= layout.viewportWidth,
        `${width}px layout must not overflow horizontally`,
      );
      if (width <= 700) assert.equal(layout.railDisplay, "none");
      else
        assert.ok(
          layout.railRight <= layout.chatLeft + 1,
          `${width}px sidebar must precede chat`,
        );
      assert.ok(
        layout.chatWidth >= 200,
        `${width}px chat must remain readable`,
      );
      assert.ok(
        layout.composerBottom <= layout.viewportHeight,
        `${width}px composer must stay in viewport`,
      );
      assert.equal(layout.panelBackground, "rgb(34, 39, 35)");
      if (width === 400) {
        await assistant.getByRole("button", { name: "历史对话" }).click();
        await assistant
          .getByRole("complementary", { name: "对话侧栏" })
          .waitFor();
        assert.equal(
          await assistant.locator(".amadeus-side-rail.is-open").count(),
          1,
        );
        await assistant.getByRole("button", { name: "收起对话侧栏" }).click();
        await assistant.getByRole("button", { name: "展开数字人" }).click();
        const narrowStage = await assistant.evaluate(() => ({
          position: getComputedStyle(document.querySelector(".amadeus-stage"))
            .position,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
        }));
        assert.equal(narrowStage.position, "absolute");
        assert.ok(narrowStage.documentWidth <= narrowStage.viewportWidth);
        await assistant.getByRole("button", { name: "折叠数字人" }).click();
      }
      if (width === 400 && process.env.FPL_AMADEUS_CONTEXT_NARROW_SCREENSHOT)
        await assistant.screenshot({
          path: process.env.FPL_AMADEUS_CONTEXT_NARROW_SCREENSHOT,
        });
    }
    await assistant.evaluate((theme) => {
      if (theme) document.documentElement.dataset.theme = theme;
      else delete document.documentElement.dataset.theme;
    }, originalTheme);
    if (originalViewport) await assistant.setViewportSize(originalViewport);
    await assistant.evaluate(async () => {
      const source = (await window.futurePropsDesktop.amadeusContexts()).find(
        (item) => item.projectId === "sample-project",
      );
      await window.futurePropsDesktop.publishAmadeusMutation({
        application: "*",
        projectId: "sample-project",
        userId: source.userId,
        workspaceId: source.workspaceId,
      });
    });
    await page
      .getByRole("alert")
      .filter({ hasText: "Amadeus 已更新项目" })
      .waitFor();
    await page.getByRole("button", { name: "关闭提示" }).click();
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("future-props:amadeus-context", {
          detail: {
            path: "/apps",
            application: "应用首页",
            projectId: undefined,
            title: "应用",
          },
        }),
      ),
    );
    await until(async () =>
      (
        await assistant.evaluate(() =>
          window.futurePropsDesktop.amadeusContexts(),
        )
      ).some(
        (item) =>
          item.application === "应用首页" && !item.selection && !item.unsaved,
      ),
    );
    await assistant.getByRole("button", { name: "选取控件" }).click();
    await assistant
      .locator('[data-avatar-state="listening"]')
      .first()
      .waitFor();
    await page.getByRole("button", { name: "新建窗口" }).hover();
    assert.match(
      await page.locator(".amadeus-picker-label").textContent(),
      /^1\. 新建窗口/,
    );
    await page.getByRole("button", { name: "新建窗口" }).click();
    await assistant.locator('[data-avatar-state="idle"]').first().waitFor();
    await assistant.getByRole("button", { name: "选取控件" }).click();
    await assistant
      .locator('[data-avatar-state="listening"]')
      .first()
      .waitFor();
    await page.keyboard.press("Escape");
    await assistant.locator('[data-avatar-state="idle"]').first().waitFor();
    assert.equal(
      browser
        .contexts()[0]
        .pages()
        .filter(
          (item) =>
            item.url().startsWith("http:") &&
            !item.url().includes("amadeus.html"),
        ).length,
      1,
    );
    await assistant
      .getByText(/1\. 新建窗口/)
      .last()
      .waitFor();
    const project = await apiJson(
      assistant,
      "/v1/visual-workshop/projects",
      "POST",
      { title: "Amadeus 视频创作流程烟测", kind: "video" },
    );
    const canvasUrl = `/v1/visual-workshop/projects/${project.id}/canvas`;
    const initialCanvas = await apiJson(assistant, canvasUrl);
    assert.equal(initialCanvas.revision, 0);
    assert.equal(initialCanvas.nodes.length, 0);
    await page.goto(
      new URL(
        `/apps/visual-workshop/projects/${project.id}/canvas`,
        page.url(),
      ).toString(),
    );
    await until(async () =>
      (
        await assistant.evaluate(() =>
          window.futurePropsDesktop.amadeusContexts(),
        )
      ).some((item) => item.projectId === project.id && !item.unsaved),
    );
    const node = {
      id: "video-draft-smoke",
      kind: "video",
      title: "日落城市镜头",
      position: { x: 80, y: 120 },
      generation_draft: { prompt: "日落时分的城市街景，缓慢推进镜头" },
    };
    writeFileSync(
      fake + ".json",
      JSON.stringify({ project_id: project.id, node }),
    );
    const me = await apiJson(assistant, "/v1/auth/me");
    const grants = await apiJson(assistant, "/v1/code-agents/grants");
    await apiJson(assistant, "/v1/code-agents/grants", "PUT", {
      expected_revision: grants.revision,
      managed: ["codex:amadeus"],
      grants: [{ user_id: me.user.id, agent_id: "codex", purpose: "amadeus" }],
    });
    await assistant.reload();
    await assistant
      .getByRole("combobox", { name: "选择 Code Agent" })
      .waitFor();
    await assistant
      .getByRole("button", { name: "新建对话", exact: true })
      .click();
    await assistant.getByRole("button", { name: "Plan", exact: true }).click();
    await assistant
      .getByRole("textbox", { name: "向 Amadeus 提问" })
      .fill("在当前视频项目新增日落城市镜头草稿，先给出计划。");
    await assistant.getByRole("button", { name: "发送", exact: true }).click();
    await assistant
      .getByRole("button", { name: "执行计划", exact: true })
      .waitFor();
    await assistant
      .getByRole("button", { name: "执行计划", exact: true })
      .click();
    await assistant
      .getByRole("button", { name: "批准并执行", exact: true })
      .waitFor();
    // Reloading reconnects to persisted work; it must not restart the CLI or replay a write.
    await assistant.reload();
    await assistant
      .getByRole("button", { name: "批准并执行", exact: true })
      .click();
    await assistant
      .getByText("已新增视频生成草稿，并确认当前项目状态。", { exact: true })
      .first()
      .waitFor();
    const finalCanvas = await apiJson(assistant, canvasUrl);
    assert.equal(finalCanvas.revision, 1);
    assert.equal(finalCanvas.nodes.length, 1);
    assert.equal(finalCanvas.nodes[0].id, node.id);
    assert.equal(finalCanvas.nodes[0].kind, "video");
    assert.equal(
      finalCanvas.nodes[0].generation_draft.prompt,
      node.generation_draft.prompt,
    );
    assert.equal(finalCanvas.nodes[0].asset_id, null);
    const conversations = await apiJson(assistant, "/v1/amadeus/conversations");
    const workflow = await apiJson(
      assistant,
      `/v1/amadeus/conversations/${conversations.items[0].id}`,
    );
    assert.deepEqual(
      workflow.actions.map((action) => action.status),
      ["completed"],
    );
    await assert.rejects(
      () =>
        apiJson(assistant, canvasUrl + "/operations", "POST", {
          expected_revision: 0,
          request_id: "amadeus-stale-video-draft-smoke",
          operations: [
            {
              entity: "node",
              action: "insert",
              id: "stale-video-draft",
              value: { ...node, id: "stale-video-draft" },
            },
          ],
        }),
      /409/,
    );
    assert.deepEqual(
      (await apiJson(assistant, canvasUrl)).nodes,
      finalCanvas.nodes,
    );
    await page.evaluate(() => window.futurePropsDesktop.enableAgent());
    const pairing = sourceCli(directory, [
      "connect",
      "--name",
      "MCP 隔离验收",
      "--write",
    ]);
    pairing.catch(() => {});
    await page
      .getByRole("heading", { name: "允许「MCP 隔离验收」接入？" })
      .waitFor();
    await page.getByRole("button", { name: "核对一致，允许接入" }).click();
    const paired = (await pairing)[0];
    assert.equal(paired.status, "approved");
    const created = await mcpCall(directory, "visual.create_project", {
      body: { title: "外部 MCP 隔离项目", kind: "image" },
    });
    assert.equal(created.isError, false);
    const external = JSON.parse(created.content[0].text);
    const edited = await mcpCall(directory, "visual.patch_project", {
      project_id: external.id,
      body: { expected_revision: external.revision, title: "外部 MCP 已编辑" },
    });
    assert.equal(edited.isError, false);
    assert.equal(JSON.parse(edited.content[0].text).title, "外部 MCP 已编辑");
    const keys = await apiJson(page, "/v1/account/api-keys");
    const key = keys.find((item) => item.id === paired.key_id);
    assert.ok(key);
    await page.evaluate(async ({ id, revision }) => {
      const csrf = document.cookie
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("fpl_csrf="));
      const response = await fetch(`/v1/account/api-keys/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": decodeURIComponent(csrf.slice(9)),
        },
        body: JSON.stringify({ expected_revision: revision }),
      });
      if (!response.ok) throw new Error(`revoke failed: ${response.status}`);
    }, key);
    const revoked = await mcpCall(directory, "visual.get_project", {
      project_id: external.id,
    });
    assert.equal(revoked.isError, true);
    console.log(
      "PASS Amadeus layout, inline rename, centered deletion confirmation, safe control picking, native CLI Plan → Agent workflow, and external MCP pairing/edit/revocation",
    );
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
