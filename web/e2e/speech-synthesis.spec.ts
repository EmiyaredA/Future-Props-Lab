import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

// A deterministic, valid PCM recording exercises the actual browser audio player.
function recording() {
  const rate = 8000;
  const samples = rate * 8;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  return wav;
}
const text = "欢迎来到 Future Props Lab。让每一个想法，都拥有自己的声音。";
const task = (id: string, prompt: string) => ({
  id,
  model_id: "local-tts",
  kind: "speech_synthesis",
  status: "completed",
  request_payload: { text: prompt },
  result_available: true,
  result_filename: "speech.wav",
  created_at: "2026-10-20T10:00:00Z",
});
async function setup(page: Page) {
  let tasks = [
    task("latest", text),
    task("older", "今天的天气很好，适合出门散步。"),
  ];
  let submissions = 0;
  let saves = 0;
  await page.route("**/v1/model-providers", (route) =>
    route.fulfill({
      json: {
        revision: 1,
        suppliers: [],
        default_model_ids: {},
        providers: [
          {
            id: "local",
            name: "本地语音",
            kind: "local_qwen_tts",
            base_url: "",
            enabled: true,
            has_api_key: false,
            api_key_hint: "",
            models: [
              {
                id: "local-tts",
                provider_id: "local",
                slug: "qwen3-tts-0.6b-base",
                label: "Qwen3-TTS 0.6B Base",
                description: "",
                enabled: true,
                capabilities: ["speech_synthesis"],
                categories: ["speech_synthesis"],
                availability: "ready",
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
            id: "local-tts",
            label: "Qwen3-TTS 0.6B Base",
            modalities: ["speech_synthesis"],
            parameters: {
              speech_synthesis: {
                languages: ["Chinese", "English"],
                max_text_length: 2000,
                max_reference_bytes: 20971520,
                min_reference_seconds: 3,
                max_reference_seconds: 30,
                reference_extensions: [".wav", ".mp3", ".m4a", ".ogg"],
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
        id: "reference",
        filename: "我的参考音色.wav",
        mime_type: "audio/wav",
        media_kind: "audio",
        byte_size: recording().length,
      },
    }),
  );
  await page.route("**/v1/model-inference/tasks", async (route) => {
    if (route.request().method() === "POST") {
      submissions++;
      const body = route.request().postDataJSON();
      expect(body.parameters.reference_text).toBe(
        "今天的天气很好，适合出门散步。",
      );
      tasks = [task("created", body.parameters.text), ...tasks];
      await route.fulfill({ json: tasks[0] });
    } else await route.fulfill({ json: { items: tasks, total: tasks.length } });
  });
  await page.route("**/v1/model-inference/tasks/*/content", (route) =>
    route.fulfill({
      contentType: "audio/wav",
      body: recording(),
    }),
  );
  await page.route("**/v1/model-inference/tasks/*/save-to-library", (route) => {
    saves++;
    return route.fulfill({ json: { id: "saved" } });
  });
  await page.goto("/model-test");
  await page.getByRole("tab", { name: "语音合成", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "语音合成", exact: true }),
  ).toBeVisible();
  await page.getByLabel("目标文字", { exact: true }).fill(text);
  await page
    .getByLabel("录音对应文字", { exact: true })
    .fill("今天的天气很好，适合出门散步。");
  await page.getByLabel("参考录音", { exact: true }).setInputFiles({
    name: "我的参考音色.wav",
    mimeType: "audio/wav",
    buffer: recording(),
  });
  await expect(
    page.getByRole("button", { name: "生成语音", exact: true }),
  ).toBeEnabled();
  return { submissions: () => submissions, saves: () => saves };
}

test("speech workbench plays real audio, seeks, saves and keeps the draft after generation", async ({
  page,
}) => {
  const counts = await setup(page);
  await expect(page.getByText("00:08", { exact: true })).toBeVisible();
  const seekStyle = await page
    .getByRole("slider", { name: "播放位置" })
    .evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        border: style.borderTopWidth,
        padding: style.paddingTop,
        height: style.height,
        background: style.backgroundColor,
      };
    });
  expect(seekStyle).toEqual({
    border: "0px",
    padding: "0px",
    height: "24px",
    background: "rgba(0, 0, 0, 0)",
  });
  await expect(page.getByRole("link", { name: "下载 WAV" })).toHaveCSS(
    "text-decoration-line",
    "none",
  );
  await page.getByRole("button", { name: "播放语音", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("slider", { name: "播放位置" }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("slider", { name: "播放位置" })).toHaveValue("8");
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载 WAV" }).click();
  expect((await downloadReady).suggestedFilename()).toBe("speech.wav");
  await page.getByRole("button", { name: "保存到文件库", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "已保存到文件库", exact: true }),
  ).toBeDisabled();
  expect(counts.saves()).toBe(1);
  await page.getByRole("button", { name: "生成语音", exact: true }).click();
  await expect(page.getByText(/已提交生成任务/)).toBeVisible();
  expect(counts.submissions()).toBe(1);
  await expect(page.getByLabel("目标文字", { exact: true })).toHaveValue(text);
  await expect(
    page.getByRole("button", { name: "生成语音", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /试听生成记录：今天的天气/ }).click();
  await expect(
    page.getByRole("article", { name: "选中的生成结果" }),
  ).toContainText("今天的天气很好");
  await expect(page.locator(".speech-output audio")).toHaveCount(1);
});

test("selected design is responsive in both themes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setup(page);
  const output = resolve("../.local/ui-speech-redesign/screenshots");
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
      await page
        .locator(".model-test-workspace-header")
        .scrollIntoViewIfNeeded();
      await expect(page.getByText("00:08", { exact: true })).toBeAttached();
      if (width > 1200) {
        const bounds = await page
          .locator(".speech-history, .speech-output, .speech-composer")
          .evaluateAll((nodes) =>
            nodes.map((el) => el.getBoundingClientRect().x),
          );
        expect(bounds[0]).toBeLessThan(bounds[1]);
        expect(bounds[1]).toBeLessThan(bounds[2]);
      } else {
        await page
          .getByRole("button", { name: "测试结果", exact: true })
          .click();
        await expect(page.locator(".speech-output")).toBeVisible();
        await expect(page.locator(".speech-composer")).toBeHidden();
        await expect(page.locator(".speech-history")).toBeHidden();
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(
        page.getByRole("tab", { name: "语音合成", exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        animations: "disabled",
        path: resolve(output, `speech-${theme}-${width}.png`),
      });
      if (width === 1600) {
        await page.locator(".speech-result").screenshot({
          animations: "disabled",
          path: resolve(output, `speech-${theme}-player.png`),
        });
      }
      if (width < 900) {
        await page
          .getByRole("button", { name: "播放语音", exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          animations: "disabled",
          path: resolve(output, `speech-${theme}-${width}-result.png`),
        });
      }
      // Long content stays within its own scroll area and never pushes the result out horizontally.
      if (width <= 1200)
        await page
          .getByRole("button", { name: "参数与资源", exact: true })
          .click();
      await page
        .getByLabel("目标文字", { exact: true })
        .fill("一段较长的配音文稿。".repeat(100));
      await expect(page.getByLabel("目标文字", { exact: true })).toHaveValue(
        "一段较长的配音文稿。".repeat(100),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width <= 1200) {
        await page
          .getByRole("button", { name: "历史记录", exact: true })
          .click();
        await expect(page.locator(".speech-history")).toBeVisible();
        await page
          .getByRole("button", { name: "参数与资源", exact: true })
          .click();
        await expect(page.getByLabel("目标文字", { exact: true })).toHaveValue(
          "一段较长的配音文稿。".repeat(100),
        );
      }
      await page.getByLabel("目标文字", { exact: true }).fill(text);
    }
  }
  await page.setViewportSize({ width: 1630, height: 965 });
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await page.locator(".model-test-workspace-header").scrollIntoViewIfNeeded();
  await page.getByRole("heading", { name: "语音合成", exact: true }).click();
  await page.screenshot({
    animations: "disabled",
    path: resolve(output, "speech-reference-viewport.png"),
  });
  expect(errors).toEqual([]);
});
