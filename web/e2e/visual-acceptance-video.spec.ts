import { expect, test } from "@playwright/test";
import {
  acceptanceProject,
  simulatedInspection,
} from "./node-acceptance-fixture";

test("复验选择另一个输出版本并保留原验收记录", async ({ page }) => {
  test.setTimeout(90000);
  const p = await acceptanceProject(page);
  const records = await simulatedInspection(page, p.base, p.character);
  await page.goto(`/apps/visual-workshop/projects/${p.id}/canvas`);
  await page.getByRole("button", { name: "项目验收", exact: true }).click();
  await page.getByRole("button", { name: "验收汇总", exact: true }).click();
  await page.getByRole("button", { name: "打开节点", exact: true }).click();
  await page.getByRole("combobox", { name: "选择验收方案" }).click();
  await page.getByRole("option", { name: /模型 API 方案/ }).click();
  await page.getByRole("button", { name: "开始验收 v1", exact: true }).click();
  await page
    .getByRole("button", { name: "选择返修版本复验", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "开始复验 v1", exact: true }),
  ).toBeDisabled();
  await p.add();
  await page.reload();
  await page.getByRole("button", { name: "项目验收", exact: true }).click();
  await page.getByRole("button", { name: "验收汇总", exact: true }).click();
  await page.getByRole("button", { name: "打开节点", exact: true }).click();
  await page.getByRole("button", { name: "查看历史", exact: true }).click();
  await page.getByRole("button", { name: /输出 v1 · 待确认/ }).click();
  await page
    .getByRole("button", { name: "选择返修版本复验", exact: true })
    .click();
  await page.getByRole("button", { name: "开始复验 v2", exact: true }).click();
  await expect(page.getByText("v1 → v2 复验", { exact: false })).toBeVisible();
  expect(records()).toHaveLength(2);
  expect(records()[0].previous_run_id).toBe(records()[1].id);
});
