import { expect, test } from "@playwright/test";

test("原生模板画布：手势、分组、五页型、全局覆盖与示例复用", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const name = `原生技术模板 ${Date.now()}`;
  await page.goto("/apps/presentation-workshop/templates");
  await page.getByRole("button", { name: "新建模板", exact: true }).click();
  await page.getByRole("textbox", { name: "模板名称", exact: true }).fill(name);
  const canvas = page.getByRole("group", { name: "幻灯片画布", exact: true });
  await expect(canvas).toBeVisible();
  const title = canvas.locator('[data-element-id="page:slot-title"]');
  await title.click();
  const x = page.getByRole("spinbutton", { name: "所选对象 X", exact: true });
  await expect(x).toHaveValue("56");
  // A native gesture previews numeric geometry and commits one undo step.
  for (const zoomIn of [false, true]) {
    if (zoomIn)
      await page.getByRole("button", { name: "放大画布", exact: true }).click();
    const box = await title.boundingBox();
    if (!box) throw new Error("missing title");
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 3 + 48,
      box.y + box.height / 2 + 12,
      { steps: 8 },
    );
    await expect
      .poll(async () => Number(await x.inputValue()))
      .toBeGreaterThan(56);
    await page.mouse.up();
    await page
      .getByRole("button", { name: "撤销模板修改", exact: true })
      .click();
    await expect(x).toHaveValue("56");
    await page
      .getByRole("button", { name: "重做模板修改", exact: true })
      .click();
    await expect
      .poll(async () => Number(await x.inputValue()))
      .toBeGreaterThan(56);
    await page
      .getByRole("button", { name: "撤销模板修改", exact: true })
      .click();
  }
  await canvas.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(x).toHaveValue("66");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(x).toHaveValue("56");
  const resize = page.getByRole("button", {
    name: "拖动缩放所选元素",
    exact: true,
  });
  const resizeBox = await resize.boundingBox();
  if (!resizeBox) throw new Error("missing resize handle");
  await page.mouse.move(
    resizeBox.x + resizeBox.width / 2,
    resizeBox.y + resizeBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    resizeBox.x + resizeBox.width / 2 - 40,
    resizeBox.y + resizeBox.height / 2 + 12,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole("spinbutton", { name: "所选对象宽度", exact: true })
          .inputValue(),
      ),
    )
    .toBeLessThan(1168);
  await page.getByRole("button", { name: "撤销模板修改", exact: true }).click();
  const rotate = await page
    .getByRole("button", { name: "拖动旋转所选元素", exact: true })
    .boundingBox();
  if (!rotate) throw new Error("missing rotate handle");
  await page.mouse.move(
    rotate.x + rotate.width / 2,
    rotate.y + rotate.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(rotate.x + 80, rotate.y + 18, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Math.abs(
        Number(
          await page
            .getByRole("spinbutton", { name: "旋转", exact: true })
            .inputValue(),
        ),
      ),
    )
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "撤销模板修改", exact: true }).click();
  // Escape cancels an in-flight gesture without a history record.
  const box = await title.boundingBox();
  if (!box) throw new Error("missing title");
  await page.mouse.move(box.x + 80, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 25, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(x).toHaveValue("56");
  // Semantic deletion hides the slot; it remains available in the object list.
  await canvas.focus();
  await page.keyboard.press("Delete");
  await expect(title).toHaveCount(0);
  await page.getByRole("button", { name: "撤销模板修改", exact: true }).click();
  await expect(title).toBeVisible();
  // Chapter signature remains a single logical group.
  const chapter = canvas.locator('[data-element-id="page:slot-chapter"]');
  await chapter.click();
  await expect(
    page.getByRole("button", { name: "解组", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "解组", exact: true }).click();
  await page.getByRole("button", { name: "编组", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "解组", exact: true }),
  ).toBeEnabled();
  await canvas.focus();
  await page.keyboard.press("Escape");
  for (const type of ["封面", "目录", "章节过渡", "内容页", "结束页"]) {
    await page
      .getByRole("button", { name: `配置${type}页型`, exact: true })
      .click();
    await expect(canvas).toBeVisible();
    await expect(
      page.locator(".master-thumbnail-label").filter({ hasText: type }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "配置内容页页型", exact: true })
    .click();
  await expect
    .poll(() =>
      canvas
        .locator("img")
        .evaluateAll(
          (images) =>
            images.length === 3 &&
            images.every(
              (i) =>
                (i as HTMLImageElement).complete &&
                (i as HTMLImageElement).naturalWidth > 0,
            ),
        ),
    )
    .toBe(true);
  await page
    .getByRole("combobox", { name: "新增对象影响范围", exact: true })
    .click();
  await page.getByRole("option", { name: "全局固定", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" rx="6" fill="#2677D8"/></svg>',
    ),
  });
  await expect(
    page.getByText("影响范围：所有页型", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "所选对象 x", exact: true })
    .fill("1080");
  await page
    .getByRole("spinbutton", { name: "所选对象 y", exact: true })
    .fill("25");
  await page
    .getByRole("spinbutton", { name: "所选对象 width", exact: true })
    .fill("120");
  await page
    .getByRole("spinbutton", { name: "所选对象 height", exact: true })
    .fill("40");
  await page.getByRole("button", { name: "预览", exact: true }).click();
  const preview = page.getByRole("dialog", {
    name: "预览所有页型",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await preview.press("Escape");
  await expect(
    page.getByRole("button", { name: "预览", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "返回模板库", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "离开模板设计器？", exact: true })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.getByRole("button", { name: "保存模板", exact: true }).click();
  await expect(page.locator(".master-header")).toContainText("已保存");
  const editorUrl = page.url();
  await page.reload();
  await expect(canvas).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.addInitScript(
      (value) => localStorage.setItem("future_props_theme", value),
      theme,
    );
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const width of [390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`native-studio-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "返回模板库", exact: true }).click();
  const card = page
    .locator(".master-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await card.getByRole("button", { name: "使用模板", exact: true }).click();
  const create = page.getByRole("dialog", {
    name: "新建演示文稿",
    exact: true,
  });
  await create.getByRole("textbox").fill("原生模板旅程");
  await create.getByRole("button", { name: "确认", exact: true }).click();
  await expect(canvas).toBeVisible();
  const documentUrl = page.url();
  await page.getByRole("button", { name: "文稿模板", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "文稿模板", exact: true });
  await panel
    .getByRole("button", { name: "编辑模板布局", exact: true })
    .click();
  const global = page.getByRole("dialog", {
    name: "编辑当前文稿模板布局",
    exact: true,
  });
  await global
    .getByRole("button", { name: "配置封面页型", exact: true })
    .click();
  await global
    .locator(".master-object-list button")
    .filter({ hasText: "幻灯片标题" })
    .click();
  await global
    .getByRole("spinbutton", { name: "所选对象字号", exact: true })
    .fill("54");
  await global
    .getByRole("button", { name: "应用全稿样式", exact: true })
    .click();
  await expect(panel).toBeVisible();
  await panel
    .getByRole("button", { name: "关闭文稿模板", exact: true })
    .click();
  await page.getByRole("button", { name: "新建幻灯片", exact: true }).click();
  await expect(canvas.locator("img")).toHaveCount(4);
  await page.getByRole("button", { name: "文稿模板", exact: true }).click();
  await panel
    .getByText("正文版式 · 预览后应用到指定页", { exact: true })
    .click();
  await panel
    .getByRole("button", { name: "预览指定页版式", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "确认应用指定页版式", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "确认应用指定页版式", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "关闭文稿模板", exact: true })
    .click();
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await page.goto(editorUrl);
  await expect(canvas).toBeVisible();
  await page.goto(documentUrl);
  await expect(canvas).toBeVisible();
  await page.getByRole("button", { name: "文稿模板", exact: true }).click();
  await panel
    .getByRole("button", { name: "将当前文稿另存为示例", exact: true })
    .click();
  const example = page.getByRole("dialog", { name: "另存为示例", exact: true });
  await example.getByRole("textbox").fill(name + " 示例");
  await example.getByRole("button", { name: "确认", exact: true }).click();
  await expect(panel).toContainText("示例已保存");
  await panel
    .getByRole("button", { name: "关闭文稿模板", exact: true })
    .click();
  await page.goto("/apps/presentation-workshop/templates");
  const exampleCard = page.locator(".master-card").filter({
    has: page.getByRole("heading", { name: name + " 示例", exact: true }),
  });
  await exampleCard
    .getByRole("button", { name: "基于示例新建", exact: true })
    .click();
  const reuse = page.getByRole("dialog", { name: "新建演示文稿", exact: true });
  await reuse.getByRole("textbox").fill("复用原生模板示例");
  await reuse.getByRole("button", { name: "确认", exact: true }).click();
  await expect(canvas).toBeVisible();
});
