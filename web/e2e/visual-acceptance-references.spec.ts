import { expect, test } from "@playwright/test";
import { acceptanceProject } from "./node-acceptance-fixture";

test("缺少资料时从节点验收返回生成设置，画布与看板共用入口", async ({
  page,
}) => {
  test.setTimeout(90000);
  const p = await acceptanceProject(page, false);
  await page.goto(`/apps/visual-workshop/projects/${p.id}/canvas`);
  await page.getByRole("button", { name: "项目验收", exact: true }).click();
  await page.getByRole("button", { name: "验收汇总", exact: true }).click();
  await page.getByRole("button", { name: "打开节点", exact: true }).click();
  await expect(page.getByText(/缺少角色基准图/)).toBeVisible();
  await expect(page.getByText(/缺少原动作视频/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开始验收 v1", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "返回生成设置", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "生成设置", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "节点验收", exact: true }).click();
  await expect(page.getByText(/缺少原动作视频/)).toBeVisible();
});
