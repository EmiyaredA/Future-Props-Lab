import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("creates, edits and hands off a transparent motion shot", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps");
  await page.getByText("特效制作工坊", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的特效项目" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("button", { name: /空白项目/ }).click();
  await page.getByRole("button", { name: /创建并打开项目/ }).click();
  await expect(page.locator(".mc-editor")).toBeVisible();
  const projectId = new URL(page.url()).pathname.split("/")[4];
  const base = `/v1/motion-compositor/projects/${projectId}`;
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };

  const original = await (await page.request.get(`${base}/document`)).json();
  original.document.settings.durationFrames = 2;
  const short = await page.request.post(`${base}/document/operations`, {
    headers,
    data: {
      expectedRevision: original.revision,
      requestId: "motion-e2e-short-project",
      operations: [{ type: "replaceDocument", document: original.document }],
    },
  });
  expect(short.ok(), await short.text()).toBeTruthy();

  const directory = mkdtempSync(join(tmpdir(), "motion-e2e-"));
  const video = join(directory, "ai-shot.mp4");
  try {
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x64:r=30",
      "-t",
      "1",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y",
      video,
    ]);
    const uploaded = await page.request.post("/v1/files", {
      headers,
      multipart: {
        upload: {
          name: "AI 生成片段.mp4",
          mimeType: "video/mp4",
          buffer: readFileSync(video),
        },
      },
    });
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();

    await page.reload();
    await expect(page.locator(".mc-editor")).toBeVisible();
    await page.getByRole("button", { name: /文件库 \/ AI 素材/ }).click();
    await page
      .locator(".mc-source-list")
      .getByRole("button", { name: /AI 生成片段/ })
      .click();
    await expect(page.locator(".mc-asset-list")).toContainText("AI 生成片段");
    await page
      .locator(".mc-asset-list")
      .getByRole("button", { name: /AI 生成片段/ })
      .click();
    await expect(page.locator(".mc-inspector")).toContainText("视频图层");
    await page.getByRole("button", { name: /启用手动遮罩/ }).click();
    await page.getByRole("button", { name: "为位置 X添加关键帧" }).click();
    await page.getByRole("button", { name: /当前帧路径/ }).click();
    await page.getByRole("spinbutton", { name: "点1 X" }).fill("200");
    await expect(page.locator(".mc-save-state")).toContainText("已自动保存", {
      timeout: 15_000,
    });
    await page.screenshot({ path: testInfo.outputPath("motion-editor.png") });
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.getByRole("button", { name: /导出镜头/ })).toBeVisible();

    await page.getByRole("button", { name: /导出镜头/ }).click();
    await page.getByRole("button", { name: /透明 PNG 序列/ }).click();
    await page.getByRole("button", { name: /开始导出/ }).click();
    await expect(page.locator(".mc-task").first()).toContainText("已完成", {
      timeout: 60_000,
    });
    await page.getByRole("button", { name: /发送透明镜头/ }).click();
    await page.getByPlaceholder("例如：怪盗风格成片").fill("特效交接测试");
    await page.getByRole("button", { name: /发送到剪辑/ }).click();
    await expect(page).toHaveURL(
      /\/apps\/video-editor\/projects\/[^/]+\/editor/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
