import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function createProject(page: Page) {
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    (row) => row.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "室内对话 · 创作项目", kind: "canvas" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const project = (await created.json()).id;
  const base = `/v1/visual-workshop/projects/${project}`;
  const node = randomUUID(),
    shot = randomUUID(),
    scene = randomUUID();
  const canvas = await page.request.put(`${base}/canvas`, {
    headers,
    data: {
      expected_revision: 0,
      nodes: [
        {
          id: node,
          kind: "video",
          title: "S02 · 人物A近景",
          position: { x: 200, y: 180 },
          generation_draft: {
            prompt: "保持人物外观，固定近景，人物A微微前倾。",
            active_prompt_version_id: "version-6",
            prompt_versions: [
              "v1",
              "用户确认分配·报社无墨镜",
              "二维融入实拍·表情继承",
              "用户指定得意脸红莉栖·C脸",
              "得意C脸·仅视觉输入·后期原声",
              "新增墨镜版·全身二维动画",
            ].map((name, index) => ({
              id: `version-${index + 1}`,
              name,
              prompt: "保持人物外观，固定近景，人物A微微前倾。",
            })),
          },
        },
      ],
      edges: [],
      categories: [],
    },
  });
  expect(canvas.ok(), await canvas.text()).toBeTruthy();
  const script = await page.request.put(`${base}/script`, {
    headers,
    data: {
      expected_revision: 0,
      episodes: [
        {
          id: randomUUID(),
          title: "第01集 · 室内对话",
          scenes: [
            {
              id: scene,
              title: "会客室",
              heading: "日内",
              text: "人物A：我觉得这件事，我们需要再确认一下。",
            },
          ],
        },
      ],
    },
  });
  expect(script.ok(), await script.text()).toBeTruthy();
  const board = await page.request.put(`${base}/storyboard`, {
    headers,
    data: {
      expected_revision: 0,
      shots: [
        {
          id: shot,
          title: "S02 · 人物A近景",
          video_node_id: node,
          duration: 3.5,
          source: { scene_id: scene, revision: 1 },
        },
      ],
    },
  });
  expect(board.ok(), await board.text()).toBeTruthy();
  await page.goto(`/apps/visual-workshop/projects/${project}/canvas`);
  await expect(
    page.getByRole("tab", { name: "工作台", exact: true }),
  ).toBeVisible();
  return { base, node, shot };
}

test("三个项目工作区默认固定侧栏，舒展布局保留分镜上下文及保存保护", async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { base, node } = await createProject(page);
  page.setDefaultTimeout(15_000);
  const origin = await page.evaluate(() => performance.timeOrigin);
  const tabs = page.getByRole("tablist", { name: "项目工作区" });
  const topbar = page.locator(".visual-project-header");
  expect(await topbar.count()).toBe(1);
  expect((await topbar.boundingBox())!.height).toBe(56);
  const original = await tabs.boundingBox();
  const originalTabs = await tabs.getByRole("tab").evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect();
      return { x: box.x, width: box.width, height: box.height };
    }),
  );
  expect(new Set(originalTabs.map((box) => box.width)).size).toBe(1);
  expect(new Set(originalTabs.map((box) => box.height)).size).toBe(1);
  expect(originalTabs[0]).toMatchObject({ width: 112, height: 36 });
  const workbenchX = (await page.locator(".board-main").boundingBox())!.x;
  expect(workbenchX).toBe(336);

  await expect(page.getByRole("textbox", { name: "搜索文件" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "取消固定素材面板" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    (await page.locator(".board-material-pane").boundingBox())!.width,
  ).toBe(280);
  expect((await page.locator(".board-search").boundingBox())!.height).toBe(32);
  expect(
    (await page.locator(".board-file-actions .board-primary").boundingBox())!
      .height,
  ).toBe(32);
  expect(
    (await page.locator(".board-file-actions .board-upload").boundingBox())!
      .height,
  ).toBe(32);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "搜索文件" })).toBeVisible();
  await expect(page.getByText("工作台 · 画布", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "分镜", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "搜索分镜" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "画布", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("textbox", { name: "搜索分镜" }).fill("S02");
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "看板", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".storyboard-production-editor")).toBeVisible();
  const videoEditor = page.locator(
    ".workbench-generation .video-node-composer",
  );
  await expect(
    videoEditor.getByRole("textbox", { name: "视频提示词", exact: true }),
  ).toHaveText("保持人物外观，固定近景，人物A微微前倾。");
  await page.getByRole("combobox", { name: "提示词版本", exact: true }).click();
  const versions = page.getByRole("listbox", {
    name: "提示词版本",
    exact: true,
  });
  const rows = await versions.getByRole("option").evaluateAll((items) =>
    items.map((item) => {
      const b = item.getBoundingClientRect();
      return {
        top: b.top,
        bottom: b.bottom,
        border: getComputedStyle(item).borderTopWidth,
      };
    }),
  );
  for (let i = 1; i < rows.length; i++)
    expect(rows[i].top - rows[i - 1].bottom).toBeGreaterThanOrEqual(6);
  expect(rows.every((row) => row.border === "0px")).toBe(true);
  await page.screenshot({
    path: info.outputPath("prompt-version-spacing.png"),
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "输入引用" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "制作类型" })).toHaveCount(0);
  const output = page.getByRole("region", { name: "节点输出历史" });
  const detailTabs = output.getByRole("tablist", { name: "镜头详情" });
  await expect(detailTabs).toBeVisible();
  const previewBox = (await output
    .locator(".board-large-preview")
    .boundingBox())!;
  const tabsBox = (await detailTabs.boundingBox())!;
  const versionsBox = (await output.locator("#shot-versions").boundingBox())!;
  expect(tabsBox.y - previewBox.y - previewBox.height).toBeLessThanOrEqual(10);
  expect(versionsBox.y - tabsBox.y - tabsBox.height).toBeLessThanOrEqual(10);
  await detailTabs.getByRole("tab", { name: "镜头属性" }).click();
  await expect(page.getByLabel("镜头标题", { exact: true })).toBeVisible();
  expect(
    (await page.getByLabel("镜头标题", { exact: true }).boundingBox())!.height,
  ).toBe(32);
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("storyboard-properties.png"),
  });
  await page.getByRole("button", { name: "切换深色" }).click();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("video-workbench-dark.png"),
  });
  await page.setViewportSize({ width: 1584, height: 994 });
  await page.getByRole("tab", { name: "文件", exact: true }).click();
  await expect(page.getByRole("region", { name: "输入引用" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "视频提示词", exact: true }).fill("");
  await page.locator(".board-node-type").click();
  await expect(
    page.getByRole("status", { name: "已保存", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("video-workbench-selected-design.png"),
  });
  await videoEditor.screenshot({
    animations: "disabled",
    path: info.outputPath("video-workbench-selected-panel.png"),
  });
  await page.getByRole("tab", { name: "分镜", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const videoFooter = (await videoEditor
    .locator(".video-composer-footer")
    .boundingBox())!;
  expect(videoFooter.x + videoFooter.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("video-workbench-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("storyboard-properties-dark.png"),
  });
  await page.getByRole("button", { name: "切换浅色" }).click();
  await detailTabs.getByRole("tab", { name: "输出版本" }).click();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("workbench-board.png"),
  });
  await page.getByRole("tab", { name: "剧本", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "剧本文本" })).toBeVisible();
  await page.getByRole("button", { name: "关联分镜 1" }).click();
  const linkedShots = page.getByRole("complementary", { name: "剧本关联镜头" });
  await expect(linkedShots).toBeVisible();
  await expect(
    linkedShots.getByRole("button", { name: "S02 · 人物A近景" }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("script-linked-shots.png"),
  });
  await page.getByRole("button", { name: "切换深色" }).click();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("script-linked-shots-dark.png"),
  });
  await page.setViewportSize({ width: 390, height: 900 });
  const linkedBounds = (await linkedShots.boundingBox())!;
  expect(linkedBounds.x).toBeGreaterThanOrEqual(0);
  expect(linkedBounds.x + linkedBounds.width).toBeLessThanOrEqual(390);
  await expect(
    linkedShots.getByRole("button", { name: "关闭关联分镜" }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("script-linked-shots-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "切换浅色" }).click();
  await linkedShots.getByRole("button", { name: "关闭关联分镜" }).click();
  await expect(
    page.getByRole("button", { name: "画布", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "素材分类" })).toBeHidden();
  await expect(
    page.getByRole("button", { name: "取消固定剧本侧栏" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    Math.abs((await tabs.boundingBox())!.x - original!.x),
  ).toBeLessThanOrEqual(1);
  expect(
    (await page.locator(".visual-script .creative-window").boundingBox())!.x,
  ).toBe(workbenchX);
  expect(
    await tabs
      .getByRole("tab")
      .evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().width),
      ),
  ).toEqual(originalTabs.map((box) => box.width));
  const text = page.getByRole("textbox", { name: "剧本文本" });
  await text.fill("修改后的对白，离开时自动保存。");
  await page.route(`**${base}/script`, async (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { detail: "测试保存失败" } })
      : route.fallback(),
  );
  await page.getByRole("tab", { name: "工作台", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "剧本", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(text).toHaveValue("修改后的对白，离开时自动保存。");
  await expect(
    page.getByRole("alert").filter({ hasText: "测试保存失败" }),
  ).toBeVisible();
  await page.unroute(`**${base}/script`);
  await page.getByRole("tab", { name: "工作台", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "看板", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "搜索分镜" })).toHaveValue(
    "S02",
  );
  await page.getByRole("tab", { name: "白模预演", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "场景名称" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "取消固定场景侧栏" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    (await page.locator(".visual-previs-workspace").boundingBox())!.x,
  ).toBe(workbenchX);
  await expect(
    page.getByRole("button", { name: "看板", exact: true }),
  ).toHaveCount(0);
  expect(
    Math.abs((await tabs.boundingBox())!.x - original!.x),
  ).toBeLessThanOrEqual(1);
  await page
    .getByRole("textbox", { name: "场景名称" })
    .fill("会客室 · 基础布景");
  await page.getByRole("button", { name: "新建预演场景" }).click();
  await expect(
    page.getByRole("region", { name: "镜头预演编辑器" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("previs-workspace.png"),
  });
  await page.getByRole("tab", { name: "剧本", exact: true }).click();
  await expect(text).toHaveValue("修改后的对白，离开时自动保存。");
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("script-workspace.png"),
  });
  await page.getByRole("tab", { name: "工作台", exact: true }).click();
  await page.getByRole("button", { name: "画布", exact: true }).click();
  const canvasNode = page.locator(`[data-node-id="${node}"]`);
  await canvasNode.locator("header").click();
  const actions = canvasNode.locator(".canvas-media-node-actions");
  await expect(actions).toBeVisible();
  const checkActions = async () => {
    const glyph = actions
      .getByRole("button", { name: "复制节点", exact: true })
      .locator("svg");
    const box = (await glyph.boundingBox())!;
    expect(box.width).toBeCloseTo(18, 0);
    expect(box.height).toBeCloseTo(18, 0);
    expect((await glyph.locator("..").boundingBox())!.width).toBeCloseTo(32, 0);
  };
  await checkActions();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("node-actions-100.png"),
  });
  await page.getByRole("button", { name: "缩小", exact: true }).click();
  await page.getByRole("button", { name: "缩小", exact: true }).click();
  await checkActions();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("node-actions-zoomed.png"),
  });
  await page.getByRole("button", { name: "取消固定素材面板" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "搜索分镜" })).toBeHidden();
  await page.getByRole("tab", { name: "分镜", exact: true }).click();
  await page.getByRole("button", { name: "固定素材面板" }).click();
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(topbar).toBeVisible();
    const box = (await topbar.boundingBox())!;
    expect(box.height).toBe(56);
    expect(box.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width >= 1024) {
      await expect(
        page.getByRole("textbox", { name: "搜索分镜" }),
      ).toBeVisible();
      expect((await page.locator(".board-main").boundingBox())!.x).toBe(336);
    } else {
      await expect(
        page.getByRole("textbox", { name: "搜索分镜" }),
      ).toBeHidden();
      expect((await page.locator(".board-main").boundingBox())!.x).toBe(56);
      await page.getByRole("tab", { name: "分镜", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "搜索分镜" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("textbox", { name: "搜索分镜" }),
      ).toBeHidden();
    }
    await page.screenshot({
      animations: "disabled",
      path: info.outputPath(`canvas-${width}.png`),
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("textbox", { name: "搜索分镜" })).toBeVisible();
  await page.getByRole("button", { name: "切换深色" }).click();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("canvas-dark.png"),
  });
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("workbench-board-dark.png"),
  });
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
});
