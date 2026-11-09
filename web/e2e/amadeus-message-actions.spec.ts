import { expect, test } from "@playwright/test";

test("visual split and standalone assistant expose usage, pinned messages, selection and forks", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1480, height: 920 });
  await page.goto("/apps/visual-workshop");
  const origin = new URL(page.url()).origin;
  const csrf = (await page.context().cookies()).find(
    ({ name }) => name === "fpl_csrf",
  );
  const headers = { Origin: origin, "X-CSRF-Token": csrf!.value };
  const project = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "视觉分屏 · 上下文与消息验收", kind: "canvas" },
  });
  expect(project.ok(), await project.text()).toBeTruthy();
  const { id: projectId } = await project.json();
  const projectUrl = `/apps/visual-workshop/projects/${projectId}/canvas`;
  const canvas = await page.request.put(
    `/v1/visual-workshop/projects/${projectId}/canvas`,
    {
      headers,
      data: {
        expected_revision: 0,
        nodes: [
          {
            id: "opening",
            title: "开场画面",
            kind: "image",
            position: { x: 220, y: 180 },
          },
        ],
        edges: [],
      },
    },
  );
  expect(canvas.ok(), await canvas.text()).toBeTruthy();

  const created = await page.request.post("/v1/amadeus/conversations", {
    headers,
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  const conversationPath = `/v1/amadeus/conversations/${id}`;
  for (const [expected_revision, [role, content]] of [
    ["user", "请帮我梳理视觉项目的开场画面。"],
    ["assistant", "已核对项目中的开场节点。可以继续补充画面描述和镜头节奏。"],
    ["user", "这是分叉点之后的消息。"],
  ].entries()) {
    const saved = await page.request.post(conversationPath + "/messages", {
      headers,
      data: { expected_revision, role, content, references: [] },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
  }
  const me = await page.request.get("/v1/auth/me");
  const owner = (await me.json()).user.id;
  await page.addInitScript(
    ({ owner, id }) => {
      localStorage.setItem(`amadeus-current:${owner}`, id);
    },
    { owner, id },
  );
  const at = "2026-11-08T09:00:00Z";
  const run = {
    conversation_id: id,
    model_id: "code-agent",
    agent_model: "Codex · fixture",
    agent_id: "codex",
    status: "completed",
    partial_text: "",
    created_at: at,
  };
  const snapshots = [
    {
      run: { ...run, id: "older", created_at: "2026-11-08T08:00:00Z" },
      events: [],
    },
    {
      run: {
        ...run,
        id: "fixture",
        usage: {
          context_used: 34_000,
          context_limit: 100_000,
          input_tokens: 8_100,
          output_tokens: 700,
          cached_input_tokens: 2_500,
          reasoning_tokens: 0,
          total_tokens: 8_800,
        },
      },
      events: [],
    },
  ];
  let resuming = false;
  let used = 34_000;
  const currentSnapshot = () => ({
    run: {
      ...snapshots[1].run,
      status: resuming ? "running" : "completed",
      usage: { ...snapshots[1].run.usage, context_used: used },
    },
    events: [
      {
        sequence: used,
        kind: "run_usage",
        created_at: at,
        payload: { context_used: used },
      },
    ],
  });
  await page.route("**" + conversationPath + "/runs", (route) =>
    route.fulfill({ json: [snapshots[0], currentSnapshot()] }),
  );
  await page.route("**/v1/amadeus/runs/active", (route) =>
    route.fulfill({ json: resuming ? currentSnapshot() : null }),
  );
  await page.route("**" + conversationPath + "/runs/fixture", (route) =>
    route.fulfill({ json: currentSnapshot() }),
  );
  await page.goto(projectUrl);
  await page.getByRole("button", { name: "打开 Amadeus", exact: true }).click();
  const pane = page.getByRole("complementary", { name: "Amadeus 助手" });
  const divider = page.getByRole("separator", {
    name: "调整 Amadeus 分屏宽度",
  });
  await expect(divider).toBeVisible();
  await expect(
    pane.getByRole("button", { name: "上下文窗口", exact: true }),
  ).toHaveText("34%");
  await pane.getByRole("button", { name: "上下文窗口", exact: true }).focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "34,000 / 100,000 Token",
  );
  await pane
    .getByRole("button", { name: "上下文窗口", exact: true })
    .press("Enter");
  const context = page.getByRole("dialog", { name: "上下文窗口" });
  await expect(context).toContainText("34,000 / 100,000 Token");
  await expect(context).toContainText("Codex · fixture");
  await context.getByRole("button", { name: "关闭" }).press("Escape");
  await expect(context).toBeHidden();
  await pane.getByRole("button", { name: "对话用量", exact: true }).click();
  const usage = page.getByRole("dialog", { name: "对话用量" });
  await expect(usage).toContainText("1 / 2 轮有 Token 记录");
  await expect(usage.getByRole("row", { name: /推理/ })).toContainText("0");
  await expect(usage.getByRole("row", { name: /缓存写入/ })).toContainText(
    "未记录",
  );
  await page.screenshot({ path: info.outputPath("visual-split-usage.png") });
  await usage.getByRole("button", { name: "关闭" }).click();

  const reply = pane
    .getByRole("article", { name: "Amadeus 回复" })
    .filter({ hasText: "已核对项目" });
  await reply.hover();
  await reply.getByRole("button", { name: "置顶消息", exact: true }).click();
  await expect(
    reply.getByRole("button", { name: "取消置顶消息" }),
  ).toHaveAttribute("aria-pressed", "true");
  await reply.getByRole("button", { name: "选择消息", exact: true }).click();
  const selection = pane.getByLabel("消息多选");
  await expect(selection).toContainText("已选 1 条消息");
  await selection.getByRole("button", { name: "全选" }).click();
  await expect(selection).toContainText("已选 3 条消息");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await selection.getByRole("button", { name: "复制", exact: true }).click();
  await expect(pane.getByText("已复制 3 条消息")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "请帮我梳理视觉项目的开场画面。\n\n已核对项目中的开场节点。可以继续补充画面描述和镜头节奏。\n\n这是分叉点之后的消息。",
  );
  await selection.getByRole("button", { name: "取消" }).click();
  await reply.getByRole("button", { name: "选择消息", exact: true }).click();
  await page.screenshot({
    path: info.outputPath("visual-split-message-actions.png"),
  });
  await selection.getByRole("button", { name: "取消" }).click();

  resuming = true;
  await page.reload();
  await page.getByRole("button", { name: "打开 Amadeus", exact: true }).click();
  await expect(
    reply.getByRole("button", { name: "取消置顶消息" }),
  ).toBeVisible();
  await pane.getByRole("button", { name: "置顶消息 · 1 条" }).click();
  await page.getByRole("menuitem", { name: /已核对项目/ }).click();
  await expect(reply).toBeFocused();
  await expect(
    pane.getByRole("button", { name: "停止", exact: true }),
  ).toBeVisible();
  used = 47_000;
  await expect(
    pane.getByRole("button", { name: "上下文窗口", exact: true }),
  ).toHaveText("47%");
  resuming = false;
  await expect(
    pane.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await pane.getByRole("button", { name: "关闭 Amadeus" }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.getByRole("button", { name: "打开 Amadeus", exact: true }).click();
  await expect(divider).toBeVisible();
  await divider.press("Home");
  await expect(divider).toHaveAttribute("aria-valuenow", "400");
  await expect(
    pane.getByRole("button", { name: "发送", exact: true }),
  ).toBeInViewport();
  await pane.getByRole("button", { name: "上下文窗口", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "上下文窗口" })).toContainText(
    "47,000 / 100,000",
  );
  await page
    .getByRole("dialog", { name: "上下文窗口" })
    .getByRole("button", { name: "关闭" })
    .click();
  await pane.getByRole("button", { name: "切换为右侧弹窗" }).click();
  await expect(divider).toBeHidden();
  await expect(
    pane.getByRole("button", { name: "上下文窗口", exact: true }),
  ).toBeVisible();

  const touch = await browser.newContext({
    baseURL: origin,
    storageState: await page.context().storageState(),
    hasTouch: true,
    viewport: { width: 420, height: 850 },
  });
  try {
    const phone = await touch.newPage();
    await phone.goto(`/amadeus?conversation=${id}`);
    const phoneReply = phone
      .getByRole("article", { name: "Amadeus 回复" })
      .filter({ hasText: "已核对项目" });
    await phoneReply.getByRole("button", { name: "消息操作" }).tap();
    await phoneReply.getByRole("button", { name: "从此消息分叉" }).tap();
    const confirm = phone.getByRole("alertdialog", {
      name: "从此消息创建分叉",
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "创建分叉" }).tap();
    await expect(confirm).toBeHidden();
    await expect(phoneReply).toBeVisible();
    await expect(
      phone.getByText("这是分叉点之后的消息。", { exact: true }),
    ).toHaveCount(0);
    await expect(
      phone.getByRole("textbox", { name: "向 Amadeus 提问" }),
    ).toBeVisible();
    expect(new URL(phone.url()).searchParams.get("conversation")).not.toBe(id);
    await phone.reload();
    await expect(phoneReply).toBeVisible();
    await expect(
      phone.getByText("这是分叉点之后的消息。", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await touch.close();
  }
});
