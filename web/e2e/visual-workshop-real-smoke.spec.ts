import { proofStep } from "./proof-checkpoint";
import { expect, test } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("真实前后端可通过 UI 创建视觉项目并上传项目图片", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await test.step("创建视觉项目并进入画布", async () => {
    await page.goto("/apps/visual-workshop");
    await page.getByRole("button", { name: "新建项目" }).click();
    await expect(page).toHaveURL(
      /\/apps\/visual-workshop\/projects\/[^/]+\/canvas$/,
    );
  });
  await page.getByRole("button", { name: "素材库" }).click();
  await expect(
    page.getByRole("complementary", { name: "项目素材库" }),
  ).toBeVisible();

  const uploadedAsset = page.getByRole("button", { name: /预览.*真实烟测/ });
  await proofStep(
    info,
    "上传项目图片",
    "素材库显示已上传的图片和成功提示。",
    async () => {
      await page.getByLabel("选择要上传的文件").setInputFiles({
        name: "真实烟测.png",
        mimeType: "image/png",
        buffer: PNG,
      });
      await expect(uploadedAsset).toBeVisible();
      await expect(uploadedAsset).toContainText("真实烟测");
      await expect(uploadedAsset).toContainText(/图片/);
      await expect(page.getByText(/已成功上传|已上传/)).toBeVisible();
      await info.attach("上传成功的项目素材", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    },
  );

  await proofStep(
    info,
    "刷新画布，确认素材已持久化",
    "刷新后在同一项目素材库中仍可找到图片。",
    async () => {
      await page.reload();
      const library = page.getByRole("complementary", { name: "项目素材库" });
      if (!(await library.isVisible())) {
        await page.getByRole("button", { name: "素材库" }).click();
      }
      await expect(uploadedAsset).toBeVisible();
      await info.attach("刷新后的项目素材库", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    },
  );
});
