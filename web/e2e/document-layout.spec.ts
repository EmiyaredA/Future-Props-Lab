import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { saveNote } from "./thought-helpers";
import { setResponsiveTheme } from "./responsive-capture";
const ROOT = "/v1/thought-workshop";
async function write(
  context: BrowserContext,
  path: string,
  data: unknown,
  method = "POST",
) {
  const response = await context.request.fetch(path, {
    method,
    data,
    headers: {
      Origin: `http://127.0.0.1:${process.env.FPL_E2E_WEB_PORT || "3000"}`,
      "X-CSRF-Token":
        (await context.cookies()).find((c) => c.name === "fpl_csrf")?.value ||
        "",
    },
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}
async function capture(page: Page, name: string) {
  const directory = process.env.FPL_LAYOUT_PREVIEWS;
  if (!directory) return;
  await fs.mkdir(directory, { recursive: true });
  await page.locator(".document-card.is-featured").scrollIntoViewIfNeeded();
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
      const cards = page
        .locator(".document-card-grid")
        .first()
        .locator(".document-card");
      if ((await cards.count()) >= 2) {
        const first = await cards.nth(0).boundingBox();
        const second = await cards.nth(1).boundingBox();
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        if (width === 1600)
          expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
        if (width === 390) expect(second!.y).toBeGreaterThan(first!.y);
      }
      await page.screenshot({
        path: `${directory}/${name}-${width}-${theme}.png`,
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setResponsiveTheme(page, "light");
}
test("用户编辑官方同款首页、排序保存、发布与权限过滤", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/apps/thought-workshop");
  const owner = page.context();
  const library = await write(owner, ROOT + "/knowledge-bases", {
    title: "文档编排验收",
    description: "与官方文档共用目录和版式",
  });
  const notes = [];
  for (const title of ["入门与基本概念", "组件设计", "私人草稿"]) {
    const current = await (
      await owner.request.get(ROOT + `/knowledge-bases/${library.id}`)
    ).json();
    notes.push(
      await write(owner, ROOT + "/notes", {
        title,
        knowledge_base_id: library.id,
        expected_knowledge_revision: current.revision,
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: `${title}：保存后刷新检查正文和版本。` },
              ],
            },
          ],
        },
      }),
    );
  }
  await page.goto(`/apps/thought-workshop/knowledge-bases/${library.id}`);
  const body = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await body.click();
  await page.keyboard.type("/知识库首页");
  await page.getByRole("option", { name: /知识库首页/ }).click();
  await expect(page.locator(".document-card-node")).toHaveCount(3);
  for (const [index, note] of notes.entries()) {
    await page
      .locator(".document-card-node")
      .nth(index)
      .getByRole("button", { name: "选择文档", exact: true })
      .click();
    const picker = page.getByRole("alertdialog", { name: "选择卡片文档" });
    await picker
      .getByRole("textbox", { name: "搜索引用文档" })
      .fill(note.title);
    await picker
      .getByRole("button", {
        name: `${note.title} · 文档编排验收`,
        exact: true,
      })
      .click();
    await picker.getByRole("button", { name: "插入卡片", exact: true }).click();
    await expect(
      page
        .locator(".document-card-node")
        .nth(index)
        .locator(".document-card strong"),
    ).toHaveText(note.title);
  }
  await page
    .locator(".document-card-node")
    .nth(2)
    .getByRole("button", { name: "卡片上移", exact: true })
    .click();
  await saveNote(page);
  await expect
    .poll(async () => {
      const current = await (
        await owner.request.get(ROOT + `/notes/${library.home_note_id}`)
      ).json();
      return current.document.content
        .find((node: { type: string }) => node.type === "cardGrid")
        ?.content.map(
          (node: { attrs: { noteId: string } }) => node.attrs.noteId,
        );
    })
    .toEqual([notes[2].id, notes[1].id]);
  const source = await (
    await owner.request.get(ROOT + `/notes/${library.home_note_id}`)
  ).json();
  const grid = source.document.content.find(
    (node: { type: string }) => node.type === "cardGrid",
  );
  expect(
    grid.content.map(
      (node: { attrs: { noteId: string } }) => node.attrs.noteId,
    ),
  ).toEqual([notes[2].id, notes[1].id]);
  await capture(page, "homepage-edit");
  await page.reload();
  await expect(page.locator(".document-card.is-featured strong")).toHaveText(
    notes[0].title,
  );
  await expect(
    page
      .locator(".document-card-grid")
      .first()
      .locator(".document-card strong")
      .first(),
  ).toHaveText("私人草稿");
  await capture(page, "homepage-read");
  const config = await write(
    owner,
    ROOT + `/community/libraries/${library.id}/publication`,
    {
      expected_revision: 0,
      title: "文档编排验收",
      description: "正文自由编排",
      articles: [library.home_note_id, notes[0].id, notes[1].id].map((id) => ({
        note_id: id,
        expected_revision: 0,
        visibility: "public",
        members: [],
      })),
    },
    "PUT",
  );
  const username = `layout-${Date.now().toString().slice(-7)}`;
  const account = await write(owner, "/v1/platform/accounts", {
    username,
    display_name: "阅读者",
  });
  const visitor = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: { cookies: [], origins: [] },
  });
  await visitor.request.post("/v1/auth/login", {
    data: { username, password: account.temporary_password },
  });
  await write(visitor, "/v1/auth/change-password", {
    current_password: account.temporary_password,
    new_password: "Layout-Browser-2026!",
  });
  const view = await visitor.newPage();
  view.on("pageerror", (e) => errors.push(e.message));
  await view.goto(`/apps/thought-workshop/community/${config.publication.id}`);
  await expect(view.locator(".document-card.is-featured strong")).toHaveText(
    notes[0].title,
  );
  await expect(
    view.locator(".document-card-node").filter({ hasText: "文档不可访问" }),
  ).toHaveCount(1);
  await expect(view.getByText("私人草稿", { exact: true })).toHaveCount(0);
  await expect(
    view.getByRole("button", { name: "选择文档", exact: true }),
  ).toHaveCount(0);
  await capture(view, "homepage-community");
  await view
    .getByRole("button", { name: "社区文档更多操作", exact: true })
    .click();
  const downloadPromise = view.waitForEvent("download");
  await view
    .getByRole("menuitem", { name: "导出可读文章 HTML", exact: true })
    .click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = unzipSync(new Uint8Array(Buffer.concat(chunks)));
  const exportedHome = strFromU8(
    exported[`documents/${library.home_note_id}.html`],
  );
  expect(exportedHome).toContain("document-card-grid");
  expect(exportedHome).toContain("文档不可访问");
  expect(exportedHome).not.toContain("私人草稿");
  expect(exportedHome).not.toContain(notes[2].id);
  expect(exported[`documents/${notes[2].id}.html`]).toBeUndefined();
  const note = await (
    await owner.request.get(ROOT + `/notes/${notes[0].id}`)
  ).json();
  await write(
    owner,
    ROOT + `/notes/${note.id}`,
    {
      title: "入门与基本概念 · 更新",
      expected_revision: note.revision,
      document: note.document,
      knowledge_base_id: library.id,
      parent_id: note.parent_id,
      schema_version: note.schema_version,
      tags: note.tags,
      pinned: note.pinned,
      favorite: note.favorite,
    },
    "PUT",
  );
  await view.reload();
  await expect(view.locator(".document-card.is-featured strong")).toHaveText(
    "入门与基本概念 · 更新",
  );
  const requests: string[] = [];
  view.on("request", (r) => {
    if (
      new URL(r.url()).pathname.startsWith(ROOT + "/") &&
      !r.url().includes("/community/") &&
      !r.url().includes("/preferences/")
    )
      requests.push(r.url());
  });
  await view.reload();
  await expect(
    view.locator(".document-directory-node .document-card"),
  ).toHaveCount(2);
  expect(requests).toEqual([]);
  await visitor.close();
  await page.goto(`/apps/thought-workshop/knowledge-bases/${library.id}`);
  await page
    .getByRole("button", { name: "新建文档", exact: true })
    .filter({ has: page.locator('[aria-hidden="true"]') })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "从模板新建", exact: true }).click();
  const template = page.getByRole("alertdialog", {
    name: "Workspace 文档模板",
  });
  await template
    .getByRole("combobox", { name: "选择文档模板", exact: true })
    .click();
  await page
    .getByRole("option", { name: "知识库首页（内置）", exact: true })
    .click();
  await template
    .getByRole("textbox", { name: "模板名称", exact: true })
    .fill("模板创建的首页");
  await template
    .getByRole("button", { name: "从模板创建文档", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/knowledge-bases/${library.id}/documents/`),
  );
  const templateId = new URL(page.url()).pathname.split("/").pop();
  const templated = await (
    await owner.request.get(ROOT + `/notes/${templateId}`)
  ).json();
  expect(templated.title).toBe("模板创建的首页");
  expect(
    templated.document.content.some(
      (node: { type: string }) => node.type === "cardGrid",
    ),
  ).toBeTruthy();
  const published = await (
    await owner.request.get(
      ROOT + `/community/publications/${config.publication.id}`,
    )
  ).json();
  expect(
    published.documents.some((node: { id: string }) => node.id === templateId),
  ).toBeFalsy();
  await page.goto("/apps/thought-workshop/official-knowledge-bases/general");
  await expect(
    page.getByRole("navigation", { name: "官方文档目录" }).locator("h2"),
  ).toHaveCount(0);
  await capture(page, "homepage-official");
  expect(errors).toEqual([]);
});
