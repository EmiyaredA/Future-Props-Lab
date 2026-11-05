import { pickProjectMore } from "./thought-helpers";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { setResponsiveTheme } from "./responsive-capture";
import { importAndPublish } from "./official-import-helpers";
const ROOT = "/v1/thought-workshop",
  COMM = ROOT + "/community";
async function write(
  context: BrowserContext,
  path: string,
  data: unknown,
  method = "POST",
) {
  const origin = `http://127.0.0.1:${process.env.FPL_E2E_WEB_PORT || "3000"}`;
  const response = await context.request.fetch(path, {
    method,
    data,
    headers: {
      Origin: origin,
      "X-CSRF-Token":
        (await context.cookies()).find((c) => c.name === "fpl_csrf")?.value ||
        "",
    },
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}
const doc = (text: string) => ({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "从一篇文档开始" }],
    },
    { type: "paragraph", content: [{ type: "text", text }] },
  ],
});
async function capture(page: Page, name: string) {
  const directory = process.env.FPL_COMMUNITY_PREVIEWS;
  if (!directory) return;
  await fs.mkdir(directory, { recursive: true });
  for (const width of [1600, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const theme of ["light", "dark"]) {
      await setResponsiveTheme(page, theme);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBeTruthy();
      const bounds = await page
        .locator('[role="alertdialog"]')
        .evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect();
            return (
              r.x >= -1 &&
              r.right <= innerWidth + 1 &&
              r.y >= -1 &&
              r.bottom <= innerHeight + 1
            );
          }),
        );
      expect(bounds.every(Boolean)).toBeTruthy();
      await page.screenshot({
        path: `${directory}/${name}-${width}-${theme}.png`,
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setResponsiveTheme(page, "light");
}
async function choose(page: Page, label: string, value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}

test("全局入口仅在库外显示，三类知识库保留返回入口和独立目录", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/thought-workshop");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const library = await write(page.context(), ROOT + "/knowledge-bases", {
    title: "知识库导航验收",
    description: "在库内专注文档，通过返回入口切换知识库。",
  });
  const note = await write(page.context(), ROOT + "/notes", {
    knowledge_base_id: library.id,
    expected_knowledge_revision: library.revision,
    title: "灵感采集方法",
    document: doc("整理目录、撰写正文，再分享给伙伴。"),
  });
  const publication = await write(
    page.context(),
    COMM + `/libraries/${library.id}/publication`,
    {
      expected_revision: 0,
      title: library.title,
      description: library.description,
      articles: [
        {
          note_id: note.id,
          expected_revision: 0,
          visibility: "public",
          members: [],
        },
      ],
    },
    "PUT",
  );
  const sidebar = page.locator('aside[aria-label="知识库导航"]');
  await expect(
    sidebar.getByRole("navigation", { name: "思绪工坊入口" }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "搜索与最近访问" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("outside-library.png"),
    animations: "disabled",
  });
  const official = await importAndPublish(page, "general");
  for (const resource of [
    {
      name: "private",
      path: `/apps/thought-workshop/knowledge-bases/${library.id}`,
      back: "我的知识库",
      destination: "/apps/thought-workshop",
    },
    {
      name: "community",
      path: `/apps/thought-workshop/community/${publication.publication.id}/documents/${note.id}`,
      back: "返回知识社区",
      destination: "/apps/thought-workshop/community",
    },
    {
      name: "official",
      path: `/apps/thought-workshop/community/${official.publication.id}`,
      back: "返回知识社区",
      destination: "/apps/thought-workshop/community",
    },
  ]) {
    await page.goto(resource.path);
    const directory = page.getByRole("button", {
      name: resource.name === "private" ? "笔记目录" : "目录",
      exact: true,
    });
    for (const width of [1600, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      if (width <= 1200) await directory.click();
      await expect(sidebar).toBeVisible();
      await expect(
        sidebar.getByRole("navigation", { name: "思绪工坊入口" }),
      ).toHaveCount(0);
      for (const label of ["我的收藏", "我的发布", "搜索与最近访问"])
        await expect(
          sidebar.getByRole("button", { name: label, exact: true }),
        ).toHaveCount(0);
      await expect(
        sidebar.getByRole("button", { name: resource.back, exact: true }),
      ).toBeVisible();
      await expect(sidebar.getByRole("textbox")).toHaveCount(1);
      await expect(
        sidebar.locator(".knowledge-directory-scroll"),
      ).toBeVisible();
      for (const theme of ["light", "dark"]) {
        await setResponsiveTheme(page, theme);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(`${resource.name}-${width}-${theme}.png`),
          animations: "disabled",
        });
      }
      if (width <= 1200) await page.keyboard.press("Escape");
    }
    await page.reload();
    await directory.click();
    const back = sidebar.getByRole("button", {
      name: resource.back,
      exact: true,
    });
    await back.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(resource.destination);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(
      sidebar.getByRole("navigation", { name: "思绪工坊入口" }),
    ).toBeVisible();
    for (const label of ["我的知识库", "知识社区", "我的收藏", "我的发布"])
      await expect(
        sidebar.getByRole("button", { name: label, exact: true }),
      ).toBeVisible();
  }
  expect(errors).toEqual([]);
  await write(
    page.context(),
    COMM + `/libraries/${library.id}/publication`,
    {
      expected_revision: publication.publication.revision,
      title: library.title,
      active: false,
      articles: [],
    },
    "PUT",
  );
});

test("精选书架、逐篇发布、跨空间授权编辑、收藏导出和撤回", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/apps/thought-workshop");
  const owner = page.context();
  const username = `linjian-${Date.now().toString().slice(-6)}`;
  const account = await write(owner, "/v1/platform/accounts", {
    username,
    display_name: "林间的笔记",
  });
  const visitor = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: { cookies: [], origins: [] },
  });
  const login = await visitor.request.post("/v1/auth/login", {
    data: { username, password: account.temporary_password },
  });
  expect(login.ok()).toBeTruthy();
  await write(visitor, "/v1/auth/change-password", {
    current_password: account.temporary_password,
    new_password: "Community-Browser-2026!",
  });
  const view = await visitor.newPage();
  view.on("pageerror", (e) => errors.push(e.message));
  const kb = await write(owner, ROOT + "/knowledge-bases", {
    title: "创作手记",
    description: "记录灵感与制作流程，与伙伴一起完善。",
  });
  const notes = [];
  for (const title of ["个人草稿", "灵感采集方法", "作品交付清单"]) {
    const current = await (
      await owner.request.get(ROOT + `/knowledge-bases/${kb.id}`)
    ).json();
    notes.push(
      await write(owner, ROOT + "/notes", {
        knowledge_base_id: kb.id,
        expected_knowledge_revision: current.revision,
        title,
        document: doc(
          `这里记录${title}。保存时更新同一份正文，公开文章与原笔记保持一致。`,
        ),
        parent_id: title === "灵感采集方法" ? notes[0].id : null,
      }),
    );
  }
  await page.goto(`/apps/thought-workshop/knowledge-bases/${kb.id}`);
  await pickProjectMore(page, "发布到知识社区");
  const publish = page.getByRole("alertdialog", {
    name: "发布到知识社区",
    exact: true,
  });
  await expect(publish).toBeVisible();
  await publish.getByLabel("发布 灵感采集方法", { exact: true }).check();
  await publish.getByLabel("发布 作品交付清单", { exact: true }).check();
  await publish
    .locator(".community-publish-row")
    .filter({ hasText: "作品交付清单" })
    .getByRole("button", { name: "权限", exact: true })
    .click();
  await choose(page, "文章访问范围", "仅指定成员可读");
  await publish.getByLabel("成员账号", { exact: true }).fill(username);
  await choose(page, "新成员权限", "可管理");
  await publish.getByRole("button", { name: "添加", exact: true }).click();
  await capture(page, "publish-articles");
  await test.step("发布选定文章并等待确认", async () => {
    await publish
      .getByRole("button", { name: "发布选定文章", exact: true })
      .click();
    await expect(publish).toBeHidden();
  });
  const config = await (
    await owner.request.get(COMM + `/libraries/${kb.id}/publication`)
  ).json();
  const pub = config.publication.id;
  const url = `/apps/thought-workshop/community/${pub}`;
  await page.goto("/apps/thought-workshop/community");
  await expect(
    page.getByRole("heading", { name: "知识社区", exact: true }),
  ).toBeVisible();
  await capture(page, "community-bookshelf");
  await page.getByRole("button", { name: "用户发布", exact: true }).click();
  await expect(
    page.locator(".community-book").filter({ hasText: "创作手记" }),
  ).toBeVisible();
  await capture(page, "community-user-books");
  await view.goto(url + `/documents/${notes[1].id}`);
  await expect(
    view.getByRole("heading", { name: notes[1].title, exact: true }),
  ).toBeVisible();
  await expect(
    view.getByRole("button", { name: "编辑文档", exact: true }),
  ).toHaveCount(0);
  await expect(view.getByText("个人草稿", { exact: true })).toHaveCount(0);
  await capture(view, "article-readonly");
  await info.attach("访客只读视图", {
    body: await view.screenshot(),
    contentType: "image/png",
  });
  expect(
    (await visitor.request.get(ROOT + `/notes/${notes[1].id}`)).status(),
  ).toBe(404);
  await page.goto(url + `/documents/${notes[1].id}`);
  await page
    .getByRole("button", { name: "社区文档更多操作", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "文章访问权限", exact: true })
    .click();
  const permissions = page.getByRole("alertdialog", {
    name: /灵感采集方法 · 访问权限/,
  });
  await expect(permissions).toBeVisible();
  await permissions.getByLabel("成员账号", { exact: true }).fill(username);
  await choose(page, "新成员权限", "可编辑");
  await permissions.getByRole("button", { name: "添加", exact: true }).click();
  await capture(page, "article-permissions");
  await permissions
    .getByRole("button", { name: "保存权限", exact: true })
    .click();
  await expect(permissions).toBeHidden();
  await view.reload();
  await view.getByRole("button", { name: "编辑文档", exact: true }).click();
  await expect(view.getByLabel("笔记标题", { exact: true })).toBeVisible();
  await view.getByLabel("笔记标题", { exact: true }).fill("灵感采集与整理");
  await view.getByRole("textbox", { name: "笔记正文", exact: true }).click();
  await view.keyboard.press("ControlOrMeta+End");
  await view.keyboard.type("编辑者补充：按主题整理，保留来源与下一步行动。");
  await view.getByLabel("选择附件", { exact: true }).setInputFiles({
    name: "灵感清单.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("这份附件从社区编辑器上传到源空间。"),
  });
  await expect(
    view.getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toContainText("灵感清单.txt");
  await test.step("授权编辑并核对写回原笔记", async () => {
    await view
      .getByRole("button", { name: "社区文档更多操作", exact: true })
      .click();
    await view.getByRole("menuitem", { name: "保存", exact: true }).click();
    await expect(
      view.getByRole("status").filter({ hasText: "已保存" }),
    ).toBeVisible();
    await capture(view, "article-editing");
    const original = await (
      await owner.request.get(ROOT + `/notes/${notes[1].id}`)
    ).json();
    expect(original.title).toBe("灵感采集与整理");
    expect(JSON.stringify(original.document)).toContain("编辑者补充");
  });
  await view.getByRole("button", { name: "返回阅读", exact: true }).click();
  await view
    .getByRole("button", { name: "社区文档更多操作", exact: true })
    .click();
  const download = view.waitForEvent("download");
  await view
    .getByRole("menuitem", { name: "导出可读文章 HTML", exact: true })
    .click();
  const file = await (await download).path();
  const files = unzipSync(await fs.readFile(file!));
  expect(
    Object.keys(files).filter((k) => k.startsWith("documents/")),
  ).toHaveLength(2);
  expect(strFromU8(files["index.html"])).not.toContain("个人草稿");
  expect(
    Object.keys(files).filter((k) => k.startsWith("assets/")),
  ).toHaveLength(1);
  await view.goto("/apps/thought-workshop/community");
  await view.getByLabel("搜索知识社区").fill("创作手记");
  const book = view.locator(".community-book").filter({ hasText: "创作手记" });
  await expect(book).toBeVisible();
  await book
    .getByRole("button", { name: "收藏 创作手记", exact: true })
    .click();
  await expect(
    book.getByRole("button", { name: "收藏 创作手记", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await view.goto("/apps/thought-workshop/favorites");
  await expect(
    view.locator(".community-book").filter({ hasText: "创作手记" }),
  ).toBeVisible();
  await view.goto(url + `/documents/${notes[2].id}`);
  await view
    .getByRole("button", { name: "社区文档更多操作", exact: true })
    .click();
  await view
    .getByRole("menuitem", { name: "文章访问权限", exact: true })
    .click();
  await capture(view, "article-manager");
  await view.keyboard.press("Escape");
  await view.goto(url + `/documents/${notes[1].id}`);
  await view.getByRole("button", { name: "编辑文档", exact: true }).click();
  const settings = await (
    await owner.request.get(
      COMM + `/publications/${pub}/permissions?note_id=${notes[1].id}`,
    )
  ).json();
  await write(
    owner,
    COMM + `/publications/${pub}/permissions`,
    {
      articles: [
        {
          note_id: notes[1].id,
          expected_revision: settings[0].revision,
          visibility: "public",
          members: [],
        },
      ],
    },
    "PUT",
  );
  await view
    .getByLabel("笔记标题", { exact: true })
    .fill("权限撤销后保留的草稿");
  await view
    .getByRole("button", { name: "社区文档更多操作", exact: true })
    .click();
  await view.getByRole("menuitem", { name: "保存", exact: true }).click();
  await expect(
    view.getByRole("alert").filter({ hasText: "不可访问" }),
  ).toBeVisible();
  await expect(view.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "权限撤销后保留的草稿",
  );
  await view.getByRole("button", { name: "返回知识社区", exact: true }).click();
  const backGuard = view.getByRole("alertdialog", {
    name: "仍有未保存的内容",
    exact: true,
  });
  await expect(backGuard).toBeVisible();
  await backGuard
    .getByRole("button", { name: "继续编辑", exact: true })
    .click();
  await expect(view.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "权限撤销后保留的草稿",
  );
  await view.getByRole("button", { name: "返回阅读", exact: true }).click();
  const leave = view.getByRole("alertdialog", {
    name: "仍有未保存的内容",
    exact: true,
  });
  await expect(leave).toBeVisible();
  await leave
    .getByRole("button", { name: "保留本机草稿并离开", exact: true })
    .click();
  await expect(view.getByLabel("笔记标题", { exact: true })).toHaveCount(0);
  await page.goto("/apps/thought-workshop/published");
  const managed = page
    .locator(".community-book")
    .filter({ hasText: "创作手记" });
  await managed
    .getByRole("button", { name: "创作手记 更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "管理发布", exact: true }).click();
  await expect(
    page.getByRole("alertdialog", { name: "发布到知识社区" }),
  ).toBeVisible();
  await capture(page, "withdraw-publication");
  await test.step("撤回发布并验证访客失去访问权限", async () => {
    await page
      .getByRole("button", { name: "撤回整个知识库", exact: true })
      .click();
    await expect(
      page.getByRole("alertdialog", { name: "发布到知识社区" }),
    ).toBeHidden();
    await view.reload();
    await expect(
      view.getByRole("alert").filter({ hasText: "不可访问" }),
    ).toBeVisible();
  });
  expect(errors).toEqual([]);
  await visitor.close();
});
