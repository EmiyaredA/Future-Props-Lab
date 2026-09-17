import { expect, test } from "@playwright/test";

test("sidebar chevron points inward when collapsed and custom select chevrons stay centered", async ({
  page,
}) => {
  await page.goto("/model-call-logs");
  await expect(
    page.getByRole("heading", { name: "模型调用日志" }),
  ).toBeVisible();
  await expect(page.locator(".studio-sidebar")).toHaveCSS("width", "272px");
  await expect(page.locator("select")).toHaveCount(0);

  const offsets = await page.locator(".select-chevron").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const parent = node.parentElement?.getBoundingClientRect();
      return parent
        ? rect.top + rect.height / 2 - (parent.top + parent.height / 2)
        : 99;
    }),
  );
  expect(offsets.length).toBeGreaterThan(3);
  expect(offsets.every((offset) => Math.abs(offset) < 0.6)).toBe(true);

  const navOffset = await page.locator(".nav-chevron").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const parent = node.parentElement?.getBoundingClientRect();
    return parent
      ? rect.top + rect.height / 2 - (parent.top + parent.height / 2)
      : 99;
  });
  expect(Math.abs(navOffset)).toBeLessThan(0.6);

  await expect(page.locator(".nav-chevron")).toHaveCSS(
    "transform",
    "matrix(0, 1, -1, 0, 0, 0)",
  );
  await page.getByRole("button", { name: "基模型" }).click();
  await expect(page.locator(".nav-chevron")).toHaveCSS(
    "transform",
    "matrix(-1, 0, 0, -1, 0, 0)",
  );
});

test("model test workspace keeps panels readable on desktop and narrow screens", async ({
  page,
}) => {
  const conversation = {
    id: "conversation-e2e",
    title: "效果测试",
    model_id: "model-e2e",
    model_slug: "demo-chat",
    revision: 1,
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:00Z",
    system_prompt: "",
    temperature: 0.7,
    max_tokens: 1024,
    messages: [
      {
        id: "message-e2e",
        turn_id: "turn-e2e",
        role: "assistant",
        content: "调用示例\n\n```bash\ncurl https://example.test/v1\n```",
        model_slug: "demo-chat",
        status: "completed",
        error_message: null,
        created_at: "2026-08-03T00:00:00Z",
      },
    ],
  };
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
            has_api_key: false,
            api_key_hint: "",
            models: [
              {
                id: "model-e2e",
                provider_id: "provider-e2e",
                slug: "demo-chat",
                label: "Demo Chat",
                description: "",
                capabilities: ["chat", "vision"],
                categories: ["text_generation"],
                enabled: true,
              },
            ],
          },
        ],
      }),
    });
  });
  await page.route("**/v1/model-test/conversations", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [conversation] }),
    });
  });
  await page.route(
    "**/v1/model-test/conversations/conversation-e2e",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(conversation),
      });
    },
  );

  await page.goto("/model-test");
  await expect(
    page.getByRole("heading", { name: "模型测试", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "测试模型" })).toContainText(
    "Demo Chat",
  );
  await expect(page.locator("select")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "复制原始输出" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "复制代码" })).toBeVisible();
  await expect(page.locator("code.hljs")).toBeVisible();
  await expect(page.getByRole("button", { name: "添加图片" })).toBeEnabled();

  await page.goto("/model-service");
  await expect(page.locator(".mc-model-table thead")).toBeVisible();
  await page.getByRole("button", { name: "Demo Chat 操作" }).click();
  await expect(
    page.getByRole("menuitem", { name: "编辑" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "删除" }),
  ).toBeVisible();
  await page.goto("/model-test");

  await page.setViewportSize({ width: 900, height: 760 });
  await expect(page.getByRole("button", { name: "添加图片" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "对话", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await expect(page.locator(".conversation-panel")).toHaveClass(/mobile-open/);
  await page
    .locator(".conversation-panel")
    .getByRole("button", { name: "收起" })
    .click();
  await page.getByRole("button", { name: "参数", exact: true }).click();
  await expect(page.locator(".settings-panel")).toHaveClass(/mobile-open/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "打开主导航", exact: true }).click();
  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("realtime voice tab is capability-driven, keyboard reachable and responsive", async ({
  page,
}) => {
  await page.route("**/v1/model-providers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        revision: 1,
        providers: [
          {
            id: "provider-realtime-e2e",
            name: "SenseAudio 实时语音",
            kind: "senseaudio_realtime",
            base_url: "wss://voice.example/realtime",
            enabled: true,
            has_api_key: true,
            api_key_hint: "•••• demo",
            models: [
              {
                id: "model-realtime-e2e",
                provider_id: "provider-realtime-e2e",
                slug: "senseaudio-realtime-1.0",
                label: "Realtime 1.0",
                description: "",
                capabilities: ["voice"],
                categories: ["end_to_end_speech"],
                enabled: true,
              },
            ],
          },
        ],
      }),
    });
  });
  await page.route("**/v1/model-test/conversations", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });
  await page.route("**/v1/model-test/realtime-options", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          {
            id: "model-realtime-e2e",
            provider_id: "provider-realtime-e2e",
            provider_name: "SenseAudio 实时语音",
            provider_kind: "senseaudio_realtime",
            slug: "senseaudio-realtime-1.0",
            label: "Realtime 1.0",
            voices: [{ value: "f_m_0009_a", label: "气质学姐 · 开心" }],
            default_voice: "f_m_0009_a",
            input_sample_rate: 16000,
            output_sample_rate: 24000,
            commit_silence_ms: 400,
            supports_interruption: true,
            supports_tools: true,
            instructions_max_chars: 20_000,
            greeting_max_chars: 2_000,
            input_format: "pcm_s16le",
            output_format: "pcm_s16le",
            channels: 1,
            client_vad: {
              positive_speech_threshold: {
                default: 0.55,
                minimum: 0.05,
                maximum: 1,
                step: 0.01,
              },
              negative_speech_threshold: {
                default: 0.38,
                minimum: 0,
                maximum: 0.95,
                step: 0.01,
              },
              min_speech_ms: {
                default: 320,
                minimum: 64,
                maximum: 5_000,
                step: 32,
              },
              pre_speech_pad_ms: {
                default: 160,
                minimum: 0,
                maximum: 2_000,
                step: 32,
              },
              commit_silence_ms: {
                default: 400,
                minimum: 100,
                maximum: 5_000,
                step: 50,
              },
            },
            playback: {
              start_buffer_ms: {
                default: 400,
                minimum: 0,
                maximum: 2_000,
                step: 50,
              },
              recovery_buffer_ms: {
                default: 800,
                minimum: 0,
                maximum: 3_000,
                step: 50,
              },
            },
            microphone: {
              echo_cancellation: true,
              noise_suppression: true,
              auto_gain_control: true,
            },
          },
        ],
      }),
    });
  });
  await page.route("**/v1/model-test/tools", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        revision: 0,
        overview: {
          total_tools: 0,
          enabled_tools: 0,
          today_runs: 0,
          success_rate: null,
        },
        items: [],
      }),
    });
  });

  await page.goto("/model-test");
  const realtimeTab = page.getByRole("tab", { name: "实时语音" });
  await realtimeTab.focus();
  await expect(realtimeTab).toBeFocused();
  await realtimeTab.press("Enter");

  await expect(realtimeTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox", { name: "测试模型" })).toContainText(
    "Realtime 1.0",
  );
  await expect(
    page.getByRole("combobox", { name: "实时语音音色" }),
  ).toContainText("气质学姐");
  await expect(page.getByRole("button", { name: "开始通话" })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "选择测试工具" }),
  ).toBeEnabled();
  await expect(page.getByText("输入 16 kHz pcm_s16le")).toBeVisible();
  await expect(page.getByText("输出 24 kHz pcm_s16le")).toBeVisible();
  await expect(page.getByLabel("开场白")).toBeVisible();
  await expect(page.getByLabel("静音断句")).toHaveValue("400");
  await expect(page.getByRole("switch", { name: "说话打断" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByText(/工具调用详情会写入测试记录/)).toBeVisible();
  await expect(page.locator("select")).toHaveCount(0);
  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".realtime-voice-stage.chat-panel")).toBeVisible();

  await page.setViewportSize({ width: 600, height: 760 });
  await expect(page.locator(".realtime-voice-layout")).toHaveCSS(
    "flex-direction",
    "column",
  );
  await expect(
    page.getByText(/双方的实时转写会按文本对话的形式显示/),
  ).toBeVisible();
});
