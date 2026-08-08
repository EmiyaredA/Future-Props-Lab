import { expect, test } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("真实前后端可通过 UI 创建视觉项目并上传项目图片", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apps/visual-workshop");
  await page.getByRole("button", { name: "新建项目" }).click();
  await expect(page).toHaveURL(
    /\/apps\/visual-workshop\/projects\/[^/]+\/canvas$/,
  );

  await page.getByRole("button", { name: "素材库" }).click();
  await page.getByRole("button", { name: "管理素材" }).click();
  await expect(page.getByRole("heading", { name: "项目素材库" })).toBeVisible();

  await page.getByLabel("选择要上传的文件").setInputFiles({
    name: "真实烟测.png",
    mimeType: "image/png",
    buffer: PNG,
  });

  await expect(page.getByText("真实烟测.png").first()).toBeVisible();
  await expect(page.getByText("已成功上传 1 个文件")).toBeVisible();
});
