import { expect, test } from "@playwright/test";

test("local TTS is opt-in, supports cancellation and connects to speech testing", async ({
  page,
}) => {
  let installs = 0;
  let state = {
    id: "qwen3-tts-0.6b-base",
    label: "Qwen3-TTS 0.6B Base",
    repository: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
    license: "Apache-2.0",
    model_revision: "fixed",
    download_bytes: 2520000000,
    required_disk_bytes: 7200000000,
    compatible: true,
    status: "not_installed",
    enabled: false,
    loaded: false,
    busy: false,
    progress: 0,
    revision: 0,
  };
  let catalog = {
    revision: 1,
    suppliers: [] as object[],
    providers: [] as object[],
    default_model_ids: {},
  };
  let tasks: object[] = [];
  const calls: string[] = [];
  await page.route("**/v1/model-providers", (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.route("**/v1/local-models", (route) =>
    route.fulfill({ json: { can_manage: true, items: [state] } }),
  );
  await page.route("**/v1/platform/local-models/*/actions", async (route) => {
    const body = route.request().postDataJSON();
    calls.push(body.action);
    expect(body.expected_revision).toBe(state.revision);
    if (body.action === "install") {
      installs += 1;
      state = {
        ...state,
        status: installs === 1 ? "installing" : "installed",
        progress: installs === 1 ? 10 : 100,
        enabled: installs > 1,
        revision: state.revision + 1,
      };
    } else
      state = { ...state, status: "cancelled", revision: state.revision + 1 };
    await route.fulfill({ json: state });
  });
  await page.route("**/v1/local-models/attach", async (route) => {
    expect(route.request().postDataJSON().expected_catalog_revision).toBe(1);
    catalog = {
      ...catalog,
      revision: 2,
      providers: [
        {
          id: "p",
          name: "Local Qwen",
          kind: "local_qwen_tts",
          base_url: "",
          enabled: true,
          has_api_key: false,
          api_key_hint: "",
          models: [
            {
              id: "m",
              provider_id: "p",
              slug: state.id,
              label: "Local Qwen",
              description: "",
              capabilities: ["speech_synthesis"],
              categories: ["speech_synthesis"],
              enabled: true,
              availability: "ready",
            },
          ],
        },
      ],
    };
    await route.fulfill({ json: catalog });
  });
  await page.route("**/v1/model-inference/options", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "m",
            label: "Local Qwen",
            modalities: ["speech_synthesis"],
            parameters: {
              speech_synthesis: {
                languages: ["Chinese", "English"],
                max_text_length: 2000,
                max_reference_bytes: 20971520,
                min_reference_seconds: 3,
                max_reference_seconds: 30,
                reference_extensions: [".wav"],
              },
            },
          },
        ],
      },
    }),
  );
  await page.route("**/v1/model-inference/assets", (route) =>
    route.fulfill({
      json: {
        id: "ref",
        filename: "voice.wav",
        mime_type: "audio/wav",
        media_kind: "audio",
        byte_size: 100,
      },
    }),
  );
  await page.route("**/v1/model-inference/tasks", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      expect(body.kind).toBe("speech_synthesis");
      expect(body.parameters.reference_text).toBe("参考录音文字");
      tasks = [
        {
          id: "task",
          model_id: "m",
          kind: "speech_synthesis",
          status: "completed",
          request_payload: body.parameters,
          result_available: true,
          result_filename: "speech.wav",
        },
      ];
      await route.fulfill({ json: tasks[0] });
    } else await route.fulfill({ json: { items: tasks, total: tasks.length } });
  });
  await page.route("**/v1/model-inference/tasks/task/content", (route) =>
    route.fulfill({
      contentType: "audio/wav",
      body: Buffer.from("RIFF" + "0".repeat(100)),
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/model-service");
  expect(calls).toEqual([]);
  await page.getByRole("tab", { name: "本地模型", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Qwen3-TTS 0.6B/ }),
  ).toBeVisible();
  expect(calls).toEqual([]);
  await page.getByRole("button", { name: "下载安装", exact: true }).click();
  await page.getByRole("button", { name: "取消安装", exact: true }).click();
  await page.getByRole("button", { name: "重试安装", exact: true }).click();
  await page
    .getByRole("button", { name: "添加到当前空间", exact: true })
    .click();
  await expect(
    page.getByText("已添加到当前空间；现有默认模型保持原设置。"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "去测试", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "语音合成", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByLabel("目标文字", { exact: true })
    .fill("这是一段本地语音测试。");
  await page.getByLabel("录音对应文字", { exact: true }).fill("参考录音文字");
  await page.getByLabel("参考录音", { exact: true }).setInputFiles({
    name: "voice.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("fixture"),
  });
  await page.getByRole("button", { name: "生成语音", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "下载 WAV", exact: true }),
  ).toBeVisible();
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载 WAV", exact: true }).click();
  const download = await downloadReady;
  expect(download.suggestedFilename()).toBe("speech.wav");
  expect(await download.failure()).toBeNull();
});

test("local model workbench matches the selected design in both themes and responsive widths", async ({
  page,
}) => {
  const { mkdir } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const installed = {
    id: "qwen3-tts-0.6b-base",
    label: "Qwen3-TTS 0.6B Base",
    repository: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
    license: "Apache-2.0",
    model_revision: "fixed",
    download_bytes: 2520000000,
    required_disk_bytes: 7200000000,
    compatible: true,
    status: "installed",
    enabled: true,
    loaded: false,
    busy: false,
    progress: 100,
    revision: 2,
  };
  const available = {
    ...installed,
    id: "qwen3-tts-1.7b-base",
    label: "Qwen3-TTS 1.7B Base",
    download_bytes: 4540000000,
    required_disk_bytes: 11200000000,
    status: "not_installed",
    enabled: false,
    progress: 0,
    revision: 0,
  };
  await page.route("**/v1/model-providers", (route) =>
    route.fulfill({
      json: {
        revision: 7,
        suppliers: [],
        providers: [],
        default_model_ids: {},
      },
    }),
  );
  await page.route("**/v1/local-models", (route) =>
    route.fulfill({
      json: { can_manage: true, items: [installed, available] },
    }),
  );
  const mutations: string[] = [];
  await page.route("**/v1/platform/local-models/*/actions", (route) => {
    mutations.push(route.request().postData() ?? "");
    return route.abort();
  });
  await page.goto("/model-service");
  const output = resolve("../.local/ui-model-services/screenshots");
  await mkdir(output, { recursive: true });
  for (const theme of ["light", "dark"]) {
    for (const width of [1600, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page
        .getByRole("button", {
          name: theme === "dark" ? "深色" : "浅色",
          exact: true,
        })
        .click();
      await page.getByRole("tab", { name: "本地模型", exact: true }).click();
      await expect(
        page.getByRole("radio", { name: installed.label, exact: true }),
      ).toBeChecked();
      await expect(
        page.getByRole("button", { name: "添加到当前空间", exact: true }),
      ).toBeVisible();
      const layout = await page.locator(".lm-workbench").evaluate((node) => {
        const list = node
          .querySelector(".lm-model-list")!
          .getBoundingClientRect();
        const detail = node
          .querySelector(".lm-detail")!
          .getBoundingClientRect();
        return {
          stacked: detail.top > list.bottom - 1,
          sameRow: Math.abs(detail.top - list.top) < 1,
        };
      });
      expect(width === 1600 ? layout.sameRow : layout.stacked).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: resolve(output, `local-models-${theme}-${width}.png`),
      });
      if (width < 900) {
        await page
          .getByRole("button", { name: "添加到当前空间", exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: resolve(output, `local-models-${theme}-${width}-details.png`),
        });
      }
      await page
        .getByRole("radio", { name: available.label, exact: true })
        .check();
      await expect(
        page.getByRole("button", { name: "下载安装", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("radio", { name: installed.label, exact: true })
        .check();
      await page.getByRole("tab", { name: "接入管理", exact: true }).click();
      await expect(
        page.getByRole("tab", { name: "本地模型", exact: true }),
      ).toHaveAttribute("aria-selected", "false");
      await page.getByRole("tab", { name: "模型目录", exact: true }).click();
    }
  }
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});
