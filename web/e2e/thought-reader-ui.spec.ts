import { expect, test } from "@playwright/test";
import {
  importAndPublish,
  legacyTarget,
  root,
  community,
  write,
} from "./official-import-helpers";
import { setResponsiveTheme } from "./responsive-capture";

// Real published notes in a temporary deployment, never production desktop data.
test("shared reader matches the warm layout in both themes and all viewport sizes", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await page.goto("/apps/thought-workshop/community");
  const { publication, home } = await importAndPublish(
    page,
    "galgame-workshop",
  );
  await page.goto(`/apps/thought-workshop/community/${publication.id}`);
  const article = page.getByRole("textbox", { name: "笔记正文", exact: true });
  const header = page.locator(".knowledge-topbar");
  await expect(article).toHaveAttribute("contenteditable", "false");
  await expect(page.locator(".document-card.is-featured strong")).toHaveText(
    "功能概览与快速开始",
  );
  await expect(header.getByRole("button", { name: "文内查找" })).toBeVisible();
  await expect(page.locator(".thought-document-tools")).toHaveCount(0);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      /\/notes\/|\/documents\//.test(request.url())
    )
      writes.push(request.url());
  });
  await article.evaluate((node) => {
    node.dataset.readerInstance = "stable";
  });
  for (const width of [1600, 1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 900 : 1000 });
    for (const theme of ["light", "dark"] as const) {
      await setResponsiveTheme(page, theme);
      await page.locator(".knowledge-main").evaluate((node) => {
        node.scrollTop = 0;
      });
      await expect(article).toHaveAttribute("data-reader-instance", "stable");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth <= innerWidth + 1 &&
              Array.from(
                document.querySelectorAll<HTMLElement>(".knowledge-main"),
              ).every((el) => el.scrollWidth <= el.clientWidth + 1),
          ),
        )
        .toBe(true);
      if (width >= 1024) {
        const outline = page.getByRole("navigation", { name: "文档章节" });
        await expect(outline).toBeVisible();
        const bounds = (await outline.boundingBox())!;
        const prose = (await article.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(prose.x + prose.width);
      } else {
        await header.getByRole("button", { name: "文档大纲" }).click();
        const popup = page.getByRole("dialog", { name: "文档大纲" });
        await expect(popup).toBeVisible();
        const bounds = (await popup.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(12);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 12);
        await page.keyboard.press("Escape");
        await expect(
          header.getByRole("button", { name: "文档大纲" }),
        ).toBeFocused();
      }
      await page.screenshot({
        path: info.outputPath(`community-${width}-${theme}.png`),
        animations: "disabled",
      });
    }
  }
  await header.getByRole("button", { name: "文内查找" }).click();
  await page.getByRole("textbox", { name: "查找文本" }).fill("角色");
  await expect(page.getByRole("search", { name: "文内查找" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(writes).toEqual([]);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setResponsiveTheme(page, "light");
  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  await expect(article).toHaveAttribute("contenteditable", "true");
  await expect(
    page.getByRole("navigation", { name: "文档章节" }),
  ).toBeVisible();
  await expect(header.getByRole("button", { name: "文内查找" })).toBeVisible();
  await header.getByRole("button", { name: "正文工具", exact: true }).click();
  await page.getByRole("menuitem", { name: "查找替换", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "替换文本" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: info.outputPath("community-edit-light.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "返回阅读", exact: true }).click();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  const current = await (
    await page.request.get(
      community + `/publications/${publication.id}/notes/${home}`,
    )
  ).json();
  // The next assertions use the private source note via its ordinary API.
  expect(current.note.id).toBe(home);
  await page.goto(
    `/apps/thought-workshop/knowledge-bases/${current.note.knowledge_base_id}`,
  );
  await page.getByRole("button", { name: "返回阅读", exact: true }).click();
  await expect(article).toHaveAttribute("contenteditable", "false");
  await expect(header.getByRole("button", { name: "文内查找" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "文档章节" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("private-home-light.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  await expect(article).toHaveAttribute("contenteditable", "true");
  await expect(header.getByRole("button", { name: "文内查找" })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("private-home-edit-light.png"),
    animations: "disabled",
  });
});

test("outline and menu changes preserve diagram instances and zoom", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/apps/thought-workshop/community");
  const { publication } = await importAndPublish(page, "technical");
  const target = await legacyTarget(
    page,
    "technical",
    "thought-workshop",
    publication.id,
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    `/apps/thought-workshop/community/${publication.id}/documents/${target.note_id}`,
  );
  const figure = page
    .locator(".diagram-viewer")
    .filter({ has: page.locator("svg[role='img']") })
    .first();
  await expect(figure).toBeVisible();
  const svg = await figure.locator("svg[role='img']").elementHandle();
  await figure.getByRole("button", { name: "放大图表", exact: true }).click();
  await expect(figure.locator(".diagram-paper")).toHaveAttribute(
    "style",
    "width: 125%;",
  );
  const header = page.locator(".knowledge-topbar");
  await header.getByRole("button", { name: "社区文档更多操作" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "收起文档大纲" }).click();
  await page.setViewportSize({ width: 768, height: 1000 });
  await header.getByRole("button", { name: "文档大纲" }).click();
  await page.keyboard.press("Escape");
  await setResponsiveTheme(page, "dark");
  await expect(figure.locator(".diagram-paper")).toHaveAttribute(
    "style",
    "width: 125%;",
  );
  expect(await page.evaluate((element) => element?.isConnected, svg)).toBe(
    true,
  );
});

test("private read-only readers preserve a nested document tree", async ({
  page,
}) => {
  await page.goto("/apps/thought-workshop");
  const library = await write(page, root + "/knowledge-bases", {
    title: "多级文档树验收",
  });
  let parent: string | null = null;
  const ids: string[] = [];
  for (const title of ["父文档", "子文档", "孙文档"]) {
    const current = await (
      await page.request.get(root + `/knowledge-bases/${library.id}`)
    ).json();
    const note = await write(page, root + "/notes", {
      title,
      knowledge_base_id: library.id,
      parent_id: parent,
      expected_knowledge_revision: current.revision,
      document: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "章节" }],
          },
        ],
      },
    });
    ids.push(note.id);
    parent = note.id;
  }
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.workspace.permission_keys = ["content.read"];
    await route.fulfill({ json: body });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    `/apps/thought-workshop/knowledge-bases/${library.id}/documents/${ids[2]}`,
  );
  const tree = page.getByRole("navigation", {
    name: "知识库目录",
    exact: true,
  });
  await expect(
    tree.getByRole("button", { name: "孙文档", exact: true }),
  ).toBeVisible();
  const rows = await tree
    .locator(".knowledge-tree-row")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).style.paddingLeft),
    );
  expect(new Set(rows).size).toBe(3);
  await expect(
    page.getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toHaveAttribute("contenteditable", "false");
});
