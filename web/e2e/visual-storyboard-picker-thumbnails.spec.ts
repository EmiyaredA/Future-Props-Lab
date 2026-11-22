import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { setResponsiveTheme } from "./responsive-capture";

test("existing-video picker displays an extracted cover without loading the original", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    ({ name }) => name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "视频选择缩略图验收", kind: "canvas" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const id = (await created.json()).id;
  const base = `/v1/visual-workshop/projects/${id}`;
  const clip = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=12:d=1",
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
  const uploaded = await page.request.post(`${base}/node-uploads`, {
    headers,
    multipart: {
      expected_revision: "0",
      file: { name: "彩色抽帧参考.mp4", mimeType: "video/mp4", buffer: clip },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const canvas = await uploaded.json();
  const asset = canvas.nodes[0].asset_id;
  const saved = await page.request.put(`${base}/canvas`, {
    headers,
    data: {
      expected_revision: canvas.revision,
      edges: [],
      nodes: [
        ...canvas.nodes,
        {
          id: "draft",
          kind: "video",
          title: "无输出草稿",
          position: { x: 600, y: 200 },
          generation_draft: { prompt: "还没有生成的视频" },
        },
      ],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
  await page.getByRole("tab", { name: "分镜", exact: true }).click();
  const originalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === `/v1/files/${asset}/content`)
      originalRequests.push(request.url());
  });
  await page.getByRole("button", { name: "纳入已有视频", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "纳入已有视频（确认清单）" });
  const output = dialog.getByRole("button", {
    name: "彩色抽帧参考 video",
    exact: true,
  });
  const image = output.locator("img");
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  const source = await image.getAttribute("src");
  expect(source).toMatch(/^blob:/);
  await expect(dialog.locator("video")).toHaveCount(0);
  await expect(
    dialog
      .getByRole("button", { name: "无输出草稿 video", exact: true })
      .locator("img"),
  ).toHaveCount(0);
  const thumbnail = await page.request.get(
    `/v1/files/${asset}/thumbnail?size=128`,
  );
  expect(thumbnail.ok(), await thumbnail.text()).toBeTruthy();
  expect(thumbnail.headers()["content-type"]).toContain("image/");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await setResponsiveTheme(page, theme);
      await expect(image).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`video-picker-${width}-${theme}.png`),
      });
    }
  }
  expect(originalRequests).toEqual([]);
  await output.click();
  await expect(
    dialog.getByRole("button", { name: "纳入分镜", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  const unchanged = await (await page.request.get(`${base}/storyboard`)).json();
  expect(unchanged.shots).toEqual([]);
});
