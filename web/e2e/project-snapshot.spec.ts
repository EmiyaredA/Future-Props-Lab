import { expect, test } from "@playwright/test";

test("导出视觉项目快照、导入副本并打开项目文件夹", async ({ page }) => {
  const title = `快照旅程-${Date.now()}`;
  await page.goto("/apps/visual-workshop");
  await page.getByRole("button", { name: "新建项目" }).click();
  await expect(page).toHaveURL(
    /\/apps\/visual-workshop\/projects\/[^/]+\/canvas$/,
  );

  await page.goto("/apps/visual-workshop");
  await page.getByRole("button", { name: "重命名" }).first().click();
  const name = page.getByLabel("项目名称");
  await name.fill(title);
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: `导出“${title}”项目快照` }).click();
  const download = await downloadPromise;
  const snapshotPath = await download.path();
  expect(snapshotPath).toBeTruthy();

  await page.getByLabel("选择项目快照压缩包").setInputFiles(snapshotPath!);
  await expect(page).toHaveURL(
    /\/apps\/visual-workshop\/projects\/[^/]+\/canvas$/,
  );

  await page.goto("/apps/visual-workshop");
  const copyTitle = `${title}（副本）`;
  await expect(page.getByText(copyTitle, { exact: true })).toBeVisible();
  let opened = false;
  await page.route("**/open-folder", async (route) => {
    opened = true;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ opened: true }),
    });
  });
  await page
    .getByRole("button", { name: `打开“${copyTitle}”项目文件夹` })
    .click();
  await expect.poll(() => opened).toBe(true);
});
