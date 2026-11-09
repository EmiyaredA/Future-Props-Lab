import { expect, test, type Locator } from "@playwright/test";

test("website assistant and local-only access controls across themes and viewports", async ({
  page,
}, testInfo) => {
  let local = true;
  await page.route("**/v1/automation/runtime", (route) =>
    route.fulfill({ json: { local_browser: local } }),
  );
  await page.route("**/v1/amadeus/conversations", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/v1/amadeus/runs/active", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("**/v1/amadeus/operations", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  for (const width of [390, 768, 1600]) {
    await page.setViewportSize({ width, height: 960 });
    for (const theme of ["light", "dark"]) {
      await page.addInitScript(
        (value) => localStorage.setItem("future_props_theme", value),
        theme,
      );
      await page.goto("/home");
      await page.getByRole("button", { name: "账号菜单", exact: true }).click();
      await expect(
        page.getByRole("menuitem", { name: "本地与公网访问" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("menuitem", { name: "管理中台" }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      const trigger = page.getByRole("button", { name: "打开 Amadeus" });
      const studio = page.locator(".studio-shell");
      const originalWidth = (await studio.boundingBox())!.width;
      await trigger.click();
      await expect(page).toHaveURL(/\/home$/);
      const assistant = page.getByRole("complementary", {
        name: "Amadeus 助手",
      });
      await expect(assistant).toBeVisible();
      await expect(
        assistant.getByRole("button", { name: "选择工坊项目" }),
      ).toBeVisible();
      const panel = (await assistant.boundingBox())!;
      const studioBox = (await studio.boundingBox())!;
      if (width >= 1100) {
        await expect(assistant).toHaveCSS("position", "sticky");
        const divider = (await page
          .getByRole("separator", { name: "调整 Amadeus 分屏宽度" })
          .boundingBox())!;
        expect(studioBox.width).toBeLessThan(originalWidth);
        expect(studioBox.x + studioBox.width).toBeCloseTo(divider.x, 0);
        expect(divider.x + divider.width).toBeCloseTo(panel.x, 0);
        const main = (await studio.locator(".studio-main").boundingBox())!;
        const header = (await studio
          .locator(".studio-global-header")
          .boundingBox())!;
        const sidebar = (await studio
          .locator(".studio-sidebar")
          .boundingBox())!;
        const gutter = sidebar.x;
        expect(panel.y).toBeCloseTo(header.y, 0);
        expect(panel.y + panel.height).toBeCloseTo(main.y + main.height, 0);
        expect(panel.x - (main.x + main.width)).toBeCloseTo(gutter, 0);
        expect(width - (panel.x + panel.width)).toBeCloseTo(gutter, 0);
      } else if (width > 700) {
        expect(studioBox.width).toBe(originalWidth);
        expect(panel.x).toBeGreaterThan(width / 3);
        expect(panel.x + panel.width).toBeCloseTo(width - 12, 0);
      } else {
        expect(studioBox.width).toBe(originalWidth);
        expect(panel.x).toBe(0);
        expect(panel.width).toBe(width);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: testInfo.outputPath(`assistant-${theme}-${width}.png`),
      });
      if (width === 390 && theme === "light") {
        await assistant.getByRole("button", { name: "点选页面元素" }).click();
        await expect(assistant).toBeHidden();
        await studio
          .getByRole("button", { name: "账号菜单", exact: true })
          .click();
        await expect(assistant).toBeVisible();
        await expect(
          assistant.locator(".amadeus-ref").getByText("账号菜单"),
        ).toBeVisible();
        await expect(page).toHaveURL(/\/home$/);
      }
      await page.keyboard.press("Escape");
      await expect(assistant).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  }
  local = false;
  await page.goto("/files");
  await page.getByRole("button", { name: "账号菜单", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "本地与公网访问" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "打开 Amadeus", exact: true }).click();
  await expect(page).toHaveURL(/\/files$/);
  await expect(
    page.getByRole("complementary", { name: "Amadeus 助手" }),
  ).toBeVisible();
});

test("the independent Assets program switches between all three Amadeus layouts", async ({
  page,
}, testInfo) => {
  await page.context().route(
    (url) => url.pathname === "/amadeus",
    async (route) => {
      const url = new URL("/portal.html", route.request().url()).href;
      await route.fulfill({ response: await route.fetch({ url }) });
    },
  );
  await page.route(
    (url) => url.pathname === "/files",
    async (route) => {
      const url = new URL("/assets.html", route.request().url()).href;
      await route.fulfill({ response: await route.fetch({ url }) });
    },
  );
  await page.goto("/files");
  await expect(page).toHaveTitle(/文件管理/);
  await expect(
    page.getByRole("button", { name: "打开 Amadeus", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("files-amadeus.png") });
  await page.getByRole("button", { name: "打开 Amadeus", exact: true }).click();
  const assistant = page.getByRole("complementary", { name: "Amadeus 助手" });
  await expect(assistant).toBeVisible();
  const composer = assistant.getByRole("textbox", { name: "向 Amadeus 提问" });
  const studio = page.locator(".studio-shell");
  const width = page.viewportSize()!.width;
  const checkComposer = async (panel: Locator) => {
    const card = panel.locator(".amadeus-composer");
    await expect(card).toBeVisible();
    const bounds = (await card.boundingBox())!;
    for (const control of [
      panel.getByRole("textbox", { name: "向 Amadeus 提问" }),
      panel.getByRole("combobox", { name: "选择 Code Agent" }),
      panel.getByRole("combobox", { name: "选择模型" }),
      panel.getByRole("button", { name: "发送", exact: true }),
    ]) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  };
  await expect(assistant).toHaveCSS("position", "sticky");
  await composer.fill("保留这段未发送的输入");
  await checkComposer(assistant);

  await assistant
    .getByRole("button", { name: "切换为右侧弹窗" })
    .press("Enter");
  await expect(assistant).toHaveCSS("position", "fixed");
  expect((await studio.boundingBox())!.width).toBe(width);
  await expect(composer).toHaveValue("保留这段未发送的输入");
  await assistant.getByRole("button", { name: "切换为分屏" }).press("Enter");
  await expect(assistant).toHaveCSS("position", "sticky");
  const divider = page.getByRole("separator", {
    name: "调整 Amadeus 分屏宽度",
  });
  const dividerBox = (await divider.boundingBox())!;
  const assistantBox = (await assistant.boundingBox())!;
  const dividerX = dividerBox.x + dividerBox.width / 2;
  const dividerY = dividerBox.y + dividerBox.height / 2;
  await page.mouse.move(dividerX, dividerY);
  await page.mouse.down();
  await page.mouse.move(dividerX - 80, dividerY, { steps: 4 });
  await expect
    .poll(async () => (await assistant.boundingBox())!.width)
    .toBeCloseTo(assistantBox.width + 80, 0);
  await page.mouse.up();
  await divider.press("Home");
  await expect(divider).toHaveAttribute("aria-valuenow", "400");
  await checkComposer(assistant);
  await divider.press("End");
  const narrowStudio = (await studio.boundingBox())!;
  const wideAssistant = (await assistant.boundingBox())!;
  expect(narrowStudio.width).toBeCloseTo(600, 0);
  expect(wideAssistant.x - (narrowStudio.x + narrowStudio.width)).toBeCloseTo(
    width - (wideAssistant.x + wideAssistant.width),
    0,
  );
  await divider.dblclick();
  await expect
    .poll(async () => (await assistant.boundingBox())!.width)
    .toBeCloseTo(assistantBox.width, 0);
  await divider.press("ArrowLeft");
  const resizedWidth = assistantBox.width + 10;
  await expect
    .poll(async () => (await assistant.boundingBox())!.width)
    .toBeCloseTo(resizedWidth, 0);
  await expect(composer).toHaveValue("保留这段未发送的输入");
  await checkComposer(assistant);
  await page.screenshot({
    path: testInfo.outputPath("files-amadeus-split.png"),
  });

  await page.setViewportSize({ width: 768, height: 900 });
  await expect(assistant).toHaveCSS("position", "fixed");
  await expect(divider).toHaveCount(0);
  await expect(
    assistant.getByRole("button", { name: "切换为分屏" }),
  ).toHaveCount(0);
  await checkComposer(assistant);
  await page.setViewportSize({ width: 390, height: 844 });
  await checkComposer(assistant);
  await page.setViewportSize({ width, height: 900 });
  await expect(assistant).toHaveCSS("position", "sticky");
  await assistant.getByRole("button", { name: "切换为右侧弹窗" }).click();
  await expect(assistant).toHaveCSS("position", "fixed");
  expect((await studio.boundingBox())!.width).toBe(width);
  await expect(composer).toHaveValue("保留这段未发送的输入");
  const [workspace] = await Promise.all([
    page.waitForEvent("popup"),
    assistant.getByRole("link", { name: "在新标签页打开 Amadeus" }).click(),
  ]);
  await expect(workspace).toHaveURL(/\/amadeus(?:\?|$)/);
  const fullPage = workspace.getByRole("region", {
    name: "Amadeus",
    exact: true,
  });
  await expect(
    fullPage.getByRole("textbox", { name: "向 Amadeus 提问" }),
  ).toBeVisible();
  await expect(
    fullPage.getByRole("link", { name: "返回 Studio" }),
  ).toBeVisible();
  await checkComposer(fullPage);
  expect(await fullPage.boundingBox()).toMatchObject({ x: 0, y: 0 });
  expect((await fullPage.boundingBox())!.width).toBe(
    workspace.viewportSize()!.width,
  );
  expect((await fullPage.boundingBox())!.height).toBe(
    workspace.viewportSize()!.height,
  );
  await expect(page).toHaveURL(/\/files$/);
  await expect(assistant).toBeVisible();
  await assistant.getByRole("button", { name: "关闭 Amadeus" }).click();
  await expect(assistant).toHaveCount(0);
  await page.getByRole("button", { name: "打开 Amadeus", exact: true }).click();
  await expect(assistant).toHaveCSS("position", "sticky");
  expect((await assistant.boundingBox())!.width).toBeCloseTo(resizedWidth, 0);
});

test("Amadeus submits two workshop projects with explicit Skill and MCP scope", async ({
  page,
}, testInfo) => {
  const base = "/v1/amadeus/conversations/fusion-fixture";
  const timestamp = "2026-11-08T04:00:00Z";
  const conversation = {
    id: "fusion-fixture",
    title: "跨工坊会话",
    model_id: null,
    revision: 0,
    created_at: timestamp,
    updated_at: timestamp,
    agent_id: "codex",
  };
  const messages: Array<Record<string, unknown>> = [];
  const detail = () => ({ conversation, messages, actions: [], questions: [] });
  const runs: Array<{ run: Record<string, unknown>; events: unknown[] }> = [];
  const capability = {
    id: "fixture",
    name: "验收能力",
    enabled: true,
    revision: 0,
    status: "ready",
  };
  await page.route("**/v1/code-agents", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "codex",
            name: "Codex",
            available: true,
            models: [
              {
                id: "fixture-model",
                label: "验收模型",
                reasoning_efforts: ["medium", "high"],
                fast_available: true,
              },
            ],
            model_catalog: "discovered",
          },
        ],
      },
    }),
  );
  for (const kind of ["skills", "mcp", "tool-apis"]) {
    await page.route(`**/v1/integrations/${kind}`, (route) =>
      route.fulfill({
        json: { items: kind === "tool-apis" ? [] : [capability] },
      }),
    );
  }
  await page.route("**/v1/amadeus/operations", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/v1/amadeus/operations/read", (route) => {
    const operation = route.request().postDataJSON().operation;
    if (operation === "director.list_projects")
      return route.fulfill({ status: 503, json: { detail: "离线" } });
    const items =
      operation === "motion_compositor.list_projects"
        ? [{ id: "motion-fixture", title: "片头特效" }]
        : operation === "interview.list_interview_rooms"
          ? [{ id: "interview-fixture", title: "项目面试" }]
          : operation === "visual.list_projects"
            ? Array.from({ length: 16 }, (_, index) => ({
                id: `visual-${index + 1}`,
                title: `分镜视觉样稿 ${index + 1}`,
              }))
            : [];
    return route.fulfill({ json: { result: { items } } });
  });
  await page.route("**/v1/amadeus/conversations", (route) =>
    route.fulfill({ json: { items: [conversation] } }),
  );
  await page.route("**/v1/amadeus/runs/active", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route(`**${base}`, (route) => route.fulfill({ json: detail() }));
  await page.route(`**${base}/messages`, (route) => {
    messages.push({
      id: "prompt",
      role: "user",
      content: route.request().postDataJSON().content,
      references: [],
      created_at: timestamp,
    });
    return route.fulfill({ json: detail() });
  });
  await page.route(`**${base}/runs`, (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: runs });
    const body = route.request().postDataJSON();
    expect(
      body.context
        .filter((item: { projectResource?: string }) => item.projectResource)
        .map((item: { projectId: string }) => item.projectId)
        .sort(),
    ).toEqual(["interview-fixture", "motion-fixture"]);
    expect(body.capabilities.sort()).toEqual(["mcp:fixture", "skill:fixture"]);
    expect(body.agent_model).toBe("fixture-model");
    expect(body.reasoning_effort).toBe("high");
    expect(body.service_tier).toBe("fast");
    const beforeTool = "正在读取两个工坊。";
    const afterTool = "已读取两处项目。\n\n```text\n跨工坊结果\n```";
    const answer = beforeTool + afterTool;
    messages.push({
      id: "answer",
      role: "assistant",
      content: answer,
      references: [],
      created_at: timestamp,
      run_id: "run",
    });
    const completed = {
      run: {
        id: "run",
        conversation_id: conversation.id,
        status: "completed",
        agent_id: "codex",
        agent_model: body.agent_model,
        reasoning_effort: body.reasoning_effort,
        service_tier: body.service_tier,
        usage: {
          input_tokens: 800,
          output_tokens: 24,
          context_used: 823,
          context_limit: 10000,
        },
        partial_text: answer,
        context: body.context,
      },
      events: [
        {
          kind: "reasoning_summary",
          sequence: 1,
          created_at: timestamp,
          payload: { text: "核对两个工坊的读取范围" },
        },
        {
          kind: "assistant_delta",
          sequence: 2,
          created_at: timestamp,
          payload: { text: beforeTool },
        },
        ...["项目目录", "视觉项目", "特效项目", "面试项目"].flatMap(
          (target, index) => [
            {
              kind: "tool_call",
              sequence: 3 + index * 2,
              created_at: timestamp,
              payload: {
                tool_call_id: `tool-${index}`,
                tool_name: "operations",
                arguments: { path: target },
              },
            },
            {
              kind: "tool_result",
              sequence: 4 + index * 2,
              created_at: timestamp,
              payload: {
                tool_call_id: `tool-${index}`,
                result: { target, verified: true },
              },
            },
          ],
        ),
        {
          kind: "assistant_delta",
          sequence: 11,
          created_at: timestamp,
          payload: { text: afterTool },
        },
      ],
    };
    runs.push(completed);
    return route.fulfill({ json: completed });
  });
  await page.route(`**${base}/runs/run`, (route) =>
    route.fulfill({ json: runs[0] }),
  );

  await page.route(`**${base}/files`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            kind: "work",
            name: "result.json",
            bytes: 32,
            sha256: "0".repeat(64),
          },
        ],
      },
    }),
  );
  await page.route(`**${base}/files/work/result.json`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: '{\n  "verified": true\n}\n',
    }),
  );
  await page.addInitScript(() =>
    localStorage.setItem("future_props_theme", "dark"),
  );
  await page.goto("/amadeus");
  await page.getByRole("button", { name: "选择工坊项目" }).click();
  const projects = page.getByRole("dialog", { name: "选择工坊项目" });
  await expect(
    projects.getByRole("button", { name: "关闭项目选择" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    projects.getByRole("textbox", { name: "搜索工坊或项目" }),
  ).toBeFocused();
  await expect(
    projects.getByRole("checkbox", { name: "分镜视觉样稿 1", exact: true }),
  ).toBeVisible();
  await expect(
    projects
      .getByRole("group", { name: "导演台" })
      .getByRole("button", { name: "读取失败，重试" }),
  ).toBeVisible();
  await projects.getByRole("checkbox", { name: "片头特效" }).check();
  await projects.getByRole("checkbox", { name: "项目面试" }).check();
  await expect(projects.getByText("已选 2 / 20 个项目")).toBeVisible();
  await projects.screenshot({
    path: testInfo.outputPath("project-picker-desktop.png"),
  });
  await page.keyboard.press("Escape");
  await expect(projects).toHaveCount(0);
  await page.getByRole("button", { name: "能力", exact: true }).click();
  const capabilities = page.getByRole("dialog", { name: "配置能力" });
  await capabilities.getByRole("checkbox", { name: /验收能力/ }).check();
  await capabilities.getByRole("tab", { name: /^MCP/ }).click();
  await capabilities.getByRole("checkbox", { name: /验收能力/ }).check();
  await capabilities.getByRole("button", { name: "应用更改" }).click();
  await page.getByRole("combobox", { name: "选择模型" }).click();
  await page.getByRole("option", { name: "验收模型" }).click();
  await page.getByRole("combobox", { name: "推理强度" }).click();
  await page.getByRole("option", { name: "推理 · high" }).click();
  await page.getByRole("combobox", { name: "Codex 服务档位" }).click();
  await page.getByRole("option", { name: "快档", exact: true }).click();
  await page
    .getByRole("textbox", { name: "向 Amadeus 提问" })
    .fill("检查这两个项目");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("已读取两处项目。")).toBeVisible();
  await expect(page.getByRole("button", { name: "复制代码" })).toBeVisible();
  await page.getByText("思考", { exact: true }).click();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "核对两个工坊的读取范围" }),
  ).toBeVisible();
  const activity = page.getByRole("button", { name: /工具调用 · 4 · 已完成/ });
  const firstTool = page.getByRole("button", {
    name: /查找可用操作 · 项目目录/,
  });
  const selectedTool = page.getByRole("button", {
    name: /查找可用操作 · 特效项目/,
  });
  await expect(activity).toHaveAttribute("aria-expanded", "false");
  await expect(firstTool).toHaveCount(0);
  await expect(selectedTool).toBeVisible();
  await selectedTool.click();
  const inspector = page.getByRole("complementary", { name: "执行详情" });
  await expect(
    inspector.getByRole("region", { name: "工具回执" }),
  ).toContainText('"target": "特效项目"');
  await expect(selectedTool).toHaveAttribute("aria-pressed", "true");
  await inspector.getByRole("button", { name: "收起执行详情" }).click();
  await page.getByRole("button", { name: "+1 更多…", exact: true }).click();
  await expect(activity).toHaveAttribute("aria-expanded", "true");
  await expect(firstTool).toBeVisible();
  expect(
    await page.getByText("正在读取两个工坊。", { exact: true }).count(),
  ).toBe(1);
  expect(
    await page.getByText("已读取两处项目。", { exact: true }).count(),
  ).toBe(1);
  await expect(
    page.getByText("Token · 输入 800 · 输出 24", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("上下文 823 / 10,000 Tokens", { exact: true }),
  ).toBeVisible();
  const positions = await Promise.all(
    [
      page.getByText("正在读取两个工坊。", { exact: true }),
      activity,
      page.getByText("已读取两处项目。", { exact: true }),
    ].map(async (locator) => (await locator.boundingBox())!.y),
  );
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  await page.getByRole("button", { name: "会话文件", exact: true }).click();
  await page
    .getByRole("dialog", { name: "会话文件" })
    .getByRole("button", { name: "预览" })
    .click();
  const filePreview = page.getByRole("complementary", { name: "文件预览" });
  await expect(
    filePreview.getByRole("region", { name: "result.json" }),
  ).toContainText('"verified": true');
  await expect(
    page.getByRole("textbox", { name: "向 Amadeus 提问" }),
  ).toBeVisible();
  await activity.click();
  await expect(activity).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: testInfo.outputPath("amadeus-transcript-desktop.png"),
  });
  await filePreview.getByRole("button", { name: "关闭文件预览" }).focus();
  await page.keyboard.press("Escape");
  await expect(filePreview).toHaveCount(0);
  await activity.click();
  await page.reload();
  await expect(activity).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("已读取两处项目。", { exact: true })).toHaveCount(
    1,
  );

  await page.goto("/apps/motion-compositor");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打开 Amadeus", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("future-props:amadeus-context", {
        detail: { projectId: "current-project", title: "当前工坊项目" },
      }),
    ),
  );
  await page.getByRole("button", { name: "打开 Amadeus", exact: true }).click();
  const sidebar = page.getByRole("complementary", { name: "Amadeus 助手" });
  await expect(sidebar.getByText("已读取两处项目。")).toBeVisible();
  await sidebar
    .getByRole("button", { name: /查找可用操作 · 特效项目/ })
    .click();
  const narrowInspector = sidebar.getByRole("complementary", {
    name: "执行详情",
  });
  await expect(
    narrowInspector.getByRole("region", { name: "工具回执" }),
  ).toContainText('"target": "特效项目"');
  await narrowInspector.screenshot({
    path: testInfo.outputPath("amadeus-tool-detail-narrow.png"),
  });
  await narrowInspector.getByRole("button", { name: "收起执行详情" }).click();
  await expect(
    sidebar.getByRole("combobox", { name: "Codex 服务档位" }),
  ).toContainText("快档");
  await sidebar.screenshot({
    path: testInfo.outputPath("amadeus-transcript-narrow.png"),
  });
  await expect(
    sidebar.getByRole("combobox", { name: "推理强度" }),
  ).toContainText("推理 · high");
  await expect(
    sidebar.getByRole("link", { name: "在新标签页打开 Amadeus" }),
  ).toHaveAttribute("href", "/amadeus?conversation=fusion-fixture");
  await sidebar.getByRole("button", { name: "选择工坊项目" }).click();
  await expect(
    projects.getByRole("checkbox", { name: "片头特效" }),
  ).toBeChecked();
  await expect(
    projects.getByRole("checkbox", { name: "项目面试" }),
  ).toBeChecked();
  await expect(
    projects.getByRole("button", { name: "移除 当前工坊项目" }),
  ).toBeVisible();
  const search = projects.getByRole("textbox", { name: "搜索工坊或项目" });
  await search.fill("面试");
  await expect(
    projects.getByRole("checkbox", { name: "片头特效" }),
  ).toHaveCount(0);
  const interviewProject = projects.getByRole("checkbox", { name: "项目面试" });
  await interviewProject.uncheck();
  await interviewProject.check();
  await projects.screenshot({
    path: testInfo.outputPath("project-picker-dark-mobile.png"),
  });
  await projects.getByRole("button", { name: "完成", exact: true }).click();
  await expect(projects).toHaveCount(0);
  await expect(
    sidebar.getByRole("button", { name: "选择工坊项目" }),
  ).toBeFocused();
});
