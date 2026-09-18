import { captureResponsive, setResponsiveTheme } from "./responsive-capture";
import { expect, test } from "@playwright/test";
import { viewports } from "./responsive-inventory";

test("editor surfaces and compact panels fit without replacing the workspace", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(10000);
  await page.goto("/apps");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const create = async (path: string, data: object) => {
    const response = await page.request.post(`/v1/${path}`, { headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const title = "屏幕适配测试 · 一份包含较长中文标题的编辑项目";
  const visual = await create("visual-workshop/projects", {
    title,
    kind: "canvas",
  });
  const video = await create("video-editor/projects", { title });
  const galgame = await create("galgame-workshop/projects", { title });
  const knowledge = await create("thought-workshop/knowledge-bases", { title });
  const wav = Buffer.alloc(32044);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(32000, 40);
  const upload = await page.request.post("/v1/files", {
    headers,
    multipart: {
      upload: { name: "适配测试.wav", mimeType: "audio/wav", buffer: wav },
    },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const asset = await upload.json();
  const audio = await create("audio-annotation/projects", {
    title,
    asset_id: asset.id,
  });
  const surfaces = [
    {
      name: "visual-canvas",
      path: `/apps/visual-workshop/projects/${visual.id}/canvas`,
      ready: ".visual-canvas",
    },
    {
      name: "visual-assets",
      path: `/apps/visual-workshop/projects/${visual.id}/assets`,
      ready: ".workshop-page",
    },
    {
      name: "video-editor",
      path: `/apps/video-editor/projects/${video.id}/editor`,
      ready: ".ve-editor",
    },
    {
      name: "galgame-editor",
      path: `/apps/galgame-workshop/projects/${galgame.id}/editor`,
      ready: ".galgame-editor-page",
    },
    {
      name: "galgame-overview",
      path: `/apps/galgame-workshop/projects/${galgame.id}/overview`,
      ready: ".workshop-page",
    },
    {
      name: "galgame-preview",
      path: `/apps/galgame-workshop/projects/${galgame.id}/preview`,
      ready: ".galgame-fast-preview",
    },
    {
      name: "audio-editor",
      path: `/apps/audio-annotation/projects/${audio.id}`,
      ready: ".annotation-editor-main",
    },
    {
      name: "knowledge-home",
      path: `/apps/thought-workshop/knowledge-bases/${knowledge.id}`,
      ready: ".knowledge-shell",
    },
  ];
  const problems: unknown[] = [];
  for (const surface of surfaces) {
    await page.goto(surface.path);
    await expect(page.locator(surface.ready).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator(".page-loading")).toHaveCount(0);
    for (const size of process.env.FPL_RESPONSIVE_SCAN
      ? [viewports[0], viewports[4]]
      : viewports) {
      await page.setViewportSize(size);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      for (const theme of ["light", "dark"]) {
        await setResponsiveTheme(page, theme);
        const panels = page.locator(".compact-panel-tabs button");
        const states = size.width <= 1200 ? await panels.count() : 0;
        for (let state = 0; state < Math.max(1, states); state++) {
          if (states) await panels.nth(state).click();
          if (surface.name === "galgame-editor" && states) {
            if (state === 1) {
              const heading = await page
                .locator(".galgame-fragment-panel > .galgame-panel-heading")
                .boundingBox();
              const search = await page
                .locator(".galgame-structure-search-field")
                .boundingBox();
              expect(search!.y).toBeGreaterThanOrEqual(
                heading!.y + heading!.height,
              );
            }
            if (state === 2)
              expect(
                (await page.locator(".galgame-preview-focus").boundingBox())!
                  .height,
              ).toBeGreaterThanOrEqual(260);
          }
          const overflow = await page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            viewport: innerWidth,
          }));
          if (overflow.width > overflow.viewport + 1)
            problems.push({
              name: surface.name,
              size,
              theme,
              state,
              ...overflow,
            });
          await page.screenshot({
            path: info.outputPath(
              `${surface.name}-${size.width}x${size.height}-${theme}-${state}.png`,
            ),
            fullPage: true,
            animations: "disabled",
          });
        }
      }
    }
  }
  expect(problems).toEqual([]);
  for (const [path, card] of [
    ["/apps/galgame-workshop", ".workshop-project-card"],
    ["/apps/audio-annotation", ".annotation-project-card"],
  ]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const projectCard = page.locator(card).first();
    await expect(projectCard).toBeVisible();
    expect((await projectCard.boundingBox())!.width).toBeGreaterThan(320);
    await captureResponsive(
      page,
      info,
      `populated-${path.replaceAll("/", "_")}`,
    );
  }
  await page.goto(`/apps/visual-workshop/projects/${visual.id}/canvas`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "添加内容", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "上传", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const canvasText = page.locator(".canvas-node.text textarea");
  await expect(canvasText).toHaveCount(1);
  await page.getByRole("button", { name: "适配视图", exact: true }).click();
  await canvasText.fill("移动端编辑后切换面板，保留这段草稿。");
  const originalText = await canvasText.elementHandle();
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await page.getByRole("button", { name: "关闭素材库", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await originalText!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(canvasText).toHaveValue("移动端编辑后切换面板，保留这段草稿。");
  await page.goto(`/apps/galgame-workshop/projects/${galgame.id}/editor`);
  await expect(page.locator(".galgame-editor-page")).toBeVisible();
  for (const label of ["资产", "叙事地图", "个性化", "设置"]) {
    await page
      .locator(".galgame-editor-tabs")
      .getByRole("button", { name: label, exact: true })
      .click();
    await expect(page.locator(".page-loading")).toHaveCount(0);
    await expect(page.locator(".galgame-editor-page")).toBeVisible();
    await captureResponsive(page, info, `galgame-${label}`);
    if (label === "资产") {
      for (const section of [
        "角色",
        "场景",
        "BGM",
        "音效",
        "语音",
        "视频素材",
        "资源总览",
      ]) {
        await page
          .locator(".galgame-asset-center > aside")
          .getByRole("button", { name: section, exact: true })
          .click();
        await expect(page.locator(".page-loading")).toHaveCount(0);
        await captureResponsive(page, info, `galgame-assets-${section}`);
      }
    }
  }
  for (const [kind, id] of [
    ["video-editor", video.id],
    ["galgame-workshop", galgame.id],
  ]) {
    await page.goto(`/apps/${kind}/projects/${id}/editor`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "导出视频", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "正在打开视频导出" }),
    ).toHaveCount(0);
    await expect(page.getByRole("dialog")).toBeVisible();
    await captureResponsive(page, info, `${kind}-export-dialog`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.goto(`/apps/thought-workshop/knowledge-bases/${knowledge.id}`);
  await page.getByRole("button", { name: "编辑首页", exact: true }).click();
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await prose.fill(
    "欢迎来到知识库。这里记录值得保留的想法。\n" +
      "一段用于屏幕适配的长正文，检查阅读宽度、滚动和侧栏背景。\n".repeat(40),
  );
  await prose.press("ControlOrMeta+s");
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await captureResponsive(page, info, "knowledge-long-editor");
  await page.reload();
  await expect(page.locator(".knowledge-home-reading")).toContainText(
    "欢迎来到知识库",
  );
  await captureResponsive(page, info, "knowledge-long-home");
});
