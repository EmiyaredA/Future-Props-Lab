import { expect, test } from "@playwright/test";

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("builds a deterministic image, black-card, and title edit", async ({
  page,
}) => {
  await page.goto("/apps/video-editor");
  await page.getByRole("button", { name: "新建剪辑" }).click();
  await expect(page.getByText("视频剪辑工坊 · revision")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  const asset = page.locator(".ve-asset", { hasText: "pixel" });
  await expect(asset.getByText("image")).toBeVisible({ timeout: 15_000 });
  await asset.dblclick();
  await expect(page.locator(".ve-clip.image")).toHaveCount(1);

  await page.locator(".ve-ruler").click({ position: { x: 160, y: 10 } });
  await page.locator(".ve-clip.image").click();
  await page.getByRole("button", { name: "分割" }).click();
  await expect(page.locator(".ve-clip.image")).toHaveCount(2);
  await page.locator(".ve-clip.image").nth(1).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();

  await page.getByRole("button", { name: "纯色黑幕" }).click();
  await expect(page.locator(".ve-clip.color")).toHaveCount(1);
  await page.locator(".ve-ruler").click({ position: { x: 400, y: 10 } });
  await page.getByRole("button", { name: "文字卡" }).click();
  await expect(page.locator(".ve-clip.text")).toHaveCount(1);

  await page.getByRole("button", { name: "导出视频" }).click();
  await page.locator(".ve-preset-grid button").first().click();
  await page.getByRole("button", { name: "运行预检" }).click();
  await expect(page.getByText(/预检通过/)).toBeVisible();
  await page.getByRole("button", { name: "开始确定性渲染" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});
