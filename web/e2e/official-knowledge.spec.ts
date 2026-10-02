import { expect, test } from "@playwright/test";
import { newDocument, saveNote } from "./thought-helpers";
import { setResponsiveTheme } from "./responsive-capture";

const officialRoot = "/apps/thought-workshop/official-knowledge-bases";

test("official and personal libraries share search but keep separate identities and trash", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/thought-workshop");
  const official = page.getByRole("region", { name: "官方文档", exact: true });
  await expect(official.getByRole("article")).toHaveCount(12);
  await expect(official.getByText("官方 · 只读", { exact: true })).toHaveCount(
    12,
  );
  await page.screenshot({ path: info.outputPath("official-library-list.png") });
  await page.getByRole("textbox", { name: "搜索知识库" }).fill("演示");
  await expect(official.getByRole("article")).toHaveCount(1);
  await page.getByRole("textbox", { name: "搜索知识库" }).fill("");
  await page.getByRole("button", { name: "创建知识库", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("演示工坊官方文档");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "编辑首页", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "所有知识库", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索知识库" })
    .fill("演示工坊官方文档");
  await expect(official.getByRole("article")).toHaveCount(1);
  await expect(
    page.locator(
      ".knowledge-library > .knowledge-cards .workshop-project-card",
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(".knowledge-library > .knowledge-cards .official-badge"),
  ).toHaveCount(0);
  await page.getByRole("combobox", { name: "演示工坊官方文档操作" }).click();
  await page.getByRole("option", { name: "移入回收站", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(
    page.locator(
      ".knowledge-library > .knowledge-cards .workshop-project-card",
    ),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "知识库回收站", exact: true }).click();
  await expect(official).toHaveCount(0);
  await page.getByRole("button", { name: "恢复知识库", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "恢复知识库", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "所有知识库", exact: true }).click();
  await expect(
    page.locator(
      ".knowledge-library > .knowledge-cards .workshop-project-card",
    ),
  ).toHaveCount(1);
  await official.getByRole("button", { name: "进入知识库" }).click();
  await expect(page).toHaveURL(`${officialRoot}/presentation-workshop`);
  const libraryRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/thought-workshop/"))
      libraryRequests.push(request.method() + " " + request.url());
  });
  await page
    .locator(".official-home")
    .getByRole("button", { name: "功能概览与快速开始" })
    .click();
  await expect(
    page.getByRole("article", { name: "官方文档正文" }),
  ).toContainText("制作第一份文稿");
  await page.reload();
  await expect(
    page.getByRole("article", { name: "官方文档正文" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "搜索官方文档" })
    .fill("Consolas 不存在的关键词");
  await expect(page.getByText("找到 0 篇文档", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "搜索官方文档" }).fill("100 页");
  const result = page.getByRole("region", { name: "官方文档搜索结果" });
  await result.getByRole("button", { name: /导入导出与交付/ }).click();
  await expect(page).toHaveURL(
    `${officialRoot}/presentation-workshop/documents/delivery`,
  );
  await page
    .getByRole("navigation", { name: "文档章节" })
    .getByRole("link", { name: "导出 PPTX" })
    .click();
  await expect(
    page.getByRole("heading", { name: "导出 PPTX", exact: true }),
  ).toBeInViewport();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "导出 PPTX", exact: true }),
  ).toBeInViewport();
  await page.goBack(); // heading hash
  await page.goBack(); // previous article
  await expect(page).toHaveURL(
    `${officialRoot}/presentation-workshop/documents/overview`,
  );
  await expect(
    page.getByRole("button", { name: /^(新建文档|编辑首页|保存文档|导入)$/ }),
  ).toHaveCount(0);
  expect(libraryRequests).toEqual([]);
});

test("read-only members use the same bundled reader and responsive navigation", async ({
  page,
}, info) => {
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const principal = await response.json();
    principal.workspace.permission_keys = ["content.read"];
    await route.fulfill({ response, json: principal });
  });
  await page.goto("/apps/thought-workshop");
  const official = page.getByRole("region", { name: "官方文档", exact: true });
  await expect(official.getByRole("article")).toHaveCount(12);
  await expect(
    page.getByRole("button", { name: "创建知识库", exact: true }),
  ).toHaveCount(0);
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`readonly-libraries-${width}.png`),
    });
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await page
    .getByRole("textbox", { name: "搜索知识库" })
    .fill("Future Props Lab 官方文档");
  await official.getByRole("button", { name: "进入知识库" }).click();
  await page
    .locator(".official-home")
    .getByRole("button", { name: "应用总览与选用" })
    .click();
  await page.getByRole("link", { name: "Live2D 工坊", exact: true }).click();
  await expect(page).toHaveURL(`${officialRoot}/live2d-workshop`);
  await page
    .locator(".official-home")
    .getByRole("button", { name: "导入导出与交付" })
    .click();
  const article = page.getByRole("article", { name: "官方文档正文" });
  await expect(article).toContainText("素材交接包不生成");
  // Offline desktop reading means local bundled resources remain reachable;
  // no internet service is needed to load an as-yet-unopened article.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname)
      ? route.fallback()
      : route.abort();
  });
  for (const width of [1600, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await setResponsiveTheme(page, theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`official-${width}-${theme}.png`),
      });
    }
    if (width <= 1200) {
      const trigger = page.getByRole("button", { name: "目录", exact: true });
      await trigger.click();
      await expect(
        page.getByRole("dialog", { name: "官方知识库导航" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    }
  }
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await page
    .getByRole("navigation", { name: "官方文档目录" })
    .getByRole("button", { name: "主要操作流程" })
    .click();
  await expect(article).toContainText("参数关键形");
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  await page.reload();
  await expect(article).toContainText("参数关键形");
});

test("unsaved personal documents retain their guard before visiting official content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  const noteUrl = page.url();
  const noteId = noteUrl.split("/").pop();
  await page.route(`**/v1/thought-workshop/notes/${noteId}`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { detail: "隔离测试保存失败" } })
      : route.continue(),
  );
  await page
    .getByRole("textbox", { name: "笔记正文", exact: true })
    .fill("保留个人草稿，阅读官方指南前先保存。");
  await page.getByRole("button", { name: "所有知识库", exact: true }).click();
  const guard = page.getByRole("alertdialog", { name: "仍有未保存的内容" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page).toHaveURL(noteUrl);
  await page.unroute(`**/v1/thought-workshop/notes/${noteId}`);
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "所有知识库", exact: true }).click();
  await page
    .getByRole("region", { name: "官方文档", exact: true })
    .getByRole("button", { name: "进入知识库" })
    .first()
    .click();
  await expect(page).toHaveURL(`${officialRoot}/general`);
  await page.goto(noteUrl);
  await expect(
    page.getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toContainText("保留个人草稿");
});
