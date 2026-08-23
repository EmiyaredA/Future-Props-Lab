import { expect, test } from "@playwright/test";

test("creates, dry-runs and uses a mock tool in a model conversation", async ({
  page,
}) => {
  let created = false;
  let bound = false;
  let streamed = false;
  const now = "2026-08-23T12:00:00Z";
  const tool = {
    id: "tool-e2e",
    name: "get_weather",
    description: "查询指定城市的天气",
    parameter_count: 0,
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    mock_kind: "success",
    mock_result: { city: "上海", weather: "晴" },
    error_code: "mock_failure",
    error_message: "模拟工具执行失败",
    delay_ms: 0,
    enabled: true,
    revision: 0,
    last_used_at: null,
    created_at: now,
    updated_at: now,
  };
  const call = {
    id: "call-e2e",
    source: "model",
    conversation_id: "conversation-e2e",
    message_id: "assistant-e2e",
    run_id: "run-e2e",
    round_index: 1,
    tool_id: tool.id,
    tool_name: tool.name,
    tool_revision: 0,
    arguments: { city: "上海" },
    status: "completed",
    success: true,
    result: tool.mock_result,
    error_code: "",
    error_message: "",
    configured_delay_ms: 0,
    duration_ms: 3,
    created_at: now,
    updated_at: now,
  };

  await page.route("**/v1/model-test/tools**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/execute")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(call),
      });
      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/tools")) {
      created = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(tool),
      });
      return;
    }
    if (url.pathname.endsWith(`/tools/${tool.id}`)) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ...tool,
          bound_conversation_count: bound ? 1 : 0,
          recent_calls: [],
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: created ? [tool] : [],
        overview: {
          total: created ? 1 : 0,
          enabled: created ? 1 : 0,
          failure: 0,
          today_runs: 0,
          recent: [],
        },
      }),
    });
  });

  await page.goto("/model-test-tools");
  await page.getByRole("button", { name: "新建测试工具" }).first().click();
  await page.getByLabel("工具名称", { exact: true }).fill(tool.name);
  await page.getByLabel("工具说明", { exact: true }).fill(tool.description);
  await page.getByRole("button", { name: /下一步/ }).click();
  await page.getByLabel("固定返回 JSON").fill(JSON.stringify(tool.mock_result));
  await page.getByRole("button", { name: "保存测试工具" }).click();
  await expect(page).toHaveURL(`/model-test-tools/${tool.id}`);
  await page.getByRole("button", { name: /运行测试/ }).click();
  await expect(page.getByRole("heading", { name: "结果" })).toBeVisible();
  await expect(
    page.locator(".test-tool-run-result").getByText(/"weather": "晴"/),
  ).toBeVisible();

  await page.route("**/v1/model-providers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        revision: 1,
        providers: [
          {
            id: "provider-e2e",
            name: "测试供应商",
            kind: "openai",
            base_url: "",
            enabled: true,
            has_api_key: true,
            api_key_hint: "•••• demo",
            models: [
              {
                id: "model-e2e",
                provider_id: "provider-e2e",
                slug: "demo-tools",
                label: "Demo Tools",
                description: "",
                capabilities: ["chat", "tools"],
                categories: ["text_generation"],
                enabled: true,
              },
            ],
          },
        ],
      }),
    });
  });

  const conversation = () => ({
    id: "conversation-e2e",
    title: "工具闭环",
    model_id: "model-e2e",
    model_slug: "demo-tools",
    revision: bound ? 2 : 1,
    created_at: now,
    updated_at: now,
    system_prompt: "",
    temperature: 0.7,
    max_tokens: 1024,
    tools: bound ? [tool] : [],
    draft_attachments: [],
    messages: streamed
      ? [
          {
            id: "user-e2e",
            turn_id: "turn-e2e",
            role: "user",
            content: "上海天气怎么样？",
            model_slug: "demo-tools",
            status: "completed",
            error_message: null,
            attachments: [],
            tool_calls: [],
            created_at: now,
          },
          {
            id: "assistant-e2e",
            turn_id: "turn-e2e",
            role: "assistant",
            content: "上海今天晴朗。",
            model_slug: "demo-tools",
            status: "completed",
            error_message: null,
            attachments: [],
            tool_calls: [call],
            created_at: now,
          },
        ]
      : [],
  });

  await page.route("**/v1/model-test/conversations**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/messages/stream")) {
      streamed = true;
      const events = [
        {
          type: "start",
          schema_version: 2,
          sequence: 1,
          payload: { assistant_message_id: "assistant-e2e" },
        },
        {
          type: "step",
          schema_version: 2,
          sequence: 2,
          payload: { status: "completed", tool_call_id: call.id },
        },
        {
          type: "delta",
          schema_version: 2,
          sequence: 3,
          payload: { text: "上海今天晴朗。" },
        },
        {
          type: "done",
          schema_version: 2,
          sequence: 4,
          payload: { rounds: 2, agent_status: "completed" },
        },
      ];
      await route.fulfill({
        contentType: "text/event-stream",
        body: events
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      });
      return;
    }
    if (request.method() === "PATCH") {
      bound = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(conversation()),
      });
      return;
    }
    if (url.pathname.endsWith("/conversations")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ items: [conversation()] }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(conversation()),
    });
  });

  await page.route(
    "**/src/features/models/realtime/RealtimeVoiceConversation.tsx*",
    async (route) => {
      await route.fulfill({
        contentType: "application/javascript",
        body: "export function RealtimeVoiceConversation() { return null; }",
      });
    },
  );

  await page.goto("/model-test");
  await page.getByRole("button", { name: "选择测试工具" }).click();
  await page.getByRole("checkbox", { name: /get_weather/ }).click();
  await page.getByRole("button", { name: "保存选择" }).click();
  await expect(page.getByText("已选择 1 个")).toBeVisible();
  await page
    .getByRole("textbox", { name: "输入要测试的问题" })
    .fill("上海天气怎么样？");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("上海今天晴朗。")).toBeVisible();
  await page.getByRole("button", { name: /get_weather.*已完成/ }).click();
  await expect(page.getByText(/"weather": "晴"/)).toBeVisible();
});
