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
      kind: "senseaudio_realtime",
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
      created_at: "2026-09-10T08:01:00Z",
    },
  ],
};

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
  await page.route("**/v1/model-test/realtime-options", (route) =>
    route.fulfill({
      json: {
        models: [
          {
            id: "realtime-1",
            provider_id: "realtime",
            provider_name: "实时语音服务",
            provider_kind: "senseaudio_realtime",
            slug: "realtime-1",
            label: "Realtime 1",
            voices: [{ value: "alloy", label: "Alloy" }],
            default_voice: "alloy",
            input_sample_rate: 16000,
            output_sample_rate: 24000,
            commit_silence_ms: 400,
            supports_interruption: true,
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
      page.getByRole("heading", { name: "模型与智能体", exact: true }),
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
      const tab = page.getByRole("tab", { name: mode, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await page.screenshot({
        path: join(directory, `model-test-${theme}-${slug}-1600x1000.png`),
        fullPage: false,
      });
    }

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
    await page.getByRole("button", { name: "关闭调用详情" }).click();
  }

  await page.setViewportSize(mobile);
  await setTheme(page, "light");
  for (const [path, name] of [
    ["/model-service", "model-service"],
    ["/model-test", "model-test"],
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

async function installDensityData(page: Page) {
  await installFixedData(page);
  await page.route("**/v1/model-providers", (route) =>
    route.fulfill({
      json: {
        ...catalog,
        providers: [
          ...catalog.providers,
          {
            id: "tts",
            name: "本地语音",
            kind: "local_qwen_tts",
            enabled: true,
            models: [
              {
                id: "tts-1",
                slug: "qwen3-tts",
                label: "Qwen3-TTS 超长模型名称与版本说明布局验收",
                enabled: true,
                availability: "ready",
                capabilities: ["speech_synthesis"],
                categories: ["speech_synthesis"],
              },
            ],
          },
        ],
      },
    }),
  );
  await page.route("**/v1/model-inference/options", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "tts-1",
            modalities: ["speech_synthesis"],
            parameters: {
              speech_synthesis: {
                languages: ["Chinese", "English"],
                max_text_length: 2000,
              },
            },
          },
        ],
      },
    }),
  );
  await page.route("**/v1/model-inference/tasks", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/v1/model-test/conversations/**", (route) =>
    route.fulfill({ json: conversation }),
  );
}

test("model test density across six modes and viewport sizes", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await installDensityData(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/model-test");
  for (const width of [390, 768, 1024, 1280, 1600, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      for (const [mode, label] of [
        ["chat", "文本对话"],
        ["image", "图像生成"],
        ["video", "视频生成"],
        ["synthesis", "语音合成"],
        ["speech", "语音识别"],
        ["realtime", "实时语音"],
      ]) {
        const tab = page.getByRole("tab", { name: label, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(tab).toHaveCSS("font-size", "12px");
        const header = page.locator(".model-test-workspace-header");
        await expect(
          header.getByRole("combobox", { name: "测试模型" }),
        ).toHaveCSS("font-size", "12px");
        expect(
          await header.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          `${mode} ${width}`,
        ).toBe(true);
        if (mode === "synthesis") {
          await expect(
            page.getByRole("heading", { name: "模型测试", exact: true }),
          ).toBeVisible();
          if (width <= 1200)
            await page
              .getByRole("button", { name: "参数与资源", exact: true })
              .click();
          await expect(
            page.locator(".speech-composer .speech-heading h2"),
          ).toHaveCSS("font-size", "14px");
          await expect(page.locator(".speech-writing textarea")).toHaveCSS(
            "font-size",
            "13px",
          );
          await page
            .locator(".speech-writing textarea")
            .fill("用于检查长文稿与标点换行的文本。".repeat(20));
          expect(
            await page
              .locator(".speech-workbench")
              .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          ).toBe(true);
        }
        await page.screenshot({
          path: info.outputPath(`${mode}-${theme}-${width}.png`),
          animations: "disabled",
        });
      }
    }
  }
  expect(errors).toEqual([]);
});

test.describe("model test density touch controls", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("tabs and speech actions keep touch target heights", async ({
    page,
  }) => {
    await installDensityData(page);
    await page.goto("/model-test");
    await page.getByRole("tab", { name: "语音合成", exact: true }).click();
    await page.getByRole("button", { name: "参数与资源", exact: true }).click();
    const small = await page
      .locator(
        ".model-test-mode-tabs button, .speech-reference-actions button, .speech-generate, .speech-editor-footer .custom-select-trigger",
      )
      .evaluateAll((nodes) =>
        nodes
          .filter((el) => el.getBoundingClientRect().height < 44)
          .map((el) => el.textContent),
      );
    expect(small).toEqual([]);
  });
});
