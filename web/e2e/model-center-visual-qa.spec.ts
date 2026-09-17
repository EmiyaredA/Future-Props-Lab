import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const outputRoot = resolve(
  process.env.FPL_VISUAL_QA_DIR ?? "../.local/visual-qa/model-center",
);
const desktop = { width: 1600, height: 1000 };
const mobile = { width: 390, height: 844 };

const catalog = {
  revision: 7,
  suppliers: [],
  providers: [
    {
      id: "openai",
      supplier_id: null,
      name: "OpenAI",
      kind: "openai",
      base_url: "https://api.openai.com/v1",
      enabled: true,
      has_api_key: true,
      api_key_hint: "•••• demo",
      origin: "user",
      managed_fields: [],
      models: [
        {
          id: "gpt-4o",
          provider_id: "openai",
          slug: "gpt-4o",
          label: "GPT-4o",
          description: "通用多模态模型",
          capabilities: ["chat", "vision", "tools"],
          categories: ["text_generation"],
          enabled: true,
        },
      ],
    },
    {
      id: "image",
      supplier_id: null,
      name: "图像生成服务",
      kind: "senseaudio_image",
      base_url: "",
      enabled: true,
      has_api_key: false,
      api_key_hint: "",
      origin: "user",
      managed_fields: [],
      models: [
        {
          id: "image-1",
          provider_id: "image",
          slug: "image-1",
          label: "Image 1",
          description: "图像生成模型",
          capabilities: ["image_generation"],
          categories: ["image_generation"],
          enabled: true,
        },
      ],
    },
    {
      id: "video",
      supplier_id: null,
      name: "视频生成服务",
      kind: "senseaudio_video",
      base_url: "",
      enabled: true,
      has_api_key: false,
      api_key_hint: "",
      origin: "user",
      managed_fields: [],
      models: [
        {
          id: "video-1",
          provider_id: "video",
          slug: "video-1",
          label: "Video 1",
          description: "视频生成模型",
          capabilities: ["video_generation"],
          categories: ["video_generation"],
          enabled: true,
        },
      ],
    },
    {
      id: "speech",
      supplier_id: null,
      name: "语音识别服务",
      kind: "openai",
      base_url: "",
      enabled: true,
      has_api_key: false,
      api_key_hint: "",
      origin: "user",
      managed_fields: [],
      models: [
        {
          id: "speech-1",
          provider_id: "speech",
          slug: "speech-1",
          label: "Speech 1",
          description: "语音识别模型",
          capabilities: ["speech_recognition"],
          categories: ["speech_to_text"],
          enabled: true,
        },
      ],
    },
    {
      id: "realtime",
      supplier_id: null,
      name: "实时语音服务",
      kind: "openai_realtime",
      base_url: "wss://example.test/realtime",
      enabled: true,
      has_api_key: false,
      api_key_hint: "",
      origin: "user",
      managed_fields: [],
      models: [
        {
          id: "realtime-1",
          provider_id: "realtime",
          slug: "realtime-1",
          label: "Realtime 1",
          description: "实时语音模型",
          capabilities: ["voice"],
          categories: ["end_to_end_speech"],
          enabled: true,
        },
      ],
    },
  ],
};

const conversation = {
  id: "visual-conversation",
  title: "模型效果评估",
  model_id: "gpt-4o",
  model_slug: "gpt-4o",
  revision: 1,
  created_at: "2026-09-10T08:00:00Z",
  updated_at: "2026-09-10T08:00:00Z",
  system_prompt: "你是一个专业、友好、乐于助人的 AI 助手。",
  temperature: 0.7,
  max_tokens: 2048,
  tools: [],
  draft_attachments: [],
  messages: [
    {
      id: "visual-message",
      turn_id: "visual-turn",
      role: "assistant",
      content:
        "当然可以。下面是一个用于验证模型输出质量的示例回答。\n\n1. 结构清晰\n2. 信息完整\n3. 语气自然",
      model_slug: "gpt-4o",
      status: "completed",
      error_message: null,
      attachments: [],
      tool_calls: [],
      created_at: "2026-09-10T08:01:00Z",
    },
  ],
};

const tools = [
  ["提示词评测", "评估提示词在不同模型下的输出质量。", "success"],
  ["模型对比", "在相同测试集下对比多个模型表现。", "success"],
  ["批量测试", "批量导入测试数据并生成评测报告。", "success"],
  ["安全性检测", "检测模型输出的安全风险与合规性。", "failure"],
  ["上下文压测", "测试模型在长上下文场景下的性能。", "success"],
  ["JSON 结构化校验", "验证模型输出是否符合 Schema。", "success"],
  ["多轮对话评测", "评估多轮对话中的一致性和连贯性。", "success"],
  ["工具调用测试", "测试模型识别参数与调用工具的能力。", "success"],
].map(([name, description, mock_kind], index) => ({
  id: `visual-tool-${index}`,
  name,
  description,
  parameter_count: index % 3,
  input_schema: { type: "object", properties: {}, additionalProperties: true },
  mock_kind,
  mock_result: { ok: true },
  error_code: mock_kind === "failure" ? "mock_failure" : "",
  error_message: mock_kind === "failure" ? "模拟安全检测失败" : "",
  delay_ms: index * 20,
  enabled: index !== 3,
  revision: 0,
  last_used_at: `2026-09-${String(10 + index).padStart(2, "0")}T08:00:00Z`,
  created_at: "2026-09-01T08:00:00Z",
  updated_at: "2026-09-10T08:00:00Z",
}));

const logRows = Array.from({ length: 10 }, (_, index) => ({
  id: `visual-log-${index}`,
  model:
    index % 3 === 0 ? "gpt-4o" : index % 3 === 1 ? "deepseek-chat" : "qwen-max",
  trace_id: `trace-${index}`,
  call_source: "model_playground",
  provider_kind: "openai",
  total_tokens: 512 + index * 128,
  latency_ms: 180 + index * 37,
  status: index === 6 ? "error" : "success",
  created_at: `2026-09-10T08:${String(index).padStart(2, "0")}:00Z`,
}));

async function installFixedData(page: Page) {
  await page.route("**/v1/model-providers", (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.route("**/v1/model-test/conversations**", (route) =>
    route.fulfill({ json: { items: [conversation] } }),
  );
  await page.route("**/v1/model-test/tools**", (route) =>
    route.fulfill({
      json: {
        items: tools,
        overview: {
          total: tools.length,
          enabled: tools.filter((tool) => tool.enabled).length,
          failure: 1,
          today_runs: 24,
          recent: tools.slice(0, 3),
        },
      },
    }),
  );
  await page.route("**/v1/model-test/realtime-options", (route) =>
    route.fulfill({
      json: {
        models: [
          {
            id: "realtime-1",
            provider_id: "realtime",
            provider_name: "实时语音服务",
            provider_kind: "openai_realtime",
            slug: "realtime-1",
            label: "Realtime 1",
            voices: [{ value: "alloy", label: "Alloy" }],
            default_voice: "alloy",
            input_sample_rate: 16000,
            output_sample_rate: 24000,
            commit_silence_ms: 400,
            supports_interruption: true,
            supports_tools: true,
            instructions_max_chars: 20000,
            greeting_max_chars: 2000,
            input_format: "pcm_s16le",
            output_format: "pcm_s16le",
            channels: 1,
            client_vad: {
              positive_speech_threshold: {
                default: 0.55,
                minimum: 0,
                maximum: 1,
                step: 0.01,
              },
              negative_speech_threshold: {
                default: 0.38,
                minimum: 0,
                maximum: 1,
                step: 0.01,
              },
              min_speech_ms: {
                default: 320,
                minimum: 0,
                maximum: 5000,
                step: 32,
              },
              pre_speech_pad_ms: {
                default: 160,
                minimum: 0,
                maximum: 2000,
                step: 32,
              },
              commit_silence_ms: {
                default: 400,
                minimum: 100,
                maximum: 5000,
                step: 50,
              },
            },
            playback: {
              start_buffer_ms: {
                default: 400,
                minimum: 0,
                maximum: 2000,
                step: 50,
              },
              recovery_buffer_ms: {
                default: 800,
                minimum: 0,
                maximum: 3000,
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
      },
    }),
  );
  await page.route("**/v1/account/log-workspaces", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/v1/llm-call-logs**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/stats"))
      return route.fulfill({
        json: {
          calls_today: 1284,
          total_tokens_today: 2480000,
          avg_latency_ms_today: 286,
          errors_today: 1,
        },
      });
    if (path.endsWith("/visual-log-0"))
      return route.fulfill({
        json: {
          ...logRows[0],
          prompt_tokens: 1024,
          completion_tokens: 512,
          request_payload: {
            model: "gpt-4o",
            messages: [
              { role: "user", content: "请解释一下大模型的主要应用场景。" },
            ],
            temperature: 0.7,
          },
          response_payload: {
            choices: [
              {
                message: {
                  content: "模型应用场景包括内容生成、分析和自动化。",
                },
              },
            ],
          },
          error_message: null,
          reproduction_supported: true,
          reproduction_reason: "",
        },
      });
    return route.fulfill({
      json: { total: 1284, page: 1, page_size: 25, items: logRows },
    });
  });
}

async function prepareOutput(kind: "fixed" | "real") {
  const directory = join(outputRoot, kind);
  await mkdir(directory, { recursive: true });
  return directory;
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page
    .getByRole("button", {
      name: theme === "light" ? "浅色" : "深色",
      exact: true,
    })
    .click();
}

async function assertNoRootOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("captures fixed-data model center references across themes and modes", async ({
  page,
}) => {
  await installFixedData(page);
  const directory = await prepareOutput("fixed");

  for (const theme of ["light", "dark"] as const) {
    await page.setViewportSize(desktop);
    await page.goto("/model-service");
    await setTheme(page, theme);
    await expect(
      page.getByRole("heading", { name: "模型服务", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: join(directory, `model-service-${theme}-1600x1000.png`),
      fullPage: false,
    });

    await page.goto("/model-test");
    await expect(
      page.getByRole("heading", { name: "模型测试", exact: true }),
    ).toBeVisible();
    for (const [mode, slug] of [
      ["文本对话", "chat"],
      ["图像生成", "image"],
      ["视频生成", "video"],
      ["语音识别", "speech"],
      ["实时语音", "realtime"],
    ] as const) {
      await page.getByRole("tab", { name: mode, exact: true }).click();
      await page.screenshot({
        path: join(directory, `model-test-${theme}-${slug}-1600x1000.png`),
        fullPage: false,
      });
    }

    await page.goto("/model-test-tools");
    await expect(
      page.getByRole("heading", { name: "测试工具", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: join(directory, `test-tools-${theme}-1600x1000.png`),
      fullPage: false,
    });

    await page.goto("/model-call-logs");
    await expect(
      page.getByRole("heading", { name: "模型调用日志", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "查看", exact: true })
      .first()
      .click();
    await expect(page.getByRole("dialog", { name: "调用详情" })).toBeVisible();
    await page.screenshot({
      path: join(directory, `call-logs-${theme}-1600x1000.png`),
      fullPage: false,
    });
    await assertNoRootOverflow(page);
  }

  await page.setViewportSize(mobile);
  await setTheme(page, "light");
  for (const [path, name] of [
    ["/model-service", "model-service"],
    ["/model-test", "model-test"],
    ["/model-test-tools", "test-tools"],
    ["/model-call-logs", "call-logs"],
  ] as const) {
    await page.goto(path);
    await page.screenshot({
      path: join(directory, `${name}-light-390x844.png`),
      fullPage: false,
    });
    await assertNoRootOverflow(page);
  }
});

test("captures current workspace model center smoke views", async ({
  page,
}) => {
  const directory = await prepareOutput("real");
  await page.setViewportSize(desktop);
  for (const theme of ["light", "dark"] as const) {
    for (const [path, name] of [
      ["/model-service", "model-service"],
      ["/model-test", "model-test"],
      ["/model-test-tools", "test-tools"],
      ["/model-call-logs", "call-logs"],
    ] as const) {
      await page.goto(path);
      await setTheme(page, theme);
      await expect(
        page.locator("main, [role=main], .page").first(),
      ).toBeVisible();
      await page.screenshot({
        path: join(directory, `${name}-${theme}-current-1600x1000.png`),
        fullPage: false,
      });
      await assertNoRootOverflow(page);
    }
  }
});

test("captures current workspace core entry smoke views", async ({ page }) => {
  const directory = join(outputRoot, "core-entries");
  await mkdir(directory, { recursive: true });
  await page.setViewportSize(desktop);
  for (const theme of ["light", "dark"] as const) {
    for (const [path, name] of [
      ["/home", "home"],
      ["/apps", "apps"],
      ["/files", "files"],
      ["/tools", "tools"],
      ["/integrations/tool-apis", "integrations"],
    ] as const) {
      await page.goto(path);
      await setTheme(page, theme);
      await page.waitForTimeout(600);
      await expect(
        page.locator("main, [role=main], .page, section").first(),
      ).toBeVisible();
      await page.screenshot({
        path: join(directory, `${name}-${theme}-current-1600x1000.png`),
        fullPage: false,
      });
      await assertNoRootOverflow(page);
    }
  }
});
