import { expect, test } from "@playwright/test";

function wavFixture(seconds = 1) {
  const sampleRate = 8_000;
  const dataSize = sampleRate * seconds * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/tool-navigation/state", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });
  await page.route("**/v1/tool-navigation/tools/*/use", async (route) => {
    const toolId = route.request().url().split("/").at(-2) ?? "tool";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        tool_id: toolId,
        is_favorite: false,
        favorite_updated_at: null,
        last_used_at: "2026-08-03T08:00:00Z",
        use_count: 1,
      }),
    });
  });
});

test("home is the default route and tools stay responsive", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);
  await expect(
    page.getByRole("heading", { name: "今天想从哪里开始？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /查找工具/ }).click();
  await expect(page).toHaveURL(/\/tools$/);
  await expect(page.getByRole("heading", { name: "工具导航" })).toBeVisible();

  const navItems = page.getByRole("navigation").getByRole("button");
  await expect(navItems.nth(0)).toContainText("首页");
  await expect(navItems.nth(1)).toContainText("AI应用");
  await expect(navItems.nth(2)).toContainText("文件管理");
  await expect(navItems.nth(3)).toContainText("工具导航");
  await expect(navItems.nth(4)).toContainText("集成中心");
  await expect(navItems.nth(5)).toContainText("基模型");
  await expect(page.locator(".tool-grid")).toHaveCSS(
    "grid-template-columns",
    /\S+px \S+px \S+px/,
  );

  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator(".tools-layout")).toHaveCSS(
    "grid-template-columns",
    /\S+px/,
  );
  await expect(page.locator(".tool-grid")).toHaveCSS(
    "grid-template-columns",
    /\S+px \S+px/,
  );

  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.locator(".tool-grid")).toHaveCSS(
    "grid-template-columns",
    /\S+px/,
  );
  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("filters tools and records external usage", async ({ page }) => {
  await page.goto("/tools");
  await page.getByRole("button", { name: "模型工具" }).click();
  await page.getByRole("button", { name: "Token", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打开Token 估算" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开模型调用日志" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开模型测试" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "打开模型服务" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "打开JSON 格式化" }),
  ).toHaveCount(0);

  const usage = page.waitForRequest(
    "**/v1/tool-navigation/tools/token-estimator/use",
  );
  await page.getByRole("button", { name: "打开Token 估算" }).click();
  await usage;
  await expect(page).toHaveURL(/\/tools$/);
});

test("opens the local video frame exporter", async ({ page }) => {
  await page.goto("/tools");
  const usage = page.waitForRequest(
    "**/v1/tool-navigation/tools/video-frame-exporter/use",
  );
  await page.getByRole("button", { name: "打开视频帧导出" }).click();
  await usage;

  await expect(page).toHaveURL(/\/tools\/video-frame-exporter$/);
  await expect(page.getByRole("heading", { name: "视频帧导出" })).toBeVisible();
  await expect(page.getByText("视频仅在本地处理")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "工具导航", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.locator(".video-frame-header")).toHaveCSS(
    "grid-template-columns",
    /\S+px/,
  );
  await page.getByRole("button", { name: "返回工具导航" }).click();
  await expect(page).toHaveURL(/\/tools$/);
});

test("creates and edits an audio annotation task", async ({
  page,
}, testInfo) => {
  const transcriptionBodies: string[] = [];
  const audioFileStem = `e2e-annotation-${testInfo.workerIndex}-${testInfo.repeatEachIndex}-${Date.now()}`;
  await page.route("**/v1/model-test/transcription-options", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "e2e-asr-model",
            provider_id: "e2e-provider",
            provider_name: "E2E 识别供应商",
            provider_kind: "senseaudio_asr",
            slug: "senseaudio-asr-pro-1.5-260319",
            label: "E2E 片段识别",
            description: "",
            max_input_bytes: 10 * 1024 * 1024,
            parameter_capabilities: {
              language_mode: "select",
              language_options: [
                { value: "auto", label: "自动识别" },
                { value: "ja", label: "日本語" },
              ],
              target_language_options: [{ value: "zh", label: "中文" }],
              supports_word_timestamps: false,
              supports_text_edit: false,
              supports_speaker_diarization: false,
              supports_max_speakers: false,
              supports_punctuation: false,
              supports_hotwords: false,
              supports_abbreviations: false,
              defaults: {
                language: "auto",
                target_language: null,
                enable_word_timestamps: false,
                enable_text_edit: false,
                enable_speaker_diarization: false,
                max_speakers: null,
                enable_punctuation: false,
                hotwords: null,
                abbreviations: false,
              },
            },
          },
        ],
        max_input_bytes: 10 * 1024 * 1024,
        accepted_extensions: [".wav"],
        accepted_mime_types: ["audio/wav"],
      }),
    }),
  );
  await page.route("**/segment-transcriptions", async (route) => {
    transcriptionBodies.push(
      route.request().postDataBuffer()?.toString("latin1") ?? "",
    );
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        text: "自动转写片段",
        model_id: "e2e-asr-model",
        requested_language: null,
        resolved_language: "auto",
        requested_target_language: null,
        resolved_target_language: null,
        log_id: "e2e-log",
      }),
    });
  });
  await page.goto("/tools");
  await page.getByRole("button", { name: "打开录音分段标注" }).click();
  await expect(page).toHaveURL(/\/tools\/audio-annotation$/);

  await page.getByRole("button", { name: "新建任务" }).click();
  await page.getByLabel("上传录音文件").setInputFiles({
    name: `${audioFileStem}.wav`,
    mimeType: "audio/wav",
    buffer: wavFixture(12),
  });
  await expect(
    page
      .getByRole("listbox", { name: "文件库音频" })
      .getByRole("option")
      .filter({ hasText: `${audioFileStem}.wav` }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "创建并打开" }).click();

  await expect(page).toHaveURL(/\/tools\/audio-annotation\/.+$/);
  await expect(
    page.getByRole("complementary", { name: "片段编辑器" }),
  ).toBeVisible();
  await expect(page.getByLabel("录音波形时间轴")).toBeVisible();
  await expect(page.getByLabel("波形缩放比例")).toHaveValue("0");
  await page.getByRole("button", { name: "框选放大" }).click();
  await expect(
    page.getByText("在波形上拖拽框选，松手后只显示该时间范围"),
  ).toBeVisible();
  const waveformBox = await page.getByLabel("录音波形时间轴").boundingBox();
  expect(waveformBox).not.toBeNull();
  await page.mouse.move(
    waveformBox!.x + waveformBox!.width * 0.25,
    waveformBox!.y + waveformBox!.height * 0.7,
  );
  await page.mouse.down();
  await page.mouse.move(
    waveformBox!.x + waveformBox!.width * 0.45,
    waveformBox!.y + waveformBox!.height * 0.7,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "框选放大" })).toBeVisible();
  await expect(page.getByLabel("波形缩放比例")).not.toHaveValue("0");
  await expect(page.getByLabel("波形浏览位置")).toBeEnabled();
  await page.getByRole("button", { name: "向右浏览波形" }).click();
  await page.getByRole("button", { name: "适应全长" }).click();
  await expect(page.getByLabel("波形缩放比例")).toHaveValue("0");
  await expect(page.locator(".annotation-viewport-time")).toContainText(
    "00:12.000",
  );
  await page.getByRole("button", { name: "播放当前片段" }).click();
  await expect(
    page.getByRole("button", { name: "暂停当前片段" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "暂停当前片段" }).click();
  await expect(
    page.getByRole("button", { name: "播放当前片段" }),
  ).toBeVisible();

  await page.getByRole("combobox", { name: "选择原文语言" }).click();
  await page.getByRole("option", { name: "日语" }).click();
  await expect(
    page.getByRole("combobox", { name: "选择转写原语言" }),
  ).toContainText("日本語");
  await expect(
    page.getByRole("combobox", { name: "选择转写目标语言" }),
  ).toContainText("原文（日语）");
  const transcribeButton = page.getByRole("button", {
    name: "转写当前片段到日语",
  });
  await expect(transcribeButton).toBeEnabled();
  await transcribeButton.click();
  await expect(page.getByRole("textbox", { name: "日语说话内容" })).toHaveValue(
    "自动转写片段",
  );
  await transcribeButton.click();
  await expect(
    page.getByRole("alertdialog", { name: "替换日语内容？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();

  const outputLanguage = page.getByRole("combobox", {
    name: "选择转写目标语言",
  });
  await outputLanguage.click();
  await page.getByRole("option", { name: /中文 创建并写入中文版本/ }).click();
  await expect(outputLanguage).toContainText("中文");
  const chineseTranscribeButton = page.getByRole("button", {
    name: "转写当前片段到中文",
  });
  await expect(chineseTranscribeButton).toBeEnabled();
  await chineseTranscribeButton.click();
  const chineseTranscript = page.getByRole("textbox", {
    name: "中文说话内容",
  });
  await expect(chineseTranscript).toHaveValue("自动转写片段");
  const firstRegionLabel = page.locator(".annotation-region-label").first();
  await expect(firstRegionLabel).toBeVisible();
  await firstRegionLabel.evaluate((label) =>
    label.parentElement?.setAttribute("data-e2e-region-stability", "preserved"),
  );
  const transcriptSave = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().includes("/audio-annotation/projects/") &&
      response.url().endsWith("/document") &&
      response.ok(),
  );
  await chineseTranscript.fill("连续编辑不会重建波形区域");
  await transcriptSave;
  await expect(
    page.locator('[data-e2e-region-stability="preserved"]'),
  ).toHaveCount(1);
  expect(transcriptionBodies).toHaveLength(2);
  expect(transcriptionBodies[0]).toContain('name="language_tag"\r\n\r\nja\r\n');
  expect(transcriptionBodies[0]).not.toContain('name="target_language_tag"');
  expect(transcriptionBodies[1]).toContain('name="language_tag"\r\n\r\nja\r\n');
  expect(transcriptionBodies[1]).toContain(
    'name="target_language_tag"\r\n\r\nzh\r\n',
  );
  await page.getByRole("tab", { name: "日语" }).click();

  await page.setViewportSize({ width: 1440, height: 900 });
  const transport = page.locator(".annotation-transport");
  await expect(transport).toBeVisible();
  await expect
    .poll(() =>
      transport.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    )
    .toBe(true);
  await expect(page.locator(".annotation-playback-time")).toHaveCSS(
    "white-space",
    "nowrap",
  );

  await page.getByRole("button", { name: "管理", exact: true }).click();
  await page.getByRole("button", { name: "添加说话人" }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page
    .getByRole("group", { name: "选择一个或多个说话人" })
    .getByRole("button", { name: "说话人 1" })
    .click();
  await page
    .getByRole("textbox", { name: "日语说话内容" })
    .fill("自动化验收片段");
  await page.getByRole("checkbox", { name: "标记为已校对" }).click();
  await expect(page.getByText(/已自动保存/)).toBeVisible({ timeout: 5_000 });

  await page
    .getByRole("textbox", { name: "日语说话内容" })
    .fill("这段内容还没有保存");
  await page.getByRole("button", { name: "工具导航", exact: true }).click();
  await expect(
    page.getByRole("alertdialog", { name: "离开并放弃未保存内容？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page).toHaveURL(/\/tools\/audio-annotation\/.+$/);

  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator(".annotation-editor-grid")).toHaveCSS(
    "grid-template-columns",
    /\S+px/,
  );
  await expect(page.getByRole("button", { name: "删除片段" })).toBeVisible();
});
