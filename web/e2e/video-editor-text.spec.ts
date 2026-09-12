import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

test("edits Chinese subtitles, positions and trims them, reloads and exports", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/video-editor");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/video-editor/projects") &&
      response.request().method() === "POST",
  );
  await page
    .locator(".workshop-page-header")
    .getByRole("button", { name: "新建剪辑" })
    .click();
  const project = await (await created).json();
  const root = `/v1/video-editor/projects/${project.id}`;
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const timeline = async () =>
    (await page.request.get(`${root}/timeline`)).json();
  const textClip = async () => {
    const data = await timeline();
    return data.document.tracks
      .flatMap((track: { clips: { kind: string }[] }) => track.clips)
      .find((clip: { kind: string }) => clip.kind === "text");
  };
  const saveField = async (label: string, value: string) => {
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith("/timeline/operations") &&
        response.request().method() === "POST",
    );
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press("Tab");
    expect((await response).ok()).toBeTruthy();
    await expect(page.getByLabel(label, { exact: true })).toBeEnabled();
  };
  try {
    await page.getByRole("combobox", { name: "添加文字" }).click();
    await page.getByRole("option", { name: /底部字幕/ }).click();
    await expect(
      page.getByRole("textbox", { name: "文字内容", exact: true }),
    ).toBeFocused();
    await expect(page.locator(".ve-track-head").first()).toContainText("文字");
    await saveField("文字内容", "我们的故事，从这里开始\nHello 世界");
    await saveField("字号", "56");
    await page.getByRole("switch", { name: "文字背景" }).click();
    await expect
      .poll(async () => (await textClip()).textStyle.backgroundOpacity)
      .toBe(0.6);
    const hit = page.getByRole("button", { name: /移动文字/ });
    await expect(hit).toBeVisible();
    const before = (await hit.boundingBox())!;
    const canvas = (await page.locator(".ve-stage").boundingBox())!;
    const sx = before.x + before.width / 2,
      sy = before.y + before.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 40, sy - 60, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => Math.round((await textClip()).transform.y))
      .toBe(Math.round(1000 - (60 * 1080) / canvas.height));
    const moved = (await textClip()).transform.y;
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect.poll(async () => (await textClip()).transform.y).toBe(1000);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect.poll(async () => (await textClip()).transform.y).toBe(moved);
    // Escape cancels a preview-only drag without changing the persisted revision.
    const initialRevision = (await timeline()).revision;
    const box = (await hit.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 40,
      box.y + box.height / 2 - 30,
    );
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect((await timeline()).revision).toBe(initialRevision);
    await page
      .getByRole("group", { name: "视觉轨：文字", exact: true })
      .getByRole("button", { name: "锁定轨道" })
      .click();
    await expect(
      page.getByRole("textbox", { name: "文字内容", exact: true }),
    ).toBeDisabled();
    await expect(hit).toHaveCount(0);
    await page
      .getByRole("group", { name: "视觉轨：文字", exact: true })
      .getByRole("button", { name: "解锁轨道" })
      .click();
    await expect(
      page.getByRole("textbox", { name: "文字内容", exact: true }),
    ).toBeEnabled();
    await saveField("片段时长 秒", "1.200");
    await expect.poll(async () => (await textClip()).durationUs).toBe(1200000);
    for (const theme of ["dark", "light"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.locator(".ve-inspector").evaluate((node) => {
        node.scrollTop = 0;
      });
      await expect(
        page.getByRole("button", { name: "文字颜色", exact: true }),
      ).toHaveCSS("background-color", "rgb(27, 32, 45)");
      await page.screenshot({
        path: info.outputPath(`text-editor-${theme}.png`),
      });
      expect(
        await page
          .locator(".ve-inspector")
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBeTruthy();
    }
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "文字内容", exact: true }),
    ).toHaveValue("我们的故事，从这里开始\nHello 世界");
    const saved = await timeline();
    const frameResponse = await page.request.get(
      `${root}/preview/frame?revision=${saved.revision}&timeUs=0&width=1920`,
    );
    expect(frameResponse.ok()).toBeTruthy();
    const framePath = info.outputPath("exact.png");
    writeFileSync(framePath, await frameResponse.body());
    await page.getByRole("button", { name: "导出视频", exact: true }).click();
    await page.getByRole("button", { name: "运行预检" }).click();
    await expect(page.getByText(/预检通过/)).toBeVisible();
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/renders") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "开始确定性渲染" }).click();
    const task = await (await submitted).json();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${root}/renders/${task.id}`)).json())
            .status,
        { timeout: 60000 },
      )
      .toBe("completed");
    const complete = await (
      await page.request.get(`${root}/renders/${task.id}`)
    ).json();
    const output = await page.request.get(
      `/v1/files/${complete.outputAssetId}/content`,
    );
    expect(output.ok()).toBeTruthy();
    const videoPath = info.outputPath("subtitles.mp4");
    writeFileSync(videoPath, await output.body());
    const exportedPath = info.outputPath("exported.png");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      exportedPath,
    ]);
    // H.264 is lossy; compare pixels with a small average error allowance.
    const difference = execFileSync(
      "../.venv/bin/python",
      [
        "-c",
        "from PIL import Image,ImageChops,ImageStat; import sys; a=Image.open(sys.argv[1]).convert('RGB'); b=Image.open(sys.argv[2]).convert('RGB'); assert a.size==b.size; box=a.getbbox(); assert box and b.getbbox(); print(sum(ImageStat.Stat(ImageChops.difference(a,b).crop(box)).mean)/3)",
        framePath,
        exportedPath,
      ],
      { encoding: "utf8" },
    );
    expect(Number(difference.trim())).toBeLessThan(5);
    // Mobile inspector remains operable, with controls contained in the panel.
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("navigation", { name: "剪辑面板" })
      .getByRole("button", { name: "属性", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "文字内容", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("text-editor-mobile.png") });
    expect(
      await page
        .locator(".ve-inspector")
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBeTruthy();
  } finally {
    await page.request.delete(root, { headers }).catch(() => undefined);
  }
});
