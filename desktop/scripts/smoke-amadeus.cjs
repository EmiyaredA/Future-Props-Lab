// Real Electron + Vite + Python, with disposable account and database.
const { spawn } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
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

async function main() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "fpl-amadeus-smoke-"));
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
      await assistant.getByRole("button", { name: "选择模型" }).count(),
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
    await assistant.addInitScript(
      ({ projectId, canvasPath, videoNode }) => {
        const realFetch = window.fetch.bind(window);
        window.__amadeusMockTurns = 0;
        window.fetch = async (input, init) => {
          const request =
            input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          if (url.pathname === "/v1/model-inference/options")
            return new Response(
              JSON.stringify({
                items: [{ id: "smoke-model", label: "隔离模型" }],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          if (url.pathname !== "/v1/amadeus/model-turn/stream")
            return realFetch(input, init);
          window.__amadeusMockTurns += 1;
          const payload = await request.clone().json();
          const messages = payload.messages || [];
          const toolSeen = (name) =>
            messages.some(
              (item) => item.role === "tool" && item.tool_name === name,
            );
          let text = "";
          let tool_calls = [];
          if (payload.system.includes("Plan 模式"))
            text = "计划：读取视频项目画布，确认版本后新增视频生成草稿。";
          else if (toolSeen("fpl_operation_write"))
            text = "已新增视频生成草稿，并确认当前项目状态。";
          else if (toolSeen("fpl_read"))
            tool_calls = [
              {
                id: "add-video-draft",
                name: "fpl_operation_write",
                arguments: {
                  operation: "visual.apply_canvas_operations",
                  path_params: { project_id: projectId },
                  body: JSON.stringify({
                    expected_revision: 0,
                    request_id: "amadeus-video-draft-smoke",
                    operations: [
                      {
                        entity: "node",
                        action: "insert",
                        id: videoNode.id,
                        value: videoNode,
                      },
                    ],
                  }),
                },
              },
            ];
          else
            tool_calls = [
              {
                id: "read-canvas",
                name: "fpl_read",
                arguments: { path: canvasPath },
              },
            ];
          const events = [
            ...(text ? [{ type: "delta", text }] : []),
            {
              type: "end",
              tool_calls,
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            },
          ];
          return new Response(
            events.map((event) => JSON.stringify(event)).join("\n") + "\n",
            {
              status: 200,
              headers: { "Content-Type": "application/x-ndjson" },
            },
          );
        };
      },
      { projectId: project.id, canvasPath: canvasUrl, videoNode: node },
    );
    await assistant.reload();
    await assistant
      .getByRole("button", { name: "选择模型" })
      .getByText("隔离模型")
      .waitFor();
    await assistant.getByRole("button", { name: "Plan", exact: true }).click();
    await assistant
      .getByRole("textbox", { name: "向 Amadeus 提问" })
      .fill(
        "在当前视频项目画布新增一个日落城市镜头的视频生成草稿，先给出计划。",
      );
    await assistant.getByRole("button", { name: "发送" }).click();
    try {
      await assistant.getByRole("button", { name: "执行计划" }).waitFor();
    } catch (error) {
      console.error(
        "workflow model turns",
        await assistant.evaluate(() => window.__amadeusMockTurns),
      );
      console.error(
        "workflow messages",
        await assistant.locator(".amadeus-messages").innerText(),
      );
      console.error(
        "workflow error",
        await assistant.locator(".amadeus-error").allInnerTexts(),
      );
      throw error;
    }
    assert.equal((await apiJson(assistant, canvasUrl)).revision, 0);
    await assistant.getByRole("button", { name: "执行计划" }).click();
    try {
      await assistant.getByRole("button", { name: "批准并执行" }).waitFor();
    } catch (error) {
      console.error(
        "workflow model turns",
        await assistant.evaluate(() => window.__amadeusMockTurns),
      );
      console.error(
        "workflow messages",
        await assistant.locator(".amadeus-messages").innerText(),
      );
      console.error(
        "workflow error",
        await assistant.locator(".amadeus-error").allInnerTexts(),
      );
      throw error;
    }
    assert.equal(
      await assistant.getByRole("button", { name: "批准并执行" }).count(),
      1,
    );
    assert.equal(
      await assistant.getByText("并行调查", { exact: true }).count(),
      0,
    );
    await assistant.reload();
    await assistant.getByRole("button", { name: "批准并执行" }).waitFor();
    await assistant.getByRole("button", { name: "批准并执行" }).click();
    await assistant
      .getByText("已新增视频生成草稿，并确认当前项目状态。")
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
    console.log(
      "PASS Amadeus layout, safe control picking, and isolated Plan → Agent video workflow",
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
