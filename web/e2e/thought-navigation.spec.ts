import { expect, test } from "@playwright/test";
import { newDocument, saveNote } from "./thought-helpers";

test("document paths follow parents while browsing views omit redundant breadcrumbs", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/thought-workshop");
  const path = page.getByRole("navigation", { name: "文档路径" });
  await expect(path).toHaveCount(0);
  await newDocument(page);
  const title = page.getByLabel("笔记标题", { exact: true });
  const titles = [
    "相关框架调研",
    "Agent Harness 架构分析",
    "嵌套文档与长标题的导航验证".repeat(4),
  ];
  const urls: string[] = [];
  for (const [index, name] of titles.entries()) {
    await title.fill(name);
    await saveNote(page);
    await expect(path.locator('[aria-current="page"]')).toHaveText(name);
    urls.push(page.url());
    if (index === titles.length - 1) break;
    await page
      .getByRole("button", { name: `${name}操作`, exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "新建子文档", exact: true })
      .click();
    await expect(title).toHaveValue("未命名文档");
  }
  await expect(path.getByRole("button")).toHaveCount(3);
  await expect(path.getByRole("button").nth(1)).toHaveText(titles[0]!);
  await expect(path.getByRole("button").nth(2)).toHaveText(titles[1]!);
  // Returning to a parent must keep the editor's unsaved-content protection.
  await page.route(
    `**/v1/thought-workshop/notes/${urls[2]!.split("/").pop()}`,
    (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 503, json: { detail: "隔离测试保存失败" } })
        : route.continue(),
  );
  await page
    .getByRole("textbox", { name: "笔记正文", exact: true })
    .fill("保留未保存内容");
  const parent = path.getByRole("button", { name: titles[1], exact: true });
  await parent.focus();
  await page.keyboard.press("Enter");
  const leave = page.getByRole("alertdialog", { name: "仍有未保存的内容" });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page).toHaveURL(urls[2]!);
  await page.unroute(
    `**/v1/thought-workshop/notes/${urls[2]!.split("/").pop()}`,
  );
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await parent.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(urls[1]!);
  await expect(title).toHaveValue(titles[1]!);
  await page.goto(urls[2]!);
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(path).toBeVisible();
      await path.getByRole("button").first().focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await expect(
        path.getByRole("button", { name: titles[1], exact: true }),
      ).toBeFocused();
      await expect(
        path.getByRole("button", { name: titles[1], exact: true }),
      ).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 2,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`document-path-${width}-${theme}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  for (const name of ["全部文档", "最近编辑", "收藏文档", "文档回收站"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("region", { name: "文档筛选结果" }),
    ).toBeVisible();
    await expect(path).toHaveCount(0);
  }
  await page
    .getByRole("textbox", { name: "搜索当前知识库", exact: true })
    .fill("框架");
  await expect(path).toHaveCount(0);
  await page.getByRole("button", { name: "全部文档", exact: true }).click();
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(
        page
          .locator(".knowledge-topbar")
          .getByRole("button", { name: "新建文档", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 2,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`document-list-${width}-${theme}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole("button", { name: "首页", exact: true }).click();
  await expect(page.getByLabel("笔记标题", { exact: true })).toBeVisible();
  await expect(path).toHaveCount(0);
});
