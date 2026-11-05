import { expect, test, type Page } from "@playwright/test";
import {
  newDocument,
  pickProjectMore,
  saveNote,
  setThoughtTheme,
} from "./thought-helpers";

async function expectSingleNavigation(page: Page) {
  await expect(
    page.getByRole("complementary", { name: "知识库导航", exact: true }),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("complementary", { name: "知识库导航", exact: true })
      .getByText("Thought Workshop", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "全部笔记", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("group", { name: "外观模式" })).toHaveCount(1);
}

test("document action menu follows the directory row and stays within the viewport", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  const trigger = page.getByRole("button", {
    name: "未命名文档操作",
    exact: true,
  });
  await trigger.click();
  const menu = page.getByRole("menu", {
    name: "未命名文档操作",
    exact: true,
  });
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "新建子文档", exact: true }),
  ).toBeFocused();
  await expect(menu.getByRole("menuitem")).toHaveCount(5);
  await expect(menu.getByRole("separator")).toHaveCount(2);
  const triggerBox = await trigger.boundingBox();
  const menuBox = await menu.boundingBox();
  expect(triggerBox && menuBox).toBeTruthy();
  expect(menuBox!.x).toBeGreaterThan(triggerBox!.x + triggerBox!.width);
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("document-action-menu-1600-light.png"),
  });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByLabel("笔记标题", { exact: true }).click();
  await expect(menu).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.getByRole("button", { name: "笔记目录", exact: true }).click();
  await trigger.click();
  await expect(menu).toBeVisible();
  const mobileMenuBox = await menu.boundingBox();
  expect(mobileMenuBox).toBeTruthy();
  expect(mobileMenuBox!.x).toBeGreaterThanOrEqual(12);
  expect(mobileMenuBox!.x + mobileMenuBox!.width).toBeLessThanOrEqual(378);
  expect(mobileMenuBox!.y).toBeGreaterThanOrEqual(12);
  expect(mobileMenuBox!.y + mobileMenuBox!.height).toBeLessThanOrEqual(832);
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("document-action-menu-390-dark.png"),
  });
});

test("project topbar uses a compact accessible action menu", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/thought-workshop");
  await page.getByRole("button", { name: "创建知识库", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("产品与设计 · 灵感知识库");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByLabel("笔记标题", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "文档回收站", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "文档回收站", exact: true }),
  ).toBeVisible();

  for (const width of [1600, 1280, 390]) {
    await page.setViewportSize({
      width,
      height: width === 1600 ? 1000 : width === 1280 ? 800 : 844,
    });
    await setThoughtTheme(page, "light");
    const topbar = page.locator(".knowledge-topbar");
    const trigger = topbar.getByRole("button", {
      name: "知识库更多操作",
      exact: true,
    });
    const createDocument = topbar.getByRole("button", {
      name: "新建文档",
      exact: true,
    });
    await expect(trigger).toBeVisible();
    await expect(
      topbar.getByRole("button", { name: "导入", exact: true }),
    ).toHaveCount(0);
    const controlHeight = width <= 700 ? 36 : 40;
    expect((await trigger.boundingBox())!.height).toBe(controlHeight);
    expect((await createDocument.boundingBox())!.height).toBe(controlHeight);
    if (width >= 1280)
      expect((await topbar.boundingBox())!.height).toBeLessThanOrEqual(60);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);

    await trigger.press("ArrowDown");
    const menu = page.getByRole("menu", {
      name: "知识库更多操作",
      exact: true,
    });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(9);
    await expect(
      menu.getByRole("menuitem", { name: "导出整库 HTML" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "发布到知识社区" }),
    ).toBeVisible();
    await expect(menu.getByRole("separator")).toHaveCount(2);
    await expect(menu.getByRole("menuitem", { name: "导入" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(
      menu.getByRole("menuitem", { name: "移入回收站" }),
    ).toBeFocused();
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
    expect(menuBox.y).toBeGreaterThanOrEqual(0);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(
      (await page.viewportSize())!.height,
    );
    if (width === 1600)
      await page.screenshot({
        animations: "disabled",
        path: info.outputPath("project-topbar-menu-1600-light.png"),
        fullPage: true,
      });
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }
});

test("knowledge cards, editable home, parent documents, moves, old links and responsive views", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors: string[] = [];
  const libraryTitle = `产品与设计 · 灵感知识库 · 目录验收 ${Date.now()}`;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/apps/thought-workshop");
  await expectSingleNavigation(page);
  await page.reload();
  await expectSingleNavigation(page);
  await page.getByRole("button", { name: "创建知识库", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(libraryTitle);
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByLabel("笔记标题", { exact: true })).toBeVisible();
  await expectSingleNavigation(page);
  const projectUrl = page.url();
  const projectId = projectUrl.split("/").pop()!;
  const filterRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === "/v1/thought-workshop/notes" &&
      request.method() === "GET"
    )
      filterRequests.push(url.searchParams.get("knowledge_base_id") || "");
  });
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await expect(prose).toHaveAttribute("contenteditable", "true");
  for (const width of [1600, 1280, 390]) {
    await page.setViewportSize({
      width,
      height: width === 1600 ? 1000 : width === 1280 ? 800 : 844,
    });
    for (const theme of ["light", "dark"]) {
      await setThoughtTheme(page, theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 2,
        ),
      ).toBe(true);
      await page.screenshot({
        animations: "disabled",
        path: info.outputPath(`empty-home-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(prose).toHaveAttribute("contenteditable", "true");
  await prose.fill(
    [
      "欢迎来到灵感知识库\n在这里，记录值得探索的想法，积累阅读与观察，让知识有序生长。\n\n愿景与目标\n建立一份持续更新的设计档案，让每一次思考都能成为下一次创作的起点。\n\n知识库简介\n收集产品研究、体验设计与日常阅读，连接想法与行动。\n\n常用资料\n用文档、图片、表格和附件，把重要内容放在一起。",
      ...Array.from(
        { length: 20 },
        (_, index) =>
          `阅读资料 ${index + 1}：记录可复核的研究、观察和设计结论。`,
      ),
    ].join("\n"),
  );
  for (const heading of ["愿景与目标", "知识库简介", "常用资料"]) {
    await prose
      .locator("p")
      .filter({ hasText: new RegExp(`^${heading}$`) })
      .hover({ position: { x: 5, y: 5 } });
    await page
      .locator(".thought-drag-handle")
      .getByRole("button", { name: /打开正文菜单/ })
      .click();
    await page
      .getByRole("dialog", { name: "块操作", exact: true })
      .getByRole("combobox", { name: "转换块类型", exact: true })
      .click();
    await page.getByRole("option", { name: "标题 2", exact: true }).click();
  }
  await page.getByRole("button", { name: "返回阅读", exact: true }).click();
  const leave = page.getByRole("alertdialog", {
    name: "仍有未保存的内容",
    exact: true,
  });
  if (await leave.isVisible())
    await leave
      .getByRole("button", { name: "保存并离开", exact: true })
      .click();
  await expect(prose).toHaveAttribute("contenteditable", "false");
  await expect(prose).toContainText("让知识有序生长");
  await page.reload();
  await expect(prose).toContainText("让知识有序生长");
  await newDocument(page);
  await page.getByLabel("笔记标题", { exact: true }).fill("产品研究");
  await prose.fill("产品研究目录页");
  await saveNote(page);
  const parentId = page.url().split("/").pop()!;
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/v1/thought-workshop/notes/${parentId}`)
          ).json()
        ).title,
    )
    .toBe("产品研究");
  await page.getByRole("button", { name: "产品研究操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建子文档", exact: true }).click();
  await expect(page).not.toHaveURL(`${projectUrl}/documents/${parentId}`);
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "未命名文档",
  );
  await page.getByLabel("笔记标题", { exact: true }).fill("体验观察");
  await prose.fill("体验观察子文档");
  await saveNote(page);
  const childId = page.url().split("/").pop()!;
  await expect
    .poll(async () => {
      const note = await (
        await page.request.get(`/v1/thought-workshop/notes/${childId}`)
      ).json();
      return { title: note.title, parent_id: note.parent_id };
    })
    .toEqual({ title: "体验观察", parent_id: parentId });
  await page.goto(`${projectUrl}/documents/${parentId}`);
  const relations = page.getByRole("complementary", { name: "关联文档" });
  await expect(
    relations.getByRole("heading", { name: "子文档", exact: true }),
  ).toBeVisible();
  await expect(
    relations.getByRole("button", { name: "体验观察", exact: true }),
  ).toBeVisible();
  await expect(prose).not.toContainText("体验观察");
  await newDocument(page);
  await page
    .getByLabel("笔记标题", { exact: true })
    .fill("一份有层次的设计笔记");
  await prose.fill("目录支持嵌套，正文可以专注写作。");
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  const documentId = page.url().split("/").pop()!;
  // Filter transitions must keep the editor's leave protection intact.
  await page.route(`**/v1/thought-workshop/notes/${documentId}`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { detail: "隔离测试保存失败" } })
      : route.continue(),
  );
  await prose.fill("目录支持嵌套，正文可以专注写作。未保存的想法不能丢失。");
  await page.getByRole("button", { name: "最近编辑", exact: true }).click();
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(prose).toContainText("未保存的想法不能丢失");
  await page.unroute(`**/v1/thought-workshop/notes/${documentId}`);
  await page.getByRole("button", { name: "收藏", exact: true }).click();
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  const results = page.getByRole("region", { name: "文档筛选结果" });
  for (const name of ["全部文档", "最近编辑", "收藏文档"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      results.getByRole("button", {
        name: "一份有层次的设计笔记",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "知识库目录" }),
    ).toBeVisible();
  }
  await page
    .getByRole("textbox", { name: "搜索当前知识库", exact: true })
    .fill("不存在的标题");
  await expect(results).toContainText("没有符合条件的文档");
  await page.getByRole("button", { name: "全部文档", exact: true }).click();
  await results
    .getByRole("button", { name: "一份有层次的设计笔记", exact: true })
    .click();
  await expect(prose).toContainText("未保存的想法不能丢失");
  await expectSingleNavigation(page);
  expect(filterRequests.length).toBeGreaterThan(0);
  expect(filterRequests.every((id) => id === projectId)).toBe(true);
  const documentMenuTrigger = page.getByRole("button", {
    name: "一份有层次的设计笔记操作",
    exact: true,
  });
  await documentMenuTrigger.click();
  const documentMenu = page.getByRole("menu", {
    name: "一份有层次的设计笔记操作",
    exact: true,
  });
  await expect(documentMenu).toBeVisible();
  const documentMenuTriggerBox = await documentMenuTrigger.boundingBox();
  const documentMenuBox = await documentMenu.boundingBox();
  expect(documentMenuTriggerBox && documentMenuBox).toBeTruthy();
  expect(documentMenuBox!.x).toBeGreaterThan(
    documentMenuTriggerBox!.x + documentMenuTriggerBox!.width,
  );
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("document-action-menu-1600-light.png"),
  });
  await documentMenu
    .getByRole("menuitem", { name: "移动到…", exact: true })
    .click();
  await page.getByRole("combobox", { name: "目标父文档", exact: true }).click();
  await page.getByRole("option", { name: "体验观察", exact: true }).click();
  await page.getByRole("button", { name: "移动", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/v1/thought-workshop/notes/${documentId}`)
          ).json()
        ).parent_id,
    )
    .toBe(childId);
  await page
    .getByRole("button", { name: "一份有层次的设计笔记操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  const movedToTrash = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname ===
        `/v1/thought-workshop/notes/${documentId}`,
  );
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  expect((await movedToTrash).ok()).toBeTruthy();
  await expect(page.getByLabel("笔记标题", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "文档回收站", exact: true }).click();
  await expect(results).toContainText("一份有层次的设计笔记");
  await results.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(results).toContainText("没有符合条件的文档");
  await page.getByRole("button", { name: "全部文档", exact: true }).click();
  await expect(
    results.getByRole("button", { name: "一份有层次的设计笔记", exact: true }),
  ).toBeVisible();
  await page.goto(`/apps/thought-workshop/notes/${documentId}`);
  await expect(page).toHaveURL(`${projectUrl}/documents/${documentId}`);
  await expectSingleNavigation(page);
  await page.getByRole("button", { name: "首页", exact: true }).click();
  for (const width of [1600, 1280, 390]) {
    await page.setViewportSize({
      width,
      height: width === 1600 ? 1000 : width === 1280 ? 800 : 844,
    });
    for (const theme of ["light", "dark"]) {
      await setThoughtTheme(page, theme);
      await expect(prose).toHaveAttribute("contenteditable", "true");
      if (width > 1200) {
        const track = page.locator(".knowledge-sidebar-track");
        const sidebar = page.getByRole("complementary", { name: "知识库导航" });
        const main = await page.getByRole("main").boundingBox();
        const rail = await track.boundingBox();
        expect(
          Math.abs(rail!.height - page.viewportSize()!.height),
        ).toBeLessThan(1);
        expect(
          Math.abs(rail!.y + rail!.height - main!.y - main!.height),
        ).toBeLessThan(1);
        expect(
          await track.evaluate((el) => getComputedStyle(el).backgroundColor),
        ).toBe(
          await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor),
        );
        const content = page.getByRole("main");
        expect(
          await content.evaluate(
            (element) => element.scrollHeight > element.clientHeight,
          ),
        ).toBe(true);
        await content.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await expect(
          sidebar.getByRole("group", { name: "外观模式" }),
        ).toBeInViewport();
        expect(Math.abs((await sidebar.boundingBox())!.y)).toBeLessThan(1);
        await content.evaluate((element) => {
          element.scrollTop = 0;
        });
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 2,
        ),
      ).toBe(true);
      await page.screenshot({
        animations: "disabled",
        path: info.outputPath(`home-${width}-${theme}.png`),
        fullPage: true,
      });
    }
    if (width === 390) {
      await page.getByRole("button", { name: "笔记目录", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "知识库导航" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "产品研究操作", exact: true })
        .click();
      const menu = page.getByRole("menu", {
        name: "产品研究操作",
        exact: true,
      });
      await expect(menu).toBeVisible();
      await expect(
        menu.getByRole("menuitem", { name: "新建子文档", exact: true }),
      ).toBeFocused();
      const menuBox = await menu.boundingBox();
      expect(menuBox!.x).toBeGreaterThanOrEqual(0);
      expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(844);
      const deleteOption = menu.getByRole("menuitem", {
        name: "删除",
        exact: true,
      });
      await deleteOption.scrollIntoViewIfNeeded();
      expect(
        await deleteOption.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            ),
          );
        }),
      ).toBe(true);
      await page.screenshot({
        animations: "disabled",
        path: info.outputPath("directory-menu-390-dark.png"),
      });
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("dialog", { name: "知识库导航" }),
      ).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: info.outputPath("directory-390-dark.png"),
      });
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "笔记目录", exact: true }),
      ).toBeFocused();
    }
  }
  const renameLibrary = async (title: string) => {
    await page.getByRole("button", { name: "笔记目录", exact: true }).click();
    await page
      .getByRole("dialog", { name: "知识库导航" })
      .getByRole("button", { name: "全部文档", exact: true })
      .click();
    await pickProjectMore(page, "重命名");
    await page.getByRole("dialog").getByRole("textbox").fill(title);
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname ===
          `/v1/thought-workshop/knowledge-bases/${projectId}`,
    );
    await page.getByRole("button", { name: "确认", exact: true }).click();
    expect((await saved).ok()).toBeTruthy();
    await page.goto(projectUrl);
    await expect(
      page
        .getByRole("navigation", { name: "文档路径" })
        .getByRole("button", { name: title, exact: true }),
    ).toBeVisible();
  };
  const longTitle = "长标题与边界检查".repeat(12);
  await renameLibrary(longTitle);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true);
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("long-title-390-dark.png"),
    fullPage: true,
  });
  await renameLibrary(libraryTitle);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索知识库", exact: true })
    .fill(libraryTitle);
  await expect(page.locator(".workshop-project-card")).toHaveCount(1);
  await expect(page.locator(".workshop-project-card")).toContainText(
    "3 篇文档",
  );
  await expect(page.locator(".workshop-status")).toHaveCount(0);
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("cards-1600-dark.png"),
    fullPage: true,
  });
  for (const width of [1600, 1280, 390]) {
    await page.setViewportSize({
      width,
      height: width === 1600 ? 1000 : width === 1280 ? 800 : 844,
    });
    for (const theme of ["light", "dark"]) {
      await setThoughtTheme(page, theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 2,
        ),
      ).toBe(true);
      await page.screenshot({
        animations: "disabled",
        path: info.outputPath(`cards-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  await page.goBack();
  await expect(page).toHaveURL(projectUrl);
  await page.goForward();
  await expect(page).toHaveURL(/\/apps\/thought-workshop$/);
  expect(errors).toEqual([]);
  expect(projectId).toBeTruthy();
});

test("other workshop shells retain their own navigation and theme controls", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  for (const [app, name] of [
    ["visual-workshop", "视觉创作工坊"],
    ["galgame-workshop", "Galgame 工坊"],
    ["video-editor", "视频剪辑工坊"],
  ]) {
    await page.goto(`/apps/${app}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const sidebar = page.getByRole("complementary");
    await expect(sidebar).toHaveCount(1);
    await expect(sidebar.getByText(name, { exact: true })).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: "返回应用中心", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("group", { name: "外观模式" })).toHaveCount(1);
    await page.screenshot({
      animations: "disabled",
      path: info.outputPath(`${app}-sidebar.png`),
    });
    await sidebar
      .getByRole("button", { name: "返回应用中心", exact: true })
      .click();
    await expect(page).toHaveURL(/\/apps$/);
  }
});

test("knowledge home opens as an ordinary editable note", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apps/thought-workshop");
  await page.getByRole("button", { name: "创建知识库", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建知识库", exact: true });
  await dialog.getByRole("textbox").fill("首页即文档");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "首页",
  );
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await expect(prose).toHaveAttribute("contenteditable", "true");
  await expect(
    page.getByRole("button", { name: "返回阅读", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".thought-subpages")
      .getByRole("navigation", { name: "知识库目录" }),
  ).toHaveCount(0);
  await newDocument(page);
  await page.getByRole("button", { name: "首页", exact: true }).click();
  await expect(
    page
      .locator(".thought-subpages")
      .getByRole("navigation", { name: "子文档" }),
  ).toHaveCount(0);
});
