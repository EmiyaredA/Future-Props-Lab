import { expect, test } from "@playwright/test";

test("render task cards adapt to themes, filters and small screens", async ({
  page,
}, info) => {
  const project = {
    id: "tasks-ui-project",
    title: "米塔 · 石头门",
    revision: 1,
    status: "draft",
    createdAt: "2026-09-10T01:00:00Z",
    updatedAt: "2026-09-10T01:00:00Z",
  };
  const task = {
    projectId: project.id,
    kind: "render",
    createdAt: "2026-09-10T01:10:00Z",
    updatedAt: "2026-09-10T01:10:00Z",
  };
  const renders = [
    { ...task, id: "active", status: "running", progress: 71 },
    {
      ...task,
      id: "ready",
      status: "completed",
      progress: 100,
      outputAssetId: "download",
      resultDetail: { outputFilename: "米塔-石头门-完整版.mp4" },
    },
    {
      ...task,
      id: "failed",
      status: "failed",
      progress: 34,
      error: "素材文件暂时不可用，请返回项目检查素材后重新导出。",
    },
    { ...task, id: "cancelled", status: "cancelled", progress: 0 },
  ];
  const segments = [
    {
      ...task,
      id: "segments",
      kind: "segment_export",
      status: "completed",
      progress: 100,
      resultDetail: {
        importRequested: false,
        segments: [
          {
            name: "结尾",
            status: "completed",
            outputFilename:
              "结尾-祝屏幕外的大伙都能找到自己心仪的另一半-特别加长文件名测试.mp4",
            assetId: "segment",
          },
        ],
      },
    },
  ];
  await page.route("**/v1/video-editor/projects", (route) =>
    route.fulfill({ json: { items: [project] } }),
  );
  await page.route(
    `**/v1/video-editor/projects/${project.id}/renders`,
    (route) => route.fulfill({ json: { items: renders } }),
  );
  await page.route(
    `**/v1/video-editor/projects/${project.id}/segment-exports`,
    (route) => route.fulfill({ json: { items: segments } }),
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/apps/video-editor/tasks");
  const root = page.locator(".ve-tasks-page");
  await expect(root.locator("article")).toHaveCount(5);
  await expect(root.getByRole("progressbar")).toHaveCount(1);
  await expect(root.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "71",
  );
  await expect(root.getByRole("link", { name: "下载视频" })).toHaveAttribute(
    "href",
    "/v1/files/download/download",
  );
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await root.getByRole("button", { name: "刷新", exact: true }).focus();
    await expect(
      root.getByRole("button", { name: "刷新", exact: true }),
    ).toBeFocused();
    await root.screenshot({
      path: info.outputPath(`tasks-desktop-${theme}.png`),
    });
  }
  await root.getByRole("button", { name: /^进行中/ }).click();
  await expect(root.locator("article")).toHaveCount(1);
  await root.getByRole("button", { name: /^已完成/ }).click();
  await expect(root.locator("article")).toHaveCount(2);
  await root.getByLabel("搜索渲染任务").fill("不存在的文件");
  await expect(root.getByText("没有匹配的任务")).toBeVisible();
  await root.getByRole("button", { name: "查看全部任务", exact: true }).click();
  await expect(root.locator("article")).toHaveCount(5);
  await root.getByLabel("搜索渲染任务").fill("完整版");
  await expect(root.locator("article")).toHaveCount(1);
  await root.getByLabel("搜索渲染任务").fill("");
  await root.getByRole("button", { name: "逐段下载（1）" }).click();
  await expect(
    root.getByRole("button", { name: "逐段下载（1）" }),
  ).toHaveAttribute("aria-expanded", "true");
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      expect(
        await root.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBeTruthy();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBeTruthy();
      await root.screenshot({
        path: info.outputPath(`tasks-${width}-${theme}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await root.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(
    root.getByRole("button", { name: "刷新", exact: true }),
  ).toBeEnabled();
});
