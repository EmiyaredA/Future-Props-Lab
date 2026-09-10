import { test, expect, type Page } from "@playwright/test";
import {
  newDeck,
  newElement,
  defaultRun,
} from "../src/features/presentation-workshop/templates";
const mono =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#D26545" d="M50 4 L96 32 L96 76 L50 98 L4 76 L4 32 Z"/><path fill="#D26545" d="M20 40 L80 40 L50 80 Z"/></svg>';
const multi =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><defs><linearGradient id="g"><stop stop-color="#DE7752"/><stop offset="1" stop-color="#687CDF"/></linearGradient></defs><rect x="2" y="2" width="156" height="96" rx="20" fill="url(#g)"/><circle cx="80" cy="50" r="24" fill="#FFFFFF"/></svg>';
async function setup(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 480;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 800, 480);
    g.addColorStop(0, "#E9C8B1");
    g.addColorStop(1, "#677A92");
    x.fillStyle = g;
    x.fillRect(0, 0, 800, 480);
    x.fillStyle = "#F7E5C7";
    x.beginPath();
    x.arc(570, 140, 65, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "#354F63";
    x.beginPath();
    x.moveTo(0, 400);
    x.lineTo(250, 140);
    x.lineTo(560, 480);
    x.lineTo(0, 480);
    x.fill();
    x.fillStyle = "#869A91";
    x.beginPath();
    x.moveTo(300, 480);
    x.lineTo(590, 230);
    x.lineTo(800, 420);
    x.lineTo(800, 480);
    x.fill();
    return c.toDataURL("image/png").split(",")[1];
  });
  const image = await page.request.post("/v1/files", {
    headers,
    multipart: {
      upload: {
        name: "山色.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      },
    },
  });
  expect(image.ok()).toBeTruthy();
  const asset = await image.json();
  const document = newDeck("blank");
  document.slides[0].background = "#FAF8F4";
  document.slides[0].elements = [
    newElement("text", {
      id: "heading",
      x: 75,
      y: 55,
      width: 1050,
      height: 65,
      paragraphs: [
        {
          align: "left",
          bullet: false,
          line_height: 1.2,
          runs: [
            {
              ...defaultRun(),
              text: "图像与矢量素材",
              color: "#253646",
              size: 38,
              bold: true,
            },
          ],
        },
      ],
    }),
    newElement("image", {
      id: "photo",
      asset_id: asset.id,
      x: 100,
      y: 300,
      width: 500,
      height: 300,
    }),
    newElement("roundRect", {
      id: "badge",
      x: 800,
      y: 400,
      width: 240,
      height: 140,
      fill: "#F1DCD0",
      corner_radius: 24,
    }),
  ];
  const created = await page.request.post(
    "/v1/presentation-workshop/projects",
    { headers, data: { title: "图片 · 图形 · SVG 验收", document } },
  );
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(
    page.locator('.presentation-canvas [data-element-id="photo"] img'),
  ).toBeVisible();
  return { project, headers, png, asset };
}
const photo = (page: Page) =>
  page.locator('.presentation-canvas [data-element-id="photo"]');

test("图片外观、预览、更换取消及裁剪提交撤销", async ({ page }, info) => {
  const { project, png } = await setup(page);
  await photo(page).click();
  await page.screenshot({ path: info.outputPath("01-image-toolbar.png") });
  await page.getByRole("button", { name: "水平翻转", exact: true }).click();
  await expect(photo(page).locator(".presentation-image-clip")).toHaveCSS(
    "transform",
    "matrix(-1, 0, 0, 1, 0, 0)",
  );
  const inspector = page.getByRole("complementary", { name: "格式面板" });
  await inspector
    .getByRole("spinbutton", { name: "图片圆角", exact: true })
    .fill("24");
  await inspector
    .getByRole("spinbutton", { name: "整体不透明度（%）", exact: true })
    .fill("75");
  await inspector
    .getByRole("button", { name: "图片边框", exact: true })
    .click();
  await inspector.getByLabel("图片边框宽度", { exact: true }).fill("3");
  await expect(photo(page).locator(".presentation-image-clip")).toHaveCSS(
    "outline-width",
    "3px",
  );
  await page.getByRole("button", { name: "预览原图", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "原图预览" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "更换素材", exact: true }).click();
  await page.getByRole("button", { name: "关闭图片选择" }).click();
  await expect(photo(page)).toBeVisible();
  await page.getByRole("button", { name: "裁剪图片", exact: true }).click();
  await expect(
    page.getByRole("toolbar", { name: "图片裁剪工具栏" }),
  ).toBeVisible();
  await page.getByLabel("裁剪比例", { exact: true }).click();
  await page.getByRole("option", { name: "1:1", exact: true }).click();
  await page.screenshot({ path: info.outputPath("02-image-crop.png") });
  await page.getByRole("button", { name: "完成裁剪" }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    inspector.getByRole("spinbutton", { name: "高度", exact: true }),
  ).toHaveValue("300");
  await page.getByRole("button", { name: "更换素材", exact: true }).click();
  await page.getByRole("tab", { name: "上传图片", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "新山色.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(
    page.getByRole("dialog", { name: "选择文件库图片" }),
  ).toBeHidden();
  await expect(
    inspector.getByRole("spinbutton", { name: "图片圆角", exact: true }),
  ).toHaveValue("24");
  await expect(
    inspector.getByRole("spinbutton", {
      name: "整体不透明度（%）",
      exact: true,
    }),
  ).toHaveValue("75");
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  await page.reload();
  await photo(page).click();
  await expect(
    inspector.getByRole("spinbutton", { name: "图片圆角", exact: true }),
  ).toHaveValue("24");
  const stored = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  expect(
    stored.document.slides[0].elements.find(
      (e: { id: string }) => e.id === "photo",
    ).flip_x,
  ).toBe(true);
  expect(
    stored.document.slides[0].elements.find(
      (e: { id: string }) => e.id === "photo",
    ).image_border,
  ).toBe(true);
});

test("形状与图标分类、SVG 代码导入、改色与真实矢量导出", async ({
  page,
}, info) => {
  const { project, headers } = await setup(page);
  await page.getByRole("button", { name: "插入图形", exact: true }).click();
  await page.screenshot({ path: info.outputPath("03-shapes.png") });
  await page.getByRole("button", { name: "五边形", exact: true }).click();
  await page.getByRole("button", { name: "插入图形", exact: true }).click();
  await page.getByRole("tab", { name: "图标", exact: true }).click();
  await page.getByRole("button", { name: "科技", exact: true }).click();
  await page.screenshot({ path: info.outputPath("04-icons.png") });
  await page.getByRole("textbox", { name: "搜索图标" }).fill("机器人");
  await page.getByRole("button", { name: /插入图标 机器人/ }).click();
  await expect(
    page.getByRole("dialog", { name: "选择文件库图片" }),
  ).toBeHidden();
  await expect(
    page
      .getByRole("complementary", { name: "格式面板" })
      .getByLabel("图标颜色", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "插入图形", exact: true }).click();
  await page.getByRole("button", { name: "关闭图形面板" }).click();
  await page.getByLabel("图标颜色", { exact: true }).click();
  await page.getByRole("button", { name: "选择颜色 #7586E5" }).click();
  await expect(
    page.locator(
      '.presentation-canvas [data-element-id] span[style*="mask-image"]',
    ),
  ).toHaveCSS("background-color", "rgb(117, 134, 229)");
  await page.getByRole("button", { name: "插入图形", exact: true }).click();
  await page.getByRole("button", { name: "导入自定义 SVG" }).click();
  await page.getByRole("textbox", { name: "SVG 代码" }).fill(multi);
  await page.getByRole("button", { name: "检查并预览" }).click();
  await expect(page.getByAltText("SVG 导入预览")).toBeVisible();
  await page.screenshot({ path: info.outputPath("05-svg-import.png") });
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(
    page.getByRole("dialog", { name: "选择文件库图片" }),
  ).toBeHidden();
  await expect(
    page
      .getByRole("complementary", { name: "格式面板" })
      .getByText("保留 SVG 原始配色"),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  const fresh = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  let vectors = 0;
  for (const e of fresh.document.slides[0].elements) {
    if (e.id === "photo") Object.assign(e, { y: 230, corner_radius: 24 });
    if (e.id === "badge")
      Object.assign(e, {
        x: 710,
        y: 220,
        width: 170,
        height: 160,
        fill: "#F1DCD0",
        stroke_width: 0,
      });
    if (e.kind === "pentagon")
      Object.assign(e, {
        x: 950,
        y: 220,
        width: 170,
        height: 160,
        fill: "#91A9A0",
        stroke_width: 0,
      });
    if (e.kind === "vector")
      Object.assign(e, {
        x: vectors++ === 0 ? 730 : 950,
        y: 440,
        width: 160,
        height: 130,
      });
  }
  const updated = await page.request.put(
    `/v1/presentation-workshop/projects/${project.id}`,
    {
      headers,
      data: {
        title: "图片与矢量素材 · 验收文稿",
        document: fresh.document,
        expected_revision: fresh.revision,
      },
    },
  );
  expect(updated.ok()).toBeTruthy();
  await page.reload();
  await expect(
    page.locator(".presentation-canvas [data-element-id]"),
  ).toHaveCount(6);
  await page.screenshot({ path: info.outputPath("06-acceptance-deck.png") });
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PPTX", exact: true }).click();
  const file = await pending;
  await file.saveAs(info.outputPath("素材验收.pptx"));
  const stored = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  expect(
    stored.document.slides[0].elements.filter(
      (e: { kind: string }) => e.kind === "vector",
    ),
  ).toHaveLength(2);
  expect(
    stored.document.slides[0].elements.some(
      (e: { kind: string }) => e.kind === "pentagon",
    ),
  ).toBe(true);
});

test("SVG 文件导入与非法代码，明暗主题及手机面板", async ({ page }, info) => {
  await setup(page);
  await page.getByRole("button", { name: "插入图形", exact: true }).click();
  await page.getByRole("button", { name: "导入自定义 SVG" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "自定义.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(mono),
  });
  await page.getByRole("button", { name: "检查并预览" }).click();
  await expect(page.getByText(/单色，可改色/)).toBeVisible();
  await page
    .getByRole("textbox", { name: "SVG 代码" })
    .fill('<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>');
  await page.getByRole("button", { name: "检查并预览" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "关闭图片选择" }).click();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((v) => {
      document.documentElement.dataset.theme = v;
    }, theme);
    for (const width of [1600, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 768)
        await page
          .getByRole("button", { name: "文字与格式", exact: true })
          .click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width === 1600)
        await page.screenshot({ path: info.outputPath(`media-${theme}.png`) });
    }
  }
});

test("替换失败保留原图、取消裁剪、SVG 拖入和缩放定位", async ({ page }) => {
  const { png } = await setup(page);
  await photo(page).click();
  const original = await photo(page).locator("img").getAttribute("src");
  await page.getByRole("button", { name: "更换素材", exact: true }).click();
  await page.getByRole("tab", { name: "上传图片", exact: true }).click();
  await page.route("**/v1/files", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "上传失败" }),
      });
    else await route.continue();
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "失败.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "关闭图片选择" }).click();
  await expect(photo(page).locator("img")).toHaveAttribute("src", original!);
  await page.unroute("**/v1/files");
  await page.getByRole("button", { name: "裁剪图片", exact: true }).click();
  await page.getByLabel("裁剪比例", { exact: true }).click();
  await page.getByRole("option", { name: "1:1", exact: true }).click();
  const handle = page.getByLabel("裁剪边缘 e", { exact: true });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 30, box.y);
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("spinbutton", { name: "宽度", exact: true }),
  ).toHaveValue("500");
  for (const zoom of [25, 75, 200]) {
    await page.getByRole("slider", { name: "画布缩放" }).fill(String(zoom));
    await photo(page).click();
    const toolbar = page.getByRole("toolbar", { name: "所选元素工具栏" });
    await expect(toolbar).toBeVisible();
    const area = (await page
        .locator(".presentation-canvas-area")
        .boundingBox())!,
      bar = (await toolbar.boundingBox())!;
    expect(bar.x).toBeGreaterThanOrEqual(area.x + 7);
    expect(bar.x + bar.width).toBeLessThanOrEqual(area.x + area.width - 7);
  }
  const transfer = await page.evaluateHandle((source) => {
    const d = new DataTransfer();
    d.items.add(new File([source], "拖入.svg", { type: "image/svg+xml" }));
    return d;
  }, mono);
  await page
    .locator(".presentation-editor")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByRole("textbox", { name: "SVG 代码" })).toHaveValue(
    mono,
  );
  await page.getByRole("button", { name: "检查并预览" }).click();
  await expect(page.getByAltText("SVG 导入预览")).toBeVisible();
});
