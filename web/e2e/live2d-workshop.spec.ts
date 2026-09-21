import { expect, test, type Page } from "@playwright/test";
import { characterPsd, maskedPsd } from "./fixtures/live2d-character";

async function countRedPixels(page: Page) {
  const pixels = await page.locator(".l2-pixi canvas").screenshot();
  return page.evaluate(async (base64) => {
    const source = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${base64}`)).blob(),
    );
    const canvas = new OffscreenCanvas(source.width, source.height),
      ctx = canvas.getContext("2d")!;
    ctx.drawImage(source, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] > 100 && data[i] > data[i + 1] * 1.25) count++;
    source.close();
    return count;
  }, pixels.toString("base64"));
}

test("authors a character keyform, animates it, saves and exports separate sequences", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto("/apps");
  await page.getByText("Live2D 工坊", { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "角色项目" })).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({
    path: testInfo.outputPath("01-projects.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "新建角色", exact: true }).click();
  await page.getByLabel("项目名称").fill("Amadeus 角色验收");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(page.locator(".l2-editor")).toBeVisible({ timeout: 30_000 });
  await page.locator('input[type="file"]').setInputFiles({
    name: "Amadeus.psd",
    mimeType: "image/vnd.adobe.photoshop",
    buffer: characterPsd(),
  });
  await expect(page.locator(".l2-tree-name")).toHaveCount(6, {
    timeout: 30_000,
  });
  await expect(page.locator(".l2-pixi canvas")).toBeVisible();
  await page.getByRole("button", { name: "折叠角色图层", exact: true }).click();
  await expect(page.locator(".l2-tree-name")).toHaveCount(0);
  await page.getByRole("button", { name: "展开角色图层", exact: true }).click();
  await expect(page.locator(".l2-tree-name")).toHaveCount(6);
  expect(
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("future-props:before-workspace-switch", {
          cancelable: true,
          detail: () => {},
        }),
      ),
    ),
  ).toBe(false);
  await expect(
    page.getByRole("dialog", { name: "离开角色编辑器？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await page.getByRole("button", { name: "定位选中对象", exact: true }).click();
  await page.getByRole("button", { name: "适应窗口", exact: true }).click();

  await expect
    .poll(() => countRedPixels(page), { timeout: 30_000 })
    .toBeGreaterThan(1000);
  await page.getByRole("button", { name: "旋转", exact: true }).click();
  await expect(page.locator(".l2-tree-name")).toHaveCount(7);
  for (const name of ["白大褂", "红棕发", "脸部", "双眼", "嘴部", "红领带"]) {
    await page.locator(".l2-tree-name").filter({ hasText: name }).click();
    await page.getByRole("button", { name: "父变形器" }).click();
    await page
      .getByRole("menuitem", { name: "旋转变形器", exact: true })
      .click();
  }
  await page.getByRole("button", { name: "曲面", exact: true }).click();
  await page.locator(".l2-tree-name").filter({ hasText: "旋转变形器" }).click();
  await page.getByRole("button", { name: "父变形器" }).click();
  await page.getByRole("menuitem", { name: "曲面变形器", exact: true }).click();
  await page.getByRole("button", { name: "绑定", exact: true }).click();
  await page.locator(".l2-tree-name").filter({ hasText: "嘴部" }).click();
  await page.getByRole("button", { name: "当前参数" }).click();
  await page.getByRole("menuitem", { name: "微笑", exact: true }).click();
  await page.getByLabel("参数值", { exact: true }).fill("1");
  await page.getByLabel("顶点 11", { exact: true }).press("ArrowUp");
  await page.getByLabel("顶点 15", { exact: true }).press("ArrowUp");
  await page
    .locator(".l2-tree-name")
    .filter({ hasText: "旋转变形器" })
    .first()
    .click();
  await page.getByRole("button", { name: "当前参数" }).click();
  await page.getByRole("menuitem", { name: "点头", exact: true }).click();
  await page.getByLabel("参数值", { exact: true }).fill("30");
  await page.getByLabel("旋转角度", { exact: true }).fill("12");
  await expect(
    page.locator(".l2-keyform-row").getByText("30 · 已记录"),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("02-rigging.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "动画", exact: true }).click();
  await page.getByRole("button", { name: "新建动作", exact: true }).click();
  await page.getByLabel("动作名称").fill("微笑并点头");
  await page.getByRole("button", { name: "记录关键帧", exact: true }).click();
  await page.getByLabel("当前帧", { exact: true }).fill("30");
  await page.getByLabel("点头动画值", { exact: true }).press("End");
  await page.getByRole("button", { name: "记录关键帧", exact: true }).click();
  await page.getByLabel("微笑动画值", { exact: true }).press("End");
  await page.getByRole("button", { name: "保存为表情", exact: true }).click();
  await page.getByLabel("表情名称").fill("微笑");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".l2-title")).toContainText("已保存");
  await page.screenshot({
    path: testInfo.outputPath("03-animation.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator(".l2-title")).toContainText("已保存");
  await page.getByRole("button", { name: "动画", exact: true }).click();
  await page.getByRole("button", { name: "动作", exact: true }).click();
  await page.getByRole("menuitem", { name: "微笑并点头", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "点头第30帧", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("button", { name: "裁切方式" }).click();
  await page.getByRole("menuitem", { name: "自定义裁切" }).click();
  await page.getByLabel("裁切宽度", { exact: true }).fill("64");
  await page.getByLabel("裁切高度", { exact: true }).fill("64");
  await page.getByLabel("宽度", { exact: true }).fill("64");
  await page.getByLabel("高度", { exact: true }).fill("64");
  await page.getByLabel("结束帧（不含）", { exact: true }).fill("2");
  await page.getByRole("button", { name: "微笑", exact: true }).click();
  await page.getByRole("button", { name: "微笑并点头", exact: true }).click();
  await page.getByRole("button", { name: "静态", exact: true }).click();
  await expect(page.getByAltText("PNG 实际输出预览")).toBeVisible();
  await expect(page.locator(".l2-export-preview")).toContainText("revision");
  await page.getByRole("button", { name: "导出序列", exact: true }).click();
  await expect(page.locator(".l2-task")).toContainText("已完成", {
    timeout: 60_000,
  });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 ZIP", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("character-frames.zip");
  await page.screenshot({
    path: testInfo.outputPath("04-export.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 720, height: 900 });
  await expect(
    page.getByRole("button", { name: "导出序列", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("imports layered PSD, edits a smile keyform and reports unsupported or damaged files", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/apps/live2d-workshop");
  await page
    .getByRole("button", { name: "新建角色", exact: true })
    .click({ timeout: 30_000 });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(page.locator(".l2-editor")).toBeVisible({ timeout: 30_000 });
  const upload = page.locator('input[type="file"]');
  await upload.setInputFiles({
    name: "unsupported.psd",
    mimeType: "image/vnd.adobe.photoshop",
    buffer: characterPsd(true),
  });
  await expect(page.getByRole("alert")).toContainText("无法还原", {
    timeout: 30_000,
  });
  await expect(page.locator(".l2-tree-name")).toHaveCount(0);
  await upload.setInputFiles({
    name: "broken.psd",
    mimeType: "image/vnd.adobe.photoshop",
    buffer: Buffer.from("broken"),
  });
  await expect(page.getByRole("alert")).toContainText("大小无效");
  await upload.setInputFiles({
    name: "character.psd",
    mimeType: "image/vnd.adobe.photoshop",
    buffer: characterPsd(),
  });
  await expect(page.locator(".l2-tree-name")).toHaveCount(6, {
    timeout: 30_000,
  });
  await expect(page.locator(".l2-canvas-status")).toContainText("256 × 320");
  await page.locator(".l2-tree-name").filter({ hasText: "嘴部" }).click();
  await page.getByRole("button", { name: "绑定", exact: true }).click();
  await page.getByRole("button", { name: "当前参数" }).click();
  await page.getByRole("menuitem", { name: "微笑", exact: true }).click();
  await page.getByLabel("参数值", { exact: true }).fill("1");
  await page.getByLabel("顶点 11", { exact: true }).press("ArrowUp");
  await page.getByLabel("顶点 15", { exact: true }).press("ArrowUp");
  await expect(page.locator(".l2-keyform-row")).toContainText("1 · 已记录");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".l2-title")).toContainText("已保存");
  const id = new URL(page.url()).pathname.split("/")[4];
  const savedDocument = (
    await (
      await page.request.get(`/v1/live2d-workshop/projects/${id}/document`)
    ).json()
  ).document;
  expect(savedDocument.parts.map((p: { group: string }) => p.group)).toEqual(
    Array(6).fill("角色图层"),
  );
  const mouth = savedDocument.parts.find(
    (p: { name: string }) => p.name === "嘴部",
  );
  expect(mouth.x).toBe(110);
  const binding = savedDocument.parameters.find(
    (p: { id: string }) => p.id === "ParamSmile",
  ).bindings[0];
  expect(binding.targetId).toBe(mouth.id);
  expect(
    binding.keys.find((k: { value: number }) => k.value === 1).points,
  ).not.toEqual(
    binding.keys.find((k: { value: number }) => k.value === 0).points,
  );
  await page.setViewportSize({ width: 720, height: 900 });
  await page.getByRole("button", { name: "对象面板", exact: true }).click();
  await page.getByRole("button", { name: "属性面板", exact: true }).click();
  await expect(page.locator(".l2-left")).toBeHidden();
  await expect(page.locator(".l2-right")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("uses texture alpha for hidden mesh masks instead of geometry or red channel", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/apps/live2d-workshop");
  await page
    .getByRole("button", { name: "新建角色", exact: true })
    .click({ timeout: 30_000 });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(page.locator(".l2-editor")).toBeVisible({ timeout: 30_000 });
  await page.locator('input[type="file"]').setInputFiles({
    name: "mask.psd",
    mimeType: "image/vnd.adobe.photoshop",
    buffer: maskedPsd(),
  });
  await expect(page.locator(".l2-tree-name")).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect
    .poll(() => countRedPixels(page), { timeout: 30_000 })
    .toBeGreaterThan(1000);
  const before = await countRedPixels(page);
  await page.locator(".l2-tree-name").filter({ hasText: "红色部件" }).click();
  await page.getByRole("button", { name: "透明度遮罩", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "黑色透明遮罩", exact: true })
    .click();
  await expect
    .poll(async () => Math.abs((await countRedPixels(page)) / before - 0.5))
    .toBeLessThan(0.06);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
