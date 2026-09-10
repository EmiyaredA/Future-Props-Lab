import { expect, test, type Locator, type Page } from "@playwright/test";
import { newDocument, saveNote } from "./thought-helpers";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGN8Wh3JQApgIkk1w6gG4gATkergYFQDMYDkUAIAeAUB2WkfhqEAAAAASUVORK5CYII=",
  "base64",
);

async function setup(page: Page, count = 1) {
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await prose.fill("图片操作检查：选中图片后显示紧凑工具栏。");
  await prose.press("End");
  await prose.press("Enter");
  await page
    .locator('.thought-rich-editor input[accept^="image/"]')
    .setInputFiles(
      Array.from({ length: count }, (_, i) => ({
        name: `image-${i}.png`,
        mimeType: "image/png",
        buffer: png,
      })),
    );
  const images = prose.locator(".thought-image-frame");
  await expect(images).toHaveCount(count);
  return {
    prose,
    images,
    toolbar: page.getByRole("toolbar", { name: "图片操作" }),
  };
}

async function expectOutside(page: Page, image: Locator, toolbar: Locator) {
  await expect(toolbar).toBeVisible();
  await expect(async () => {
    const frame = (await image.boundingBox())!;
    const bar = (await toolbar.boundingBox())!;
    expect(
      bar.y + bar.height <= frame.y - 7 || bar.y >= frame.y + frame.height + 7,
      JSON.stringify({ frame, bar }),
    ).toBe(true);
    expect(bar.x).toBeGreaterThanOrEqual(12);
    expect(bar.x + bar.width).toBeLessThanOrEqual(
      page.viewportSize()!.width - 12,
    );
    expect(bar.height).toBeLessThanOrEqual(48);
  }).toPass({ timeout: 5000 });
}

async function setWidth(page: Page, value: string) {
  await page.getByRole("button", { name: "图片设置", exact: true }).click();
  const input = page.getByLabel("图片宽度", { exact: true });
  await input.fill(value);
  await input.press("Enter");
  await input.press("Escape");
}

test("image toolbar and settings stay compact across sizes, alignments and themes", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const { prose, images, toolbar } = await setup(page);
  const image = images.first();
  for (const viewport of [1600, 390, 320]) {
    await page.setViewportSize({ width: viewport, height: 1100 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.getByLabel("笔记标题", { exact: true }).click();
      await image.hover();
      await expect(toolbar).toHaveCount(0);
      await image.click();
      await expect(page.getByRole("dialog", { name: "图片设置" })).toHaveCount(
        0,
      );
      for (const width of ["178", "720"]) {
        await setWidth(page, width);
        for (const label of ["图片左对齐", "图片居中", "图片右对齐"]) {
          await toolbar
            .getByRole("button", { name: label, exact: true })
            .click();
          await expectOutside(page, image, toolbar);
          const originalHeight = (await prose.boundingBox())!.height;
          const originalImage = (await image.boundingBox())!;
          await toolbar
            .getByRole("button", { name: "图片设置", exact: true })
            .click();
          const settings = page.getByRole("dialog", { name: "图片设置" });
          await expect(settings).toBeVisible();
          const panel = (await settings.boundingBox())!;
          expect(panel.width).toBeLessThanOrEqual(280);
          expect(panel.x).toBeGreaterThanOrEqual(12);
          expect(panel.x + panel.width).toBeLessThanOrEqual(viewport - 12);
          expect((await prose.boundingBox())!.height).toBe(originalHeight);
          expect((await image.boundingBox())!.y).toBe(originalImage.y);
          if (width === "178" && label === "图片居中" && viewport !== 320) {
            await page.screenshot({
              path: testInfo.outputPath(`settings-${viewport}-${theme}.png`),
            });
          }
          await page.keyboard.press("Escape");
          await expect(
            toolbar.getByRole("button", { name: "图片设置", exact: true }),
          ).toBeFocused();
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("image editing preserves selection, keyboard access, crops and persisted attributes", async ({
  page,
}) => {
  const { prose, images, toolbar } = await setup(page, 2);
  const first = images.first();
  await first.click();
  await page.keyboard.press("Tab");
  await expect(
    toolbar.getByRole("button", { name: "裁剪", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  const width = page.getByLabel("图片宽度", { exact: true });
  await expect(width).toBeFocused();
  await width.fill("");
  await expect(first).toHaveCSS("width", "480px");
  await width.fill("178");
  await width.press("Tab");
  await expect(first).toHaveCSS("width", "178px");
  await page.getByLabel("图片替代文字", { exact: true }).fill("图片替代说明");
  await page.getByLabel("图片图注", { exact: true }).fill("保存后的图注");
  await page.keyboard.press("Escape");
  await toolbar.getByRole("button", { name: "裁剪", exact: true }).click();
  const crop = page.getByRole("dialog", { name: "裁剪图片", exact: true });
  await expect(crop).toBeVisible();
  await expect(toolbar).toBeHidden();
  await crop.getByRole("button", { name: "16:9", exact: true }).click();
  await crop.getByRole("button", { name: "应用裁剪", exact: true }).click();
  await expect(first.locator(".thought-image-crop-viewport")).toBeVisible();
  await expectOutside(page, first, toolbar);
  await expect(
    toolbar.getByRole("button", { name: "裁剪", exact: true }),
  ).toBeFocused();
  await toolbar.getByRole("button", { name: "重置裁剪", exact: true }).click();
  await expect(first.locator(".thought-image-crop-viewport")).toHaveCount(0);
  await expect(
    toolbar.getByRole("button", { name: "重置裁剪", exact: true }),
  ).toBeDisabled();
  await toolbar.getByRole("button", { name: "图片设置", exact: true }).click();
  await images.nth(1).click();
  await expect(page.getByRole("dialog", { name: "图片设置" })).toHaveCount(0);
  await expect(toolbar).toHaveCount(1);
  await expectOutside(page, images.nth(1), toolbar);
  await page.keyboard.press("Escape");
  await expect(toolbar).toHaveCount(0);
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(prose.getByText("保存后的图注", { exact: true })).toBeVisible();
  await expect(first.locator("img")).toHaveAttribute("alt", "图片替代说明");
  await expect(first).toHaveCSS("width", "178px");
});

test("image toolbar follows resizing and scrolling without covering the image", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { prose, images, toolbar } = await setup(page);
  const image = images.first();
  await prose
    .locator("p")
    .last()
    .fill("后续正文，用于检查滚动边界。".repeat(500));
  await image.click();
  await setWidth(page, "720");
  await expectOutside(page, image, toolbar);
  const handle = prose.getByRole("button", {
    name: "从右下角拖动调整图片宽度",
  });
  await handle.scrollIntoViewIfNeeded();
  const corner = (await handle.boundingBox())!;
  await page.mouse.move(corner.x + 6, corner.y + 6);
  await page.mouse.down();
  await page.mouse.move(corner.x - 150, corner.y + 6, { steps: 4 });
  await page.mouse.up();
  await expect(image).toHaveCSS("width", "564px");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectOutside(page, image, toolbar);
  // The top leaves the viewport, so the toolbar can flip below the image.
  await image.evaluate((element) =>
    window.scrollBy(0, element.getBoundingClientRect().top + 10),
  );
  await expectOutside(page, image, toolbar);
  await image.evaluate((element) =>
    window.scrollBy(0, element.getBoundingClientRect().bottom + 12),
  );
  await expect(toolbar).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectOutside(page, image, toolbar);
});
