import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { newDeck } from "../src/features/presentation-workshop/templates";
import { infographicTemplates } from "../src/features/presentation-workshop/infographics/catalog";
import {
  nativeOverview,
  doubleLaneSource,
} from "./presentation-reconstruction-fixtures";

async function create(page: Page) {
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers,
      data: {
        title: `信息图制作闭环 ${Date.now()}`,
        document: newDeck("blank"),
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.reload();
  await page
    .getByRole("button", { name: `打开 ${project.title}`, exact: true })
    .click();
  await expect(page.getByRole("group", { name: "幻灯片画布" })).toBeVisible();
  return { project, headers };
}

test("五类信息图原生插入、来源更新、保存重开与统一导出", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1680, height: 1080 });
  const { project, headers } = await create(page);
  for (const [index, template] of infographicTemplates.entries()) {
    if (index)
      await page
        .getByRole("button", { name: "新建幻灯片", exact: true })
        .click();
    await page.getByRole("button", { name: "信息图", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "插入与编辑信息图" });
    if (index) {
      await dialog
        .getByRole("combobox", { name: "信息图模板", exact: true })
        .click();
      await page
        .getByRole("option", { name: template.label, exact: true })
        .click();
    }
    await dialog.getByRole("button", { name: "预览转换结果" }).click();
    await expect(
      dialog.getByRole("button", { name: "预览转换结果" }),
    ).toBeEnabled({ timeout: 20000 });
    await expect(dialog.locator('[role="alert"]')).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "应用到当前页" }),
    ).toBeEnabled({ timeout: 20000 });
    await page.screenshot({ path: info.outputPath(`conversion-${index}.png`) });
    await dialog.getByRole("button", { name: "应用到当前页" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.locator(".presentation-canvas .presentation-text").first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "保存文稿", exact: true }).click();
    await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
    await page.keyboard.press("Escape");
    await page.screenshot({ path: info.outputPath(`slide-${index}.png`) });
  }
  const before = (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  const saved = await before;
  expect(saved.document.slides).toHaveLength(5);
  const headings = [
    "PPT Agent 的技术演进",
    "PPT Agent 的技术演进",
    "模板生成与整页生图",
    "PPT Agent",
    "页面重建流程",
  ];
  for (const [index, slide] of saved.document.slides.entries()) {
    const heading = slide.elements.find(
      (e: { paragraphs: { runs: { text: string }[] }[] }) =>
        e.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join("") ===
        headings[index],
    );
    expect(heading).toBeTruthy();
    expect(heading.y).toBeLessThanOrEqual(60);
    expect(heading.paragraphs[0].runs[0].size).toBe(44);
    for (const element of slide.elements) {
      if (element.id !== heading.id)
        expect(element.y).toBeGreaterThanOrEqual(heading.y + heading.height);
    }
    if (index < 2) {
      expect(slide.connections).toHaveLength(2);
    }
    if (index === 0) {
      expect(
        slide.elements.every((e: { kind: string }) => e.kind === "text"),
      ).toBeTruthy();
    }
    expect(slide.groups.length).toBeGreaterThan(0);
    expect(slide.infographics).toHaveLength(1);
    expect(
      slide.elements.filter((e: { kind: string }) => e.kind === "text").length,
    ).toBeGreaterThan(1);
  }
  await page.reload();
  await expect(
    page.locator(".presentation-canvas .presentation-text").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "幻灯片 1", exact: true }).click();
  const firstText = page
    .locator(".presentation-canvas .presentation-text")
    .first();
  await firstText.click();
  await page.getByRole("button", { name: "编辑信息图源码" }).click();
  const dialog = page.getByRole("dialog", { name: "插入与编辑信息图" });
  const source = dialog.getByRole("textbox", { name: "信息图源码" });
  await source.fill(
    (await source.inputValue()).replace("结构化模板", "第一阶段模板"),
  );
  await dialog.getByRole("button", { name: "预览转换结果" }).click();
  await expect(dialog.getByRole("button", { name: "应用更新" })).toBeEnabled();
  await dialog.getByRole("button", { name: "应用更新" }).click();
  await expect(
    page
      .locator(".presentation-canvas")
      .getByText("第一阶段模板", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    page
      .locator(".presentation-canvas")
      .getByText("结构化模板", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  const current = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  const exported = await page.request.post(
    `/v1/presentation-workshop/projects/${project.id}/export`,
    { headers, data: { expected_revision: current.revision } },
  );
  expect(exported.ok()).toBeTruthy();
  await fs.writeFile(
    info.outputPath("native-infographics.pptx"),
    await exported.body(),
  );
});

test("参考图隔离显示、节点端点与页面检查", async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { project, headers } = await create(page);
  await page.getByRole("button", { name: "更多编辑工具" }).click();
  await page.getByRole("menuitem", { name: "参考图", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "选择文件库图片" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "上传图片", exact: true }).click();
  const source = process.env.FPL_PRESENTATION_REFERENCE;
  const bytes = source
    ? await fs.readFile(source)
    : Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#e6edf5"/></svg>',
      );
  await page
    .locator('input[type="file"]')
    .last()
    .setInputFiles({
      name: source ? "reference.png" : "reference.svg",
      mimeType: source ? "image/png" : "image/svg+xml",
      buffer: bytes,
    });
  await expect(page.getByRole("dialog", { name: "参考图设置" })).toBeVisible();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator(".presentation-reference-side")).toBeVisible();
  await page.getByRole("button", { name: "更多编辑工具" }).click();
  await page.getByRole("menuitem", { name: "参考图", exact: true }).click();
  await page.getByRole("combobox", { name: "参考图显示方式" }).click();
  await page.getByRole("option", { name: "透明叠加" }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator(".presentation-reference-overlay")).toBeVisible();
  await page.getByRole("button", { name: "文本", exact: true }).click();
  await page.getByRole("button", { name: "文本", exact: true }).click();
  await page.getByRole("button", { name: "更多编辑工具" }).click();
  await page.getByRole("menuitem", { name: "连接节点", exact: true }).click();
  await page.getByRole("textbox", { name: "连接标签" }).fill("输入");
  await page.getByRole("button", { name: "创建连接", exact: true }).click();
  await expect(
    page.locator(".presentation-canvas [data-connection-id]"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "更多编辑工具" }).click();
  await page.getByRole("menuitem", { name: "检查页面", exact: true }).click();
  await expect(page.getByRole("region", { name: "页面检查" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("reference-overlay.png") });
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  const saved = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  expect(saved.document.slides[0].reference.asset_id).toBeTruthy();
  const exported = await page.request.post(
    `/v1/presentation-workshop/projects/${project.id}/export`,
    { headers, data: { expected_revision: saved.revision } },
  );
  expect(exported.ok()).toBeTruthy();
  await fs.writeFile(
    info.outputPath("reference-excluded.pptx"),
    await exported.body(),
  );
  await page.getByRole("button", { name: "从头放映", exact: true }).click();
  await expect(
    page.locator(".presentation-show .presentation-reference-overlay"),
  ).toHaveCount(0);
});

test("视觉稿对照重建、组内编辑与双泳道关系布局", async ({ page }, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1800, height: 1100 });
  const { project, headers } = await create(page);
  const fragment = nativeOverview();
  await page.getByRole("button", { name: "信息图", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "插入与编辑信息图" });
  await dialog.getByRole("combobox", { name: "信息图输入格式" }).click();
  await page.getByRole("option", { name: "工坊场景 JSON" }).click();
  await dialog
    .getByRole("textbox", { name: "信息图源码" })
    .fill(JSON.stringify(fragment));
  await dialog.getByRole("button", { name: "预览转换结果" }).click();
  await expect(
    dialog.getByRole("button", { name: "应用到当前页" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "应用到当前页" }).click();
  await expect(dialog).toHaveCount(0);
  // Selecting through the root, column and node scopes leaves text editable.
  const first = page
    .locator(".presentation-canvas")
    .getByText("模板 PPT", { exact: true });
  for (let depth = 0; depth < 3; depth++) {
    if (depth) await first.click();
    await page.getByRole("button", { name: "更多编辑工具" }).click();
    await page.getByRole("menuitem", { name: "进入分组", exact: true }).click();
  }
  // Entering a scope clears selection; select the text before double-click editing.
  await first.click();
  await first.dblclick();
  const editor = page.getByRole("textbox", { name: "编辑幻灯片文字" });
  await editor.fill("模板 PPT 文档");
  await page.keyboard.press("Escape");
  await expect(
    page
      .locator(".presentation-canvas")
      .getByText("模板 PPT 文档", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  // The visual master is a protected reference only, never the editable result.
  const referencePath = process.env.FPL_PRESENTATION_REFERENCE;
  if (referencePath) {
    const uploaded = await page.request.post("/v1/files", {
      headers,
      multipart: {
        upload: {
          name: "three-stages-reference.png",
          mimeType: "image/png",
          buffer: await fs.readFile(referencePath),
        },
      },
    });
    expect(uploaded.ok()).toBeTruthy();
    const asset = await uploaded.json();
    const saved = await (
      await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
    ).json();
    saved.document.slides[0].reference = {
      asset_id: asset.id,
      mode: "side",
      opacity: 0.35,
      visible: true,
    };
    expect(
      (
        await page.request.put(
          `/v1/presentation-workshop/projects/${project.id}`,
          {
            headers,
            data: {
              title: saved.title,
              document: saved.document,
              expected_revision: saved.revision,
            },
          },
        )
      ).ok(),
    ).toBeTruthy();
    await page.reload();
    await expect(
      page.locator(".presentation-reference-side img"),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("three-stages-reference-and-native.png"),
    });
  }
  await page.getByRole("button", { name: "新建幻灯片", exact: true }).click();
  await page.getByRole("button", { name: "信息图", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "插入与编辑信息图" });
  await dialog
    .getByRole("textbox", { name: "信息图源码" })
    .fill(doubleLaneSource);
  await dialog.getByRole("button", { name: "预览转换结果" }).click();
  await expect(
    dialog.getByRole("button", { name: "应用到当前页" }),
  ).toBeEnabled({ timeout: 20000 });
  await dialog.getByRole("button", { name: "应用到当前页" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".presentation-canvas [data-connection-id]"),
  ).toHaveCount(4);
  await page.getByRole("button", { name: "更多编辑工具" }).click();
  await page.getByRole("menuitem", { name: "自动布局", exact: true }).click();
  await page.getByRole("button", { name: "更多编辑工具" }).click();
  await expect(
    page.getByRole("menuitem", { name: "自动布局", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: info.outputPath("double-lane-native-layout.png"),
  });
  await page.getByRole("button", { name: "更多编辑工具" }).click();
  await page
    .getByRole("menuitem", { name: "复制所选元素", exact: true })
    .click();
  await expect(
    page.locator(".presentation-canvas [data-connection-id]"),
  ).toHaveCount(8);
  await page.getByRole("button", { name: "更多编辑工具" }).click();
  await page
    .getByRole("menuitem", { name: "删除所选元素", exact: true })
    .click();
  await expect(
    page.locator(".presentation-canvas [data-connection-id]"),
  ).toHaveCount(4);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    page.locator(".presentation-canvas [data-connection-id]"),
  ).toHaveCount(8);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(
    page.locator(".presentation-canvas [data-connection-id]"),
  ).toHaveCount(4);
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  await page.reload();
  await page.getByRole("button", { name: "幻灯片 2", exact: true }).click();
  await expect(
    page.locator(".presentation-canvas [data-connection-id]"),
  ).toHaveCount(4);
  const saved = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  const response = await page.request.post(
    `/v1/presentation-workshop/projects/${project.id}/export`,
    { headers, data: { expected_revision: saved.revision } },
  );
  expect(response.ok()).toBeTruthy();
  await fs.writeFile(
    info.outputPath("visual-reconstruction-native.pptx"),
    await response.body(),
  );
  await fs.writeFile(
    info.outputPath("visual-reconstruction-scene.json"),
    JSON.stringify(saved.document, null, 2),
  );
});

test("信息图入口与预览适配明暗主题和窄屏键盘操作", async ({ page }, info) => {
  await create(page);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole("button", { name: "信息图", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "插入与编辑信息图" });
    await dialog.getByRole("button", { name: "预览转换结果" }).click();
    await expect(
      dialog.getByRole("button", { name: "应用到当前页" }),
    ).toBeEnabled({ timeout: 20000 });
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`infographic-mobile-${theme}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
});
