import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";
import { mockInterviewPreparation } from "./fixtures/interview";

async function prepare(page: Page) {
  await page.getByRole("button", { name: "调研并准备", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "资料已就绪", exact: true }),
  ).toBeVisible({ timeout: 8000 });
}
async function enter(page: Page) {
  await page
    .getByRole("button", { name: "检查设备并进入面试", exact: true })
    .click();
  await page
    .getByRole("button", { name: "准备好了，开始面试", exact: true })
    .click();
}
async function noOverflow(page: Page) {
  const result = await page.evaluate(() => ({
    width: innerWidth,
    content: document.documentElement.scrollWidth,
    owned: [
      ...document.querySelectorAll<HTMLElement>(".workshop-main, .ia-page"),
    ].map((element) => ({
      width: element.clientWidth,
      content: element.scrollWidth,
    })),
    dialog: (() => {
      const rect = document
        .querySelector('[role="dialog"]')
        ?.getBoundingClientRect();
      return rect
        ? { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom }
        : null;
    })(),
    height: innerHeight,
  }));
  expect(result.content).toBeLessThanOrEqual(result.width + 1);
  for (const owned of result.owned)
    expect(owned.content).toBeLessThanOrEqual(owned.width + 1);
  if (result.dialog) {
    expect(result.dialog.x).toBeGreaterThanOrEqual(-1);
    expect(result.dialog.right).toBeLessThanOrEqual(result.width + 1);
    expect(result.dialog.y).toBeGreaterThanOrEqual(-1);
    expect(result.dialog.bottom).toBeLessThanOrEqual(result.height + 1);
  }
}

test("真实准备协议：原件提交、进度、恢复、来源、导出与蓝图练习", async ({
  page,
}, info) => {
  await mockInterviewPreparation(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/apps");
  await page.getByRole("textbox", { name: "搜索应用" }).fill("面试");
  await page.getByRole("button", { name: "效率协作", exact: true }).click();
  await page.getByRole("button", { name: "打开面试助手", exact: true }).click();
  await page
    .getByRole("textbox", { name: "岗位名称", exact: true })
    .fill("前端工程师");
  await page
    .getByRole("textbox", { name: /岗位描述/ })
    .fill("React、可访问性和回归验证");
  await page.getByLabel("选择简历文件").setInputFiles({
    name: "resume.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("fictional document"),
  });
  await expect(page.getByRole("textbox", { name: "简历摘要" })).toHaveValue("");
  await prepare(page);
  await expect(page.getByLabel("真实准备进度")).toContainText("已读取简历原件");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "资料已就绪", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "网络来源", exact: true }).click();
  await expect(page.getByRole("link", { name: /test-1/ })).toHaveAttribute(
    "href",
    "https://www.w3.org/WAI/test-1",
  );
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 Markdown", exact: true })
    .click();
  const exported = await downloadEvent;
  const report = info.outputPath("materials.md");
  await exported.saveAs(report);
  expect(await readFile(report, "utf8")).toContain("交易看板");
  await enter(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "真实蓝图问题 2",
  );
  const answer = "我负责焦点管理，通过独立回归样本验证改进，明确记录个人贡献。";
  await page.getByRole("textbox", { name: /你的回答/ }).fill(answer);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /你的回答/ })).toBeDisabled();
  await page.getByRole("button", { name: "继续面试", exact: true }).click();
  await page.getByRole("button", { name: "结束面试", exact: true }).click();
  await page
    .getByRole("button", { name: "结束并生成复盘", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "面试复盘", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".transcript-evidence")).toContainText(answer);
  await page.getByRole("button", { name: "只练这一题", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("共 1 道练习题");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "面试复盘", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("review.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("取消、重试、无法读取的 PDF 与资料版本保留", async ({ page }) => {
  await mockInterviewPreparation(page, { incomplete: true });
  await page.goto("/apps/interview-assistant");
  await page.getByLabel("选择简历文件").setInputFiles({
    name: "scan.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-fictional"),
  });
  await page.getByRole("button", { name: "调研并准备", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "需要补充／重新准备" }),
  ).toBeVisible({ timeout: 8000 });
  await expect(
    page.getByRole("button", { name: "检查设备并进入面试" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "修改材料", exact: true }).click();
  await page.getByRole("button", { name: "移除简历文件", exact: true }).click();
  await page
    .getByRole("textbox", { name: "简历摘要", exact: true })
    .fill("交易看板项目：负责交互验证");
  await prepare(page);
  await page
    .getByRole("button", { name: "重新准备一个版本", exact: true })
    .click();
  await page.getByRole("button", { name: "取消准备", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "已取消", exact: true, level: 1 }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "资料与任务版本", exact: true })
    .click();
  await page
    .getByRole("option", { name: "输入 v2 · 资料已就绪", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "检查设备并进入面试", exact: true }),
  ).toBeVisible();
});

for (const width of [390, 768, 1600])
  for (const theme of ["light", "dark"]) {
    test(`资料与练习适配 ${width} ${theme}`, async ({ page }, info) => {
      await mockInterviewPreparation(page);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/apps/interview-assistant");
      await setResponsiveTheme(page, theme);
      await expect(
        page.getByRole("textbox", { name: "岗位名称", exact: true }),
      ).toBeVisible();
      await noOverflow(page);
      await page.screenshot({
        path: info.outputPath("materials.png"),
        fullPage: true,
      });
      const duration = page.getByRole("combobox", {
        name: "计划面试时长",
        exact: true,
      });
      await duration.focus();
      await duration.press("Enter");
      await page.getByRole("option", { name: "15 分钟", exact: true }).click();
      await prepare(page);
      await noOverflow(page);
      await page.getByRole("button", { name: "网络来源", exact: true }).click();
      await noOverflow(page);
      await page.screenshot({
        path: info.outputPath("library.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "查看输入快照与目录", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await noOverflow(page);
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "检查设备并进入面试", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect
        .poll(() =>
          page
            .getByRole("dialog")
            .evaluate((element) => element.contains(document.activeElement)),
        )
        .toBeTruthy();
      await noOverflow(page);
      await page.screenshot({
        path: info.outputPath("devices.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "准备好了，开始面试", exact: true })
        .click();
      await expect
        .poll(() =>
          page
            .locator(".ia-practice")
            .evaluate((element) =>
              getComputedStyle(element).getPropertyValue("--bg").trim(),
            ),
        )
        .toBe("#151815");
      await page
        .getByRole("textbox", { name: /你的回答/ })
        .fill("通过独立样本验证方案");
      await noOverflow(page);
      await page.screenshot({
        path: info.outputPath("interview.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "结束面试", exact: true }).click();
      await page
        .getByRole("button", { name: "结束并生成复盘", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "面试复盘", exact: true }),
      ).toBeVisible();
      await noOverflow(page);
      await page.screenshot({
        path: info.outputPath("review.png"),
        fullPage: true,
      });
    });
  }
