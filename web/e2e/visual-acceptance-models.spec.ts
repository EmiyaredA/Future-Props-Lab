import { expect, test } from "@playwright/test";
import {
  acceptanceProject,
  simulatedInspection,
} from "./node-acceptance-fixture";

test("固定方案以图标、名称、调用标识和状态展示，支持键盘选择", async ({
  page,
}) => {
  test.setTimeout(90000);
  const p = await acceptanceProject(page);
  await simulatedInspection(page, p.base, p.character);
  await page.goto(`/apps/visual-workshop/projects/${p.id}/canvas`);
  await page.getByRole("button", { name: "项目验收", exact: true }).click();
  await expect(page.locator(".acceptance-connection").first()).toContainText(
    "fake-vision-v1",
  );
  await page.getByRole("button", { name: "验收汇总", exact: true }).click();
  await page.getByRole("button", { name: "打开节点", exact: true }).click();
  const picker = page.getByRole("combobox", { name: "选择验收方案" });
  await expect(picker).toBeEnabled();
  await picker.focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("option", { name: /模型 API 方案/ }),
  ).toContainText("fake-vision-v1");
  await expect(
    page.getByRole("option", { name: /模型 API 方案/ }).locator("svg"),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(picker).toContainText("模型 API 方案");
  await expect(page.locator(".node-fixed-connection")).toContainText(
    "固定接入",
  );
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});
