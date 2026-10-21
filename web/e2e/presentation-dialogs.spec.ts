import { expect, test, type Locator, type Page } from "@playwright/test";
import { newDeck } from "../src/features/presentation-workshop/templates";

async function create(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const document = newDeck("blank");
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title: "紧凑弹窗验收", document },
    },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(page.getByRole("group", { name: "幻灯片画布" })).toBeVisible();
  return project;
}
async function insert(page: Page, kind: string) {
  await page.getByRole("button", { name: "更多编辑工具" }).click();
  await page
    .getByRole("menuitem", { name: `插入${kind}`, exact: true })
    .click();
  return page.getByRole("dialog", { name: `插入${kind}`, exact: true });
}
async function bounded(page: Page, dialog: Locator, width: number) {
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(width + 1);
  expect(box.x).toBeGreaterThanOrEqual(11);
  expect(box.y).toBeGreaterThanOrEqual(11);
  expect(box.x + box.width).toBeLessThanOrEqual(
    page.viewportSize()!.width - 11,
  );
  expect(box.y + box.height).toBeLessThanOrEqual(
    page.viewportSize()!.height - 11,
  );
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  const footer = dialog.locator(":scope > footer");
  if (await footer.count()) {
    const actions = (await footer.boundingBox())!;
    expect(actions.y).toBeGreaterThanOrEqual(box.y);
    expect(actions.y + actions.height).toBeLessThanOrEqual(box.y + box.height);
  }
}

test("图表在明暗主题、六种宽度和低高度窗口中保持紧凑且按钮可见", async ({
  page,
}, info) => {
  await create(page);
  const dialog = await insert(page, "图表");
  await expect(dialog.locator(".presentation-chart-preview svg")).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    for (const [width, height] of [
      [1600, 900],
      [1440, 900],
      [1024, 900],
      [768, 900],
      [390, 844],
      [360, 800],
      [1024, 600],
    ]) {
      await page.setViewportSize({ width, height });
      await bounded(page, dialog, 840);
      const preview = (await dialog
        .locator(".presentation-object-preview")
        .boundingBox())!;
      const settings = (await dialog
        .locator(".presentation-object-settings")
        .boundingBox())!;
      if (width >= 1024) {
        expect(preview.width).toBeCloseTo(300, 0);
        expect(settings.x).toBeGreaterThan(preview.x + preview.width);
      } else
        expect(settings.y).toBeGreaterThanOrEqual(preview.y + preview.height);
      if (width === 1440) {
        expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(600);
        await expect(
          dialog.getByRole("spinbutton", { name: "系列 1 数据 3" }),
        ).toBeInViewport();
      }
      await expect
        .poll(async () => {
          const host = (await dialog
            .locator(".presentation-chart-preview-host")
            .boundingBox())!;
          const svg = (await dialog
            .locator(".presentation-chart-preview svg")
            .boundingBox())!;
          return Math.abs(host.width - svg.width);
        })
        .toBeLessThan(2);
      await page.screenshot({
        path: info.outputPath(`chart-${theme}-${width}-${height}.png`),
      });
    }
  }
  await dialog.getByRole("button", { name: "应用", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "关闭内容编辑" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "应用", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("combobox", { name: "图表类型" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "图表类型" }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "图表主题色 1" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "系列 1 名称", exact: true })
    .dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "更多编辑工具" }),
  ).toBeFocused();
  await expect(
    page.locator(".presentation-canvas [data-element-id]"),
  ).toHaveCount(0);
});

test("长数据局部滚动，编辑只在应用后提交且可一次撤销", async ({
  page,
}, info) => {
  await create(page);
  const dialog = await insert(page, "图表");
  for (let i = 0; i < 10; i++)
    await dialog.getByRole("button", { name: "添加分类", exact: true }).click();
  for (let i = 0; i < 5; i++)
    await dialog.getByRole("button", { name: "添加系列", exact: true }).click();
  await page.setViewportSize({ width: 1024, height: 600 });
  await bounded(page, dialog, 840);
  expect(
    await dialog
      .locator(".presentation-data-grid")
      .evaluate(
        (el) =>
          el.scrollHeight > el.clientHeight && el.scrollWidth > el.clientWidth,
      ),
  ).toBe(true);
  await dialog
    .getByRole("spinbutton", { name: "系列 1 数据 1", exact: true })
    .fill("99");
  await dialog.getByRole("button", { name: "应用", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".presentation-canvas [data-element-id]"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    page.locator(".presentation-canvas [data-element-id]"),
  ).toHaveCount(0);
  const table = await insert(page, "表格");
  for (let i = 0; i < 10; i++)
    await table.getByRole("button", { name: "添加行", exact: true }).click();
  await bounded(page, table, 840);
  await table
    .getByRole("textbox", { name: "第 1 行第 1 列", exact: true })
    .fill("保存测试");
  await page.screenshot({ path: info.outputPath("table-long.png") });
  await table.getByRole("button", { name: "应用", exact: true }).click();
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  await page.reload();
  await expect(page.locator(".presentation-canvas")).toContainText("保存测试");
});

test("简单表单、媒体、代码、信息图、主题、备注和导出使用对应尺寸", async ({
  page,
}, info) => {
  await create(page);
  for (const kind of ["公式", "视频", "音频", "表格"]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dialog = await insert(page, kind);
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await bounded(
        page,
        dialog,
        kind === "表格" ? 840 : kind === "公式" ? 1080 : 600,
      );
    }
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "查找与替换", exact: true }).click();
  await bounded(
    page,
    page.getByRole("dialog", { name: "查找与替换", exact: true }),
    600,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "代码块", exact: true }).click();
  await bounded(
    page,
    page.getByRole("dialog", { name: "插入代码块", exact: true }),
    840,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "信息图", exact: true }).click();
  const infoDialog = page.getByRole("dialog", { name: "插入与编辑信息图" });
  await bounded(page, infoDialog, 840);
  await infoDialog
    .getByRole("button", { name: "预览转换结果", exact: true })
    .click();
  await expect(infoDialog.locator(".presentation-scene-preview")).toBeVisible();
  await page.screenshot({ path: info.outputPath("infographic.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "应用蓝青风格", exact: true }).click();
  await bounded(
    page,
    page.getByRole("dialog", { name: "应用蓝青风格", exact: true }),
    840,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /演示者备注/ }).click();
  await page.getByRole("button", { name: "富文本备注", exact: true }).click();
  await bounded(
    page,
    page.getByRole("dialog", { name: "富文本演讲者备注" }),
    600,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "导出选项" }).click();
  await page
    .getByRole("menuitem", { name: "导出 PNG 文件", exact: true })
    .click();
  await bounded(
    page,
    page.getByRole("dialog", { name: "导出 PNG", exact: true }),
    440,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "返回文稿列表" }).click();
  await page.getByRole("button", { name: "新建演示文稿", exact: true }).click();
  const input = page.getByRole("dialog", { name: "新建演示文稿", exact: true });
  await bounded(page, input, 440);
  await page.screenshot({ path: info.outputPath("new-document.png") });
});

test("素材分页、SVG 预检、预览和删除确认保持局部滚动与固定操作", async ({
  page,
}, info) => {
  await create(page);
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect width="120" height="80" fill="#5474E5"/></svg>';
  for (let i = 0; i < 26; i++) {
    const uploaded = await page.request.post("/v1/files", {
      headers,
      multipart: {
        upload: {
          name: `弹窗素材-${i}.svg`,
          mimeType: "image/svg+xml",
          buffer: Buffer.from(
            svg.replace("#5474E5", `#5474${i.toString(16).padStart(2, "0")}`),
          ),
        },
      },
    });
    expect(uploaded.ok()).toBeTruthy();
  }
  await page.getByRole("button", { name: "文件库", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "选择文件库图片",
    exact: true,
  });
  await expect(dialog.locator(".presentation-image-grid button")).toHaveCount(
    24,
  );
  for (const width of [1440, 768, 360]) {
    await page.setViewportSize({ width, height: 600 });
    await bounded(page, dialog, 840);
    await page.screenshot({ path: info.outputPath(`library-${width}.png`) });
  }
  await dialog.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(dialog.locator(".presentation-image-grid button")).toHaveCount(
    2,
  );
  await dialog.getByRole("tab", { name: "SVG", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "SVG 代码", exact: true })
    .fill(svg);
  await dialog.getByRole("button", { name: "检查并预览", exact: true }).click();
  await expect(dialog.getByAltText("SVG 导入预览")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "确认导入", exact: true }),
  ).toBeInViewport();
  await bounded(page, dialog, 840);
  await page.screenshot({ path: info.outputPath("svg-mobile.png") });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "返回文稿列表" }).click();
  const card = page.locator(".presentation-project-card").first();
  await card.getByRole("button", { name: /^文稿操作/ }).click();
  await page.getByRole("menuitem", { name: /^重命名/ }).click();
  await bounded(
    page,
    page.getByRole("dialog", { name: "重命名文稿", exact: true }),
    440,
  );
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: /^文稿操作/ }).click();
  await page.getByRole("menuitem", { name: /^删除/ }).click();
  const confirmation = page.getByRole("alertdialog", {
    name: "删除演示文稿",
    exact: true,
  });
  await page.setViewportSize({ width: 360, height: 600 });
  await bounded(page, confirmation, 440);
  await page.screenshot({ path: info.outputPath("delete-mobile.png") });
  await page.keyboard.press("Escape");
});

test("导入加载、错误及长报告完整显示，取消不创建文稿", async ({
  page,
}, info) => {
  const project = await create(page);
  await page.getByRole("button", { name: "返回文稿列表" }).click();
  const file = {
    name: "预检.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project.document)),
  };
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    "**/v1/presentation-workshop/imports/preview",
    async (route) => {
      await pending;
      await route.fulfill({ status: 422, json: { detail: "无法解析该文稿" } });
    },
  );
  await page.getByLabel("选择导入文稿", { exact: true }).setInputFiles(file);
  const dialog = page.getByRole("dialog", {
    name: "导入演示文稿",
    exact: true,
  });
  await expect(dialog.getByRole("status")).toContainText("正在解析");
  await bounded(page, dialog, 840);
  release();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.unroute("**/v1/presentation-workshop/imports/preview");
  await page.route("**/v1/presentation-workshop/imports/preview", (route) =>
    route.fulfill({
      json: {
        title: "长报告预检",
        document: project.document,
        preview_assets: {},
        issues: Array.from({ length: 100 }, (_, i) => ({
          code: "unsupported",
          message: `第 ${i + 1} 项需要核对：复杂效果完整保留在转换差异报告中。`,
        })),
      },
    }),
  );
  await page.getByLabel("选择导入文稿", { exact: true }).setInputFiles(file);
  await expect(dialog.locator("li")).toHaveCount(100);
  await expect(
    dialog.getByRole("button", { name: "创建新文稿", exact: true }),
  ).toBeDisabled();
  for (const width of [1440, 768, 360]) {
    await page.setViewportSize({ width, height: 600 });
    await bounded(page, dialog, 840);
    expect(
      await dialog
        .locator(".presentation-dialog-report")
        .evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`import-report-${width}.png`),
    });
  }
  await dialog
    .getByRole("button", { name: "确认以上转换差异", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "创建新文稿", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const stored = await page.request.get(
    `/v1/presentation-workshop/projects/${project.id}`,
  );
  expect((await stored.json()).revision).toBe(project.revision);
});

test("触控设备保留按钮和选色器的点击区域", async ({
  browser,
  page,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    storageState: await page.context().storageState(),
  });
  const touch = await context.newPage();
  await create(touch);
  const dialog = await insert(touch, "图表");
  await touch.setViewportSize({ width: 390, height: 844 });
  await bounded(touch, dialog, 840);
  for (const name of ["应用", "取消", "添加分类", "图表主题色 1"]) {
    const box = (await dialog
      .getByRole("button", { name, exact: true })
      .boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.height).toBeGreaterThanOrEqual(40);
  }
  await context.close();
});
