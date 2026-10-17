import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const screenshots = resolve(
  process.env.FPL_BOARD_SCREENSHOTS || "../.local/task-board-ui/screenshots",
);

test("30 个节点下的重要信息首屏可见，菜单、分类与分页历史保持可用", async ({
  page,
}) => {
  test.setTimeout(90_000);
  mkdirSync(screenshots, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "AI 娘的日常 · 创作工作台", kind: "canvas" },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = (await created.json()).id;
  const base = `/v1/visual-workshop/projects/${projectId}`;
  // A deterministic local illustration keeps screenshots useful without real model calls.
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    const sky = ctx.createLinearGradient(0, 0, 900, 600);
    sky.addColorStop(0, "#fbecd5");
    sky.addColorStop(1, "#c8b599");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 900, 600);
    ctx.fillStyle = "#fdf6e7";
    ctx.fillRect(50, 60, 330, 380);
    ctx.fillStyle = "#b9d8d5";
    ctx.fillRect(68, 78, 294, 326);
    ctx.fillStyle = "#fff9df";
    ctx.beginPath();
    ctx.arc(305, 140, 43, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7eaaa0";
    ctx.beginPath();
    ctx.moveTo(68, 320);
    ctx.lineTo(200, 240);
    ctx.lineTo(362, 350);
    ctx.lineTo(362, 404);
    ctx.lineTo(68, 404);
    ctx.fill();
    ctx.fillStyle = "#fdf6e7";
    ctx.fillRect(207, 78, 12, 326);
    ctx.fillRect(68, 235, 294, 12);
    ctx.fillStyle = "#a27e5c";
    ctx.fillRect(0, 455, 900, 145);
    ctx.fillStyle = "#f1dac1";
    ctx.fillRect(405, 270, 425, 190);
    ctx.fillStyle = "#eee9db";
    ctx.fillRect(425, 295, 385, 130);
    ctx.fillStyle = "#cc9178";
    ctx.fillRect(440, 304, 115, 66);
    ctx.fillRect(570, 304, 115, 66);
    ctx.fillStyle = "#71918d";
    ctx.fillRect(425, 370, 385, 65);
    ctx.fillStyle = "#5d7357";
    ctx.beginPath();
    ctx.ellipse(820, 240, 25, 60, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c18b68";
    ctx.fillRect(800, 285, 55, 40);
    ctx.fillStyle = "#ffffffc0";
    ctx.fillRect(30, 520, 430, 50);
    ctx.fillStyle = "#574c3e";
    ctx.font = "22px sans-serif";
    ctx.fillText("AI 娘的日常 · 晨光卧室", 46, 553);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const file = {
    name: "晨光卧室.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  };
  let response = await page.request.post(base + "/node-uploads", {
    headers,
    multipart: { expected_revision: "0", file },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  let canvas = await response.json();
  const imageId = canvas.nodes[0].id;
  for (let i = 0; i < 2; i++) {
    response = await page.request.post(
      `${base}/nodes/${imageId}/output-uploads`,
      {
        headers,
        multipart: { expected_revision: String(canvas.revision), file },
      },
    );
    expect(response.ok(), await response.text()).toBeTruthy();
    canvas = await response.json();
  }
  const nodes = [
    {
      ...canvas.nodes[0],
      title: "清晨卧室 · 光影与空间设定",
      category_id: "scene",
      tags: ["主场景", "暖色", "清晨", "卧室", "日常"],
      generation_draft: {
        model_id: "preview-image",
        prompt: "清晨的暖光穿过窗户，木质家具与柔软床品，保持场景结构一致。",
        size: "2560x1440",
      },
    },
    ...Array.from({ length: 29 }, (_, i) => {
      const kind = ["text", "image", "video", "audio"][i % 4];
      return {
        id: `density-${i}`,
        kind,
        title: `${["角色说明", "小夏人设", "镜头视频", "声音设计"][i % 4]} ${String(i + 1).padStart(2, "0")} · ${i === 1 ? "超长节点名称用于验证窄栏标题的换行与截断" : "日常创作"}`,
        category_id:
          kind === "audio"
            ? "sound"
            : kind === "text" || kind === "video"
              ? "storyboard"
              : "character",
        group: kind === "image" ? "主角" : null,
        tags: ["日常", "角色", "清晨", "室内"],
        position: { x: (i % 6) * 280, y: Math.floor(i / 6) * 240 },
        ...(kind === "text"
          ? { text: "小夏推开窗户，听见清晨的鸟鸣。" }
          : {
              asset_id:
                kind === "image" && i > 4 ? canvas.nodes[0].asset_id : null,
              generation_draft:
                kind === "image" || kind === "video"
                  ? {
                      model_id: "preview-image",
                      prompt: i > 3 ? "清晨日常场景" : "",
                    }
                  : null,
            }),
      };
    }),
  ];
  response = await page.request.put(base + "/canvas", {
    headers,
    data: {
      expected_revision: canvas.revision,
      nodes,
      edges: [
        {
          id: "input-scene",
          source_node_id: imageId,
          target_node_id: "density-2",
          binding: "final",
          purpose: "reference",
        },
      ],
      categories: [
        { id: "character", name: "人设", groups: ["主角"] },
        { id: "scene", name: "场景", groups: [] },
        { id: "storyboard", name: "分镜", groups: [] },
        { id: "sound", name: "声音设计", groups: [] },
        { id: "empty", name: "扩展分类", groups: [] },
      ],
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  canvas = await response.json();
  for (let version = 1; version <= 21; version++) {
    response = await page.request.post(`${base}/nodes/density-0/outputs`, {
      headers,
      data: {
        expected_revision: canvas.revision,
        text: `第 ${version} 版：清晨的角色说明。`,
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    canvas = await response.json();
  }
  await page.route("**/v1/visual-workshop/generation-options", (route) =>
    route.fulfill({
      json: {
        models: [
          {
            id: "preview-image",
            label: "Seedream 4.5",
            slug: "doubao-seedream-4-5-251128",
            provider_id: "mock",
            provider_name: "本地验收",
            kind: "image",
            description: "隔离验收模型，不提交生成",
            max_reference_images: 14,
            supports_seed: false,
            sizes: ["2048x2048", "2560x1440"],
          },
        ],
      },
    }),
  );
  await page.goto(`/apps/visual-workshop/projects/${projectId}/canvas`);
  await page.getByRole("button", { name: "看板", exact: true }).click();
  const tree = page.getByRole("complementary", {
    name: "项目素材",
    exact: true,
  });
  const sceneNode = tree.getByRole("button").filter({
    has: page.getByText("清晨卧室 · 光影与空间设定", { exact: true }),
  });
  await sceneNode.click();
  await expect(page.getByLabel("当前预览 v3 · 最终输出 v3")).toBeVisible();
  for (const locator of [
    page.getByRole("textbox", { name: "节点名称" }),
    page.getByRole("textbox", { name: "图片提示词" }),
    page.getByRole("combobox", { name: "生成模型" }),
    page.getByRole("button", { name: "图片参数" }),
    page.getByRole("button", { name: "生成图片" }),
    page.locator(".board-large-preview"),
  ]) {
    await expect(locator).toBeInViewport({ ratio: 0.9 });
  }
  await expect(page.getByRole("button", { name: "生成图片" })).toHaveText(
    "生成",
  );
  await expect(tree.getByText("扩展分类").locator("../..")).not.toHaveAttribute(
    "open",
  );
  await expect(tree.getByText("未分组")).toHaveCount(0);
  await expect(page.locator(".board-large-preview img")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "density-workbench-light.png"),
  });
  const menu = page.getByRole("button", { name: "管理分类 场景" });
  await menu.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "上传到此分类" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "新建分组" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole("menuitem", { name: "编辑分类" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑分类" });
  await dialog.getByLabel("名称").fill("场景设定");
  await dialog.getByRole("button", { name: "确认" }).click();
  await expect(tree.getByText("场景设定", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "整理", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "节点主分类" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "整理", exact: true }).click();
  await page
    .locator(".board-version-list button")
    .filter({ hasText: "v2" })
    .click();
  await page.getByRole("button", { name: "状态分组", exact: true }).click();
  await page.getByRole("button", { name: "创作工作台", exact: true }).click();
  await expect(page.getByLabel("当前预览 v2 · 最终输出 v3")).toBeVisible();
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await expect(page.getByLabel("当前预览 v2 · 最终输出 v3")).toBeVisible();
  await page.getByRole("button", { name: "设为最终输出" }).click();
  await expect(page.getByLabel("当前预览 v2 · 最终输出 v2")).toBeVisible();
  await tree.getByRole("button", { name: /^角色说明 01/ }).click();
  await page.getByRole("button", { name: "加载更早版本" }).click();
  await expect(page.locator(".board-version-list button")).toHaveCount(21);
  await page
    .locator(".board-version-list button")
    .filter({ hasText: /^v1\s*文本保存$/ })
    .click();
  await expect(page.getByLabel("当前预览 v1 · 最终输出 v21")).toBeVisible();
  await sceneNode.click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".board-version-list img")).toHaveCount(3);
  await expect
    .poll(() =>
      page
        .locator(".board-version-list img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBeTruthy();
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "density-workbench-dark.png"),
  });
  await page.getByRole("button", { name: "状态分组", exact: true }).click();
  await expect(page.locator(".board-task-card")).toHaveCount(30);
  await expect(page.locator(".board-task-card.is-done img")).toHaveCount(7);
  await expect
    .poll(() =>
      page
        .locator(".board-task-card.is-done img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBeTruthy();
  await expect
    .poll(() =>
      page
        .locator(".board-status-list")
        .first()
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBeTruthy();
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "density-status-dark.png"),
  });
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "density-status-light.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBeTruthy();
  await page.getByRole("button", { name: "切换项目素材面板" }).click();
  await expect(tree).toBeVisible();
  await sceneNode.click();
  await page.getByRole("button", { name: "创作工作台", exact: true }).click();
  await expect(tree).not.toBeVisible();
  await expect(page.getByRole("button", { name: "生成图片" })).toBeInViewport();
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "density-narrow.png"),
  });
});
