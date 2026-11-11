import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import type { Reference, RunDetail } from "../src/features/amadeus/protocol";

test("sent and reopened Amadeus attachments preview real images and video", async ({
  page,
}) => {
  const video = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=12:d=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "frag_keyframe+empty_moov",
    "-f",
    "mp4",
    "pipe:1",
  ]);
  await page.setViewportSize({ width: 430, height: 800 });
  await page.route("**/v1/code-agents", (route) =>
    route.fulfill({
      json: {
        items: [{ id: "codex", name: "Codex", available: true, models: [] }],
      },
    }),
  );
  await page.route("**/v1/amadeus/conversations/*/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const { references } = route.request().postDataJSON() as {
      references: Reference[];
    };
    expect(references.map((item) => item.name)).toEqual([
      expect.stringMatching(/^剪贴图像-.*\.png$/),
      "clip.mp4",
      "notes.txt",
      "broken.png",
    ]);
    const conversationId = new URL(route.request().url()).pathname
      .split("/")
      .at(-2)!;
    await route.fulfill({
      json: {
        run: {
          id: "attachment-fixture",
          conversation_id: conversationId,
          model_id: "fixture",
          agent_id: "codex",
          status: "completed",
          partial_text: "",
          created_at: new Date().toISOString(),
        },
        events: [],
      } satisfies RunDetail,
    });
  });
  await page.goto("/amadeus");
  const composer = page.getByPlaceholder("描述你想在工坊项目里完成的工作…");
  await composer.fill("请查看这些附件");
  await composer.evaluate(async (element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#d86749";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) =>
        blob ? resolve(blob) : reject(new Error("PNG unavailable")),
      ),
    );
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([png], "image.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const draft = page.locator(".amadeus-pending-refs");
  await expect(
    draft.getByRole("button", { name: /^移除引用：剪贴图像-/ }),
  ).toBeVisible();
  await page.locator('.amadeus-composer input[type="file"]').setInputFiles([
    { name: "clip.mp4", mimeType: "video/mp4", buffer: video },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") },
    {
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("broken"),
    },
  ]);
  const draftVideo = draft
    .getByRole("button", { name: "预览视频：clip.mp4" })
    .locator("video");
  await expect(draftVideo).toHaveJSProperty("videoWidth", 160);
  await expect(
    draft.getByRole("button", { name: "移除引用：broken.png" }),
  ).toBeVisible();
  const sent = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/v1\/amadeus\/conversations\/[^/]+\/messages$/.test(response.url()),
  );
  await composer.press("Enter");
  const saved = await sent;
  expect(saved.ok()).toBe(true);
  await expect(draft).toHaveCount(0);
  const conversation = (await saved.json()).conversation.id;

  const message = page
    .getByRole("article", { name: "你的消息" })
    .filter({ hasText: "请查看这些附件" });
  const image = message.getByRole("button", { name: /^放大图片：剪贴图像-/ });
  const clip = message.getByRole("button", { name: "预览视频：clip.mp4" });
  await expect(message.getByRole("button", { name: /^移除引用/ })).toHaveCount(
    0,
  );
  await expect(image.locator("img")).toHaveJSProperty("naturalWidth", 160);
  const thumbnailWidth = (await image.locator("img").boundingBox())!.width;
  await image.press("Enter");
  const imageDialog = page.getByRole("dialog", { name: /^剪贴图像-/ });
  const enlarged = imageDialog.getByRole("img");
  await expect(enlarged).toBeVisible();
  expect((await enlarged.boundingBox())!.width).toBeGreaterThan(thumbnailWidth);
  await page.keyboard.press("Escape");
  await expect(image).toBeFocused();

  const cover = clip.locator("video");
  await cover.scrollIntoViewIfNeeded();
  await expect(cover).toBeVisible();
  await expect(cover).toHaveJSProperty("videoWidth", 160);
  await expect(cover).toHaveJSProperty("paused", true);
  await expect(clip.locator(".amadeus-media-play")).toBeVisible();
  await clip.click();
  const clipDialog = page.getByRole("dialog", { name: "clip.mp4" });
  const player = clipDialog.locator("video");
  await expect(player).toHaveJSProperty("controls", true);
  await expect(player).toHaveJSProperty("paused", true);
  const playing = (await player.elementHandle())!;
  await playing.evaluate((element) => element.play());
  await expect
    .poll(() => playing.evaluate((element) => element.currentTime))
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(clipDialog).toHaveCount(0);
  await expect(clip).toBeFocused();
  await expect
    .poll(() => playing.evaluate((element) => element.paused))
    .toBe(true);

  await message.getByRole("button", { name: "查看引用：notes.txt" }).click();
  const reference = page.getByRole("dialog", { name: "引用详情" });
  await expect(reference.getByText("notes.txt")).toBeVisible();
  await reference.getByRole("button", { name: "关闭引用详情" }).click();
  await message.getByRole("button", { name: "放大图片：broken.png" }).click();
  const broken = page.getByRole("dialog", { name: "broken.png" });
  await expect(broken.getByRole("status")).toHaveText("图片暂时无法预览。");
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(image.locator("img")).toHaveJSProperty("naturalWidth", 160);
  await clip.scrollIntoViewIfNeeded();
  await expect(cover).toHaveJSProperty("videoWidth", 160);
  const objectUrl = (await cover.getAttribute("src"))!;
  await page.getByRole("button", { name: "新建对话" }).click();
  await expect(message).toHaveCount(0);
  expect(
    await page.evaluate(
      async (url) =>
        fetch(url).then(
          () => true,
          () => false,
        ),
      objectUrl,
    ),
  ).toBe(false);

  await page.route(
    `**/v1/amadeus/conversations/${conversation}/files/imports/*.png`,
    (route) => route.fulfill({ status: 404, json: { detail: "missing" } }),
  );
  await page.goto(`/amadeus?conversation=${conversation}`);
  await image.click();
  await expect(imageDialog.getByRole("status")).toHaveText(
    "图片暂时无法预览。",
  );
});
