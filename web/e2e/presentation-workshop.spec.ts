import { expect, test, type Page } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";

async function create(page: Page) {
  await page.goto("/apps/presentation-workshop");
  await page.getByRole("button", { name: "新建演示文稿", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "新建演示文稿",
    exact: true,
  });
  await dialog.getByRole("textbox").fill(`演示测试 ${Date.now()}`);
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("group", { name: "幻灯片画布" })).toBeVisible();
  await page.getByRole("button", { name: /演示者备注/ }).click();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
}
test("正文列表可选类型、续项退出、保存重开及放映", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await create(page);
  await page.getByRole("button", { name: "新建幻灯片", exact: true }).click();
  await page.getByRole("button", { name: "文本", exact: true }).click();
  const canvas = page.getByRole("group", { name: "幻灯片画布" });
  await canvas.getByText("在此输入文字", { exact: true }).dblclick();
  const editor = page.getByRole("textbox", { name: "编辑幻灯片文字" });
  await editor.fill("第一项");
  const toolbar = page.getByRole("toolbar", { name: "所选元素工具栏" });
  await toolbar.getByRole("combobox", { name: "列表类型" }).click();
  await page.getByRole("option", { name: "编号列表", exact: true }).click();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("第二项");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.insertText("同项续行");
  await expect(editor.locator('p[data-numbered="true"]')).toHaveCount(2);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("普通正文");
  await expect(editor.locator('p[data-numbered="false"]').last()).toHaveText(
    "普通正文",
  );
  await page.keyboard.press("Escape");
  const list = canvas
    .locator(".presentation-text")
    .filter({ hasText: "第一项" });
  await expect(list.locator(".presentation-bullet")).toHaveText(["1.", "2."]);
  await save(page);
  await page.reload();
  await page.getByRole("button", { name: "幻灯片 2", exact: true }).click();
  await expect(list.locator(".presentation-bullet")).toHaveText(["1.", "2."]);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.screenshot({ path: testInfo.outputPath(`lists-${theme}.png`) });
  }
  await page.getByRole("button", { name: "从头放映", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  const show = page.getByRole("dialog", { name: "幻灯片放映" });
  await expect(
    show
      .locator(".presentation-text")
      .filter({ hasText: "第一项" })
      .locator(".presentation-bullet"),
  ).toHaveText(["1.", "2."]);
  await page.keyboard.press("Escape");
  await list.click();
  const inspector = page.getByRole("complementary", { name: "格式面板" });
  await inspector.getByRole("combobox", { name: "列表类型" }).click();
  await page.getByRole("option", { name: "项目符号", exact: true }).click();
  await expect(list.locator(".presentation-bullet")).toHaveText([
    "•",
    "•",
    "•",
  ]);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(list.locator(".presentation-bullet")).toHaveText(["1.", "2."]);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(list.locator(".presentation-bullet")).toHaveText([
    "•",
    "•",
    "•",
  ]);
  await page.setViewportSize({ width: 390, height: 900 });
  await toolbar
    .getByRole("button", { name: "更多文字格式", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "编号列表", exact: true }).click();
  await expect(list.locator(".presentation-bullet")).toHaveText([
    "1.",
    "2.",
    "3.",
  ]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await inspector.getByRole("combobox", { name: "列表类型" }).press("Enter");
  await page.getByRole("option", { name: "无列表", exact: true }).click();
  await expect(list.locator(".presentation-bullet")).toHaveCount(0);
});
test("创建、编辑文字、备注和页面，保存重开及放映", async ({ page }) => {
  await create(page);
  const canvas = page.getByRole("group", { name: "幻灯片画布" });
  await canvas.getByText("让想法，被看见", { exact: true }).dblclick();
  const editor = page.getByRole("textbox", { name: "编辑幻灯片文字" });
  await editor.fill("中文输入与 Native PPTX");
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: "演示者备注" })
    .fill("这段备注应保存并导出。");
  await page.getByRole("button", { name: "新建幻灯片", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "幻灯片 2", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "文本", exact: true }).click();
  await canvas.getByText("在此输入文字", { exact: true }).dblclick();
  await editor.fill("第二页内容");
  await page.keyboard.press("Escape");
  await save(page);
  await page.reload();
  await expect(
    canvas.getByText("中文输入与 Native PPTX", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /演示者备注/ }).click();
  await expect(page.getByRole("textbox", { name: "演示者备注" })).toHaveValue(
    "这段备注应保存并导出。",
  );
  await page.getByRole("button", { name: "从头放映", exact: true }).click();
  const show = page.getByRole("dialog", { name: "幻灯片放映" });
  await expect(
    show.getByText("中文输入与 Native PPTX", { exact: true }),
  ).toBeVisible();
  await expect(show.getByRole("textbox", { name: "演示者备注" })).toHaveCount(
    0,
  );
  await page.keyboard.press("ArrowRight");
  await expect(show.getByText("第二页内容", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(show).toHaveCount(0);
});
test("图形移动、缩放、旋转、锁定与撤销", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await create(page);
  await page.getByRole("button", { name: "插入图形", exact: true }).click();
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.getByLabel("X", { exact: true }).fill("300");
  await page.getByLabel("旋转角度", { exact: true }).fill("30");
  await page.getByRole("button", { name: "锁定元素", exact: true }).click();
  await expect(page.getByLabel("X", { exact: true })).toBeDisabled();
  await page
    .getByRole("toolbar", { name: "所选元素工具栏" })
    .getByRole("button", { name: "解锁元素", exact: true })
    .click();
  await page.getByRole("button", { name: "更多编辑工具" }).click();
  await page
    .getByRole("menuitem", { name: "复制所选元素", exact: true })
    .click();
  await expect(
    page.locator(".presentation-canvas .presentation-element"),
  ).toHaveCount(5);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    page.locator(".presentation-canvas .presentation-element"),
  ).toHaveCount(4);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(
    page.locator(".presentation-canvas .presentation-element"),
  ).toHaveCount(5);
  await save(page);
});
test("双窗口冲突保留本地草稿并可另存副本", async ({ page, context }) => {
  await create(page);
  const url = page.url();
  const second = await context.newPage();
  await second.goto(url);
  await expect(second.getByLabel("文稿名称", { exact: true })).toBeVisible();
  await page.getByLabel("文稿名称", { exact: true }).fill("服务器版本");
  await save(page);
  await second.getByLabel("文稿名称", { exact: true }).fill("本地副本内容");
  await second.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(
    second.getByText("文稿已在其他窗口更新，本地修改仍保留。"),
  ).toBeVisible();
  await expect(second.getByLabel("文稿名称", { exact: true })).toHaveValue(
    "本地副本内容",
  );
  await second.getByRole("button", { name: "另存为副本", exact: true }).click();
  await expect(second).not.toHaveURL(url);
  await expect(second.getByLabel("文稿名称", { exact: true })).toHaveValue(
    "本地副本内容（副本）",
  );
  await second.close();
});
test("明暗主题、桌面与手机轻编辑没有根级横向溢出", async ({ page }) => {
  await create(page);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    for (const width of [1600, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        page.getByRole("group", { name: "幻灯片画布" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      if (width < 768) {
        await page.getByRole("button", { name: "备注", exact: true }).click();
        await page
          .getByLabel("演示者备注", { exact: true })
          .fill(`手机备注 ${theme} ${width}`);
        await save(page);
        await page.getByRole("button", { name: "幻灯片", exact: true }).click();
      }
    }
  }
});
test("百页结构能够打开", async ({ page }) => {
  await page.goto("/apps/presentation-workshop");
  const deck = newDeck();
  deck.slides = Array.from({ length: 100 }, (_, i) => ({
    id: `page-${i}`,
    background: "#FFFFFF",
    notes: "",
    elements: Array.from({ length: 20 }, (_, j) =>
      newElement("rect", { x: j * 50, y: 100, width: 40, height: 100 }),
    ),
  }));
  const csrf =
    (await page.context().cookies()).find((c) => c.name === "fpl_csrf")
      ?.value ?? "";
  const created = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title: "百页测试", document: deck },
    },
  );
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(
    page.getByRole("button", { name: "幻灯片 100", exact: true }),
  ).toBeAttached();
  await page.getByRole("button", { name: "幻灯片 100", exact: true }).click();
  await expect(
    page.locator(".presentation-canvas .presentation-element"),
  ).toHaveCount(20);
});

test("缩放后的拖动、多选变换、复制粘贴与一次撤销", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await create(page);
  await page.getByRole("button", { name: "插入图形", exact: true }).click();
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const canvas = page.getByRole("group", { name: "幻灯片画布" });
  const shape = canvas.locator("[data-element-id]").last();
  const original = await page.getByLabel("X", { exact: true }).inputValue();
  const box = (await shape.boundingBox())!;
  const scale =
    box.width /
    Number(await page.getByLabel("宽度", { exact: true }).inputValue());
  await page.keyboard.down("Alt");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 60 * scale,
    box.y + box.height / 2 + 40 * scale,
    { steps: 10 },
  );
  await page.mouse.up();
  await page.keyboard.up("Alt");
  expect(
    Number(await page.getByLabel("X", { exact: true }).inputValue()),
  ).toBeCloseTo(Number(original) + 60, 0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue(original);
  await page.getByRole("button", { name: "更多编辑工具" }).click();
  await page
    .getByRole("menuitem", { name: "复制所选元素", exact: true })
    .click();
  await page.getByLabel("X", { exact: true }).fill("600");
  const first = canvas.locator("[data-element-id]").nth(3);
  await first.click({ modifiers: ["Shift"] });
  await expect(
    page.getByRole("heading", { name: "2 个元素", exact: true }),
  ).toBeVisible();
  const handle = canvas.locator('[data-resize="se"]');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 30, hb.y + hb.height / 2 + 20, {
    steps: 5,
  });
  await page.mouse.up();
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(canvas.locator("[data-element-id]")).toHaveCount(7);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(canvas.locator("[data-element-id]")).toHaveCount(5);
  await save(page);
});

test("保存失败重试与输入法期间的快捷键隔离", async ({ page }) => {
  await create(page);
  let reject = true;
  await page.route("**/v1/presentation-workshop/projects/*", async (route) => {
    if (route.request().method() === "PUT" && reject) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({ detail: "测试保存失败" }),
      });
    } else await route.continue();
  });
  await page.getByLabel("演示者备注", { exact: true }).fill("断网时保留的备注");
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("保存失败");
  reject = false;
  await save(page);
  const canvas = page.getByRole("group", { name: "幻灯片画布" });
  await canvas.getByText("让想法，被看见", { exact: true }).dblclick();
  const editor = page.getByRole("textbox", { name: "编辑幻灯片文字" });
  await editor.dispatchEvent("compositionstart", { data: "中" });
  await editor.dispatchEvent("keydown", {
    key: "Backspace",
    isComposing: true,
  });
  await expect(canvas.locator("[data-element-id]")).toHaveCount(3);
  await editor.dispatchEvent("compositionend", { data: "中文" });
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByLabel("演示者备注", { exact: true })).toHaveValue(
    "断网时保留的备注",
  );
});

test("只读工作区可以浏览放映，编辑入口隐藏", async ({ page }) => {
  await create(page);
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const principal = await response.json();
    principal.workspace.permission_keys = ["content.read", "files.read"];
    await route.fulfill({ response, json: principal });
  });
  await page.reload();
  await expect(page.getByLabel("文稿名称", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(
    page.getByRole("button", { name: "新建幻灯片", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("演示者备注", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(
    page.getByRole("button", { name: "导出 PPTX", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "从头放映", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "幻灯片放映" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("图片上传失败保留原文稿，文件选择可以重试", async ({ page }) => {
  await create(page);
  await page.route("**/v1/files", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({ detail: "测试上传失败" }),
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "上传图片", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "image.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByText("测试上传失败", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "上传图片", exact: true }),
  ).toBeEnabled();
  await expect(
    page.locator(".presentation-canvas [data-element-id]"),
  ).toHaveCount(3);
});
