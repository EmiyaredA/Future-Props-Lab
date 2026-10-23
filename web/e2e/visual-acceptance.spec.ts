import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import {
  acceptanceProject,
  acceptanceScreens,
  simulatedInspection,
} from "./node-acceptance-fixture";

test("固定只读模板、节点验收、人工确认和汇总跳转", async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const project = await acceptanceProject(page);
  await project.add();
  const canvas = await (
    await page.request.get(`${project.base}/canvas`)
  ).json();
  const adopted = await page.request.put(
    `${project.base}/nodes/shot/final-output`,
    {
      headers: project.headers,
      data: {
        expected_revision: canvas.revision,
        output_id: project.output.id,
      },
    },
  );
  expect(adopted.ok()).toBeTruthy();

  await simulatedInspection(page, project.base, project.character);
  await page.goto(`/apps/visual-workshop/projects/${project.id}/canvas`);
  await page.getByRole("button", { name: "项目验收", exact: true }).click();
  await expect(page.getByText("只读", { exact: true })).toBeVisible();
  await expect(page.locator(".acceptance-fixed-scheme")).toHaveCount(3);
  await expect(
    page.getByRole("button", {
      name: /使用模板并配置|从空白开始|新增模板|更换连接/,
    }),
  ).toHaveCount(0);
  for (const width of [390, 768, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBeTruthy();
  }
  await page.screenshot({
    path: resolve(acceptanceScreens, "templates.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.screenshot({
    path: resolve(acceptanceScreens, "templates-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await page.getByRole("button", { name: "验收汇总", exact: true }).click();
  await page.getByRole("button", { name: "打开节点", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "节点验收", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("combobox", { name: "选择验收方案" }),
  ).toBeEnabled();
  await page.getByRole("combobox", { name: "选择验收方案" }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("option", { name: /模型 API 方案/ }).click();
  await expect(page.getByText("资料已就绪", { exact: false })).toBeVisible();
  await expect(page.getByText("来自节点已保存的生成设置")).toBeVisible();
  for (const width of [390, 768, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBeTruthy();
  }
  const version = page
    .locator(".board-output-panel.is-acceptance .board-version-select")
    .first();
  await expect
    .poll(async () => (await version.boundingBox())?.width ?? 0)
    .toBeGreaterThan(250);
  await expect
    .poll(async () => (await version.boundingBox())?.height ?? 1000)
    .toBeLessThan(100);
  await page.screenshot({
    path: resolve(acceptanceScreens, "node.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "开始验收 v2", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "逐项验收结果" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "节点验收", exact: true })
      .getByRole("button", { name: "设为最终输出", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /角色外观一致 AI 辅助/ }).click();
  await page.getByRole("button", { name: "确认通过", exact: true }).click();
  await page.getByRole("button", { name: /动作与道具 AI 辅助/ }).click();
  await page.getByLabel("判断说明").fill("道具接触异常");
  await page.getByRole("button", { name: "需修改", exact: true }).click();
  await page.getByRole("button", { name: "返修草稿", exact: true }).click();
  await expect(page.getByLabel("返修提示词")).toHaveValue(/道具接触异常/);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: /动作连贯与节奏 人工确认/ }).click();
  await page.getByRole("button", { name: "确认通过", exact: true }).click();
  await page
    .getByRole("button", { name: "确认整体验收结论", exact: true })
    .click();
  await page.screenshot({
    path: resolve(acceptanceScreens, "report.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "项目验收", exact: true }).click();
  await page.getByRole("button", { name: "验收汇总", exact: true }).click();
  await expect(
    page.locator(".acceptance-summary-table tbody tr").first(),
  ).toContainText("需修改");
  await expect(page.locator(".acceptance-summary-detail video")).toHaveCount(3);
  await expect(
    page
      .locator(".acceptance-summary-detail .acceptance-summary-media video")
      .first(),
  ).toHaveJSProperty("readyState", 4);
  for (const width of [390, 768, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBeTruthy();
  }
  await expect(page.locator("header:visible")).toHaveCount(1);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: resolve(acceptanceScreens, "summary.png"),
    fullPage: false,
  });
  await page.getByRole("button", { name: "打开节点", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "查看验收结果", exact: true }),
  ).toBeVisible();
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});
