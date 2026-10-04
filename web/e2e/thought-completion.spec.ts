import { importAndPublish, legacyTarget } from "./official-import-helpers";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import {
  openNoteHistory,
  saveNote,
  pickNoteMore,
  pickProjectMore,
} from "./thought-helpers";

const root = "/v1/thought-workshop";
async function fixture(page: Page, count = 1) {
  await page.goto("/apps/thought-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const response = await page.request.post(root + "/knowledge-bases", {
    headers,
    data: { title: `补齐验收 ${Date.now()}` },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const project = await response.json(),
    notes = [];
  for (let i = 0; i < count; i++) {
    const created = await page.request.post(root + "/notes", {
      headers,
      data: {
        knowledge_base_id: project.id,
        expected_knowledge_revision: project.revision + i,
        title: `分页文档 ${i.toString().padStart(3, "0")}`,
        schema_version: 3,
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "正文中的唯一检索词与测试文本。" },
              ],
            },
          ],
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    notes.push(await created.json());
  }
  return { project, notes, headers };
}

test("all 105 results are reachable and switching filters resets pages", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { project } = await fixture(page, 105);
  await page.goto(`/apps/thought-workshop/knowledge-bases/${project.id}`);
  await page
    .getByRole("textbox", { name: "搜索当前知识库", exact: true })
    .fill("分页文档");
  await expect(page.locator(".knowledge-filtered > li")).toHaveCount(40);
  await page.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect(page.locator(".knowledge-filtered > li")).toHaveCount(80);
  await page.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect(page.locator(".knowledge-filtered > li")).toHaveCount(105);
  await page
    .getByRole("textbox", { name: "搜索当前知识库", exact: true })
    .fill("分页文档 000");
  await expect(page.locator(".knowledge-filtered > li")).toHaveCount(1);
  await expect(page.locator(".knowledge-filtered")).toContainText(
    "分页文档 000",
  );
});

test("IndexedDB retains failed edits across reload and protects changed baselines", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { project, notes, headers } = await fixture(page);
  const note = notes[0],
    url = `/apps/thought-workshop/knowledge-bases/${project.id}/documents/${note.id}`;
  await page.goto(url);
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await expect(prose).toBeEditable();
  await page.route(`**/v1/thought-workshop/notes/${note.id}`, (route) =>
    route.request().method() === "PUT" ? route.abort() : route.fallback(),
  );
  await prose.fill("崩溃刷新后也要保留的本机草稿。");
  await saveNote(page);
  await expect(page.getByRole("alert")).toContainText(/失败|网络|fetch/i);
  // A concurrent authorized API edit creates a genuinely different baseline.
  const changed = await page.request.put(root + "/notes/" + note.id, {
    headers,
    data: {
      ...Object.fromEntries(
        [
          "title",
          "knowledge_base_id",
          "parent_id",
          "document",
          "schema_version",
          "tags",
          "favorite",
          "pinned",
        ].map((k) => [k, note[k]]),
      ),
      title: "服务端最新标题",
      expected_revision: note.revision,
    },
  });
  expect(changed.ok(), await changed.text()).toBe(true);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(
    page.getByRole("button", { name: "恢复草稿", exact: true }),
  ).toBeVisible();
  await expect(prose).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "请选择本机草稿的恢复方式" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看服务端", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "服务端最新标题", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(prose).toContainText("崩溃刷新后也要保留");
  await expect(
    page.getByText("草稿基准版本已变化", { exact: false }),
  ).toBeVisible();
  await page.unroute(`**/v1/thought-workshop/notes/${note.id}`);
  await page.getByRole("button", { name: "另存本地副本", exact: true }).click();
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    /本地副本/,
  );
  await expect(prose).toContainText("崩溃刷新后也要保留");
});

test("each tab keeps its own failed draft and saving one leaves the other recoverable", async ({
  page,
  context,
}) => {
  const { project, notes } = await fixture(page);
  const id = notes[0].id,
    url = `/apps/thought-workshop/knowledge-bases/${project.id}/documents/${id}`;
  await page.goto(url);
  const second = await context.newPage();
  await second.goto(url);
  for (const tab of [page, second]) {
    await expect(
      tab.getByRole("textbox", { name: "笔记正文", exact: true }),
    ).toBeEditable();
    await tab.route(`**/v1/thought-workshop/notes/${id}`, (route) =>
      route.request().method() === "PUT" ? route.abort() : route.fallback(),
    );
  }
  await page
    .getByLabel("笔记标题", { exact: true })
    .fill("标签页甲的未保存草稿");
  await saveNote(page);
  await second
    .getByLabel("笔记标题", { exact: true })
    .fill("标签页乙的未保存草稿");
  await saveNote(second);
  const records = () =>
    page.evaluate(async (noteId) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("fpl-thought-drafts", 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<
          { noteId: string; tabId: string; body: { title: string } }[]
        >((resolve, reject) => {
          const request = db
            .transaction("drafts", "readonly")
            .objectStore("drafts")
            .getAll();
          request.onsuccess = () =>
            resolve(
              request.result.filter(
                (row: { noteId: string }) => row.noteId === noteId,
              ),
            );
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    }, id);
  await expect.poll(async () => (await records()).length).toBe(2);
  expect(new Set((await records()).map((row) => row.tabId)).size).toBe(2);
  await second.close();
  await page.unroute(`**/v1/thought-workshop/notes/${id}`);
  await saveNote(page);
  await expect
    .poll(async () => (await records()).map((row) => row.body.title))
    .toEqual(["标签页乙的未保存草稿"]);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(
    page.getByRole("button", { name: "恢复草稿", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".thought-conflict")).toContainText(
    "标签页乙的未保存草稿",
  );
});

test("whole library HTML contains relative navigation, references, offline math and canvas", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const { project, notes, headers } = await fixture(page, 2);
  const note = notes[0];
  const imageResponse = await page.request.post(root + "/images", {
    headers,
    multipart: {
      upload: {
        name: "fixture.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGN8Wh3JQApgIkk1w6gG4gATkergYFQDMYDkUAIAeAUB2WkfhqEAAAAASUVORK5CYII=",
          "base64",
        ),
      },
    },
  });
  expect(imageResponse.ok(), await imageResponse.text()).toBe(true);
  const image = await imageResponse.json();
  const attachmentResponse = await page.request.post(root + "/attachments", {
    headers,
    multipart: {
      upload: {
        name: "offline.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("离线附件正文"),
      },
    },
  });
  expect(attachmentResponse.ok(), await attachmentResponse.text()).toBe(true);
  const attachment = await attachmentResponse.json();
  const updated = await page.request.put(root + "/notes/" + note.id, {
    headers,
    data: {
      ...Object.fromEntries(
        [
          "title",
          "knowledge_base_id",
          "parent_id",
          "schema_version",
          "tags",
          "favorite",
          "pinned",
        ].map((k) => [k, note[k]]),
      ),
      expected_revision: note.revision,
      document: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { assetId: image.asset_id, alt: "离线图片" },
          },
          {
            type: "attachment",
            attrs: {
              assetId: attachment.asset_id,
              filename: attachment.filename,
              mimeType: attachment.mime_type,
              byteSize: attachment.byte_size,
            },
          },
          {
            type: "paragraph",
            content: [
              {
                type: "documentReference",
                attrs: {
                  kind: "note",
                  noteId: notes[1].id,
                  label: notes[1].title,
                },
              },
              { type: "inlineMath", attrs: { latex: "x^2" } },
            ],
          },
          {
            type: "callout",
            attrs: { variant: "warning" },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "离线提示块" }],
              },
            ],
          },
          {
            type: "canvas",
            attrs: {
              scene: {
                sceneVersion: 2,
                title: "离线画板",
                elements: [
                  {
                    id: "shape",
                    kind: "rounded",
                    x: 10000,
                    y: -1000,
                    width: 160,
                    height: 80,
                    text: "离线图形",
                    fill: "#ffffff",
                    stroke: "#365f62",
                    fontSize: 18,
                    textAlign: "center",
                  },
                ],
                edges: [],
              },
            },
          },
          { type: "mermaid", attrs: { source: "graph TD; A[离线]-->B[阅读]" } },
        ],
      },
    },
  });
  expect(updated.ok(), await updated.text()).toBe(true);
  await page.goto(`/apps/thought-workshop/knowledge-bases/${project.id}`);
  const download = page.waitForEvent("download");
  await pickProjectMore(page, "导出整库 HTML");
  const path = await (await download).path();
  const files = unzipSync(new Uint8Array(await readFile(path!)));
  const html = strFromU8(files[`documents/${note.id}.html`]);
  expect(html).toContain(`href="${notes[1].id}.html"`);
  expect(html).toContain("<math");
  expect(html).toContain("离线图形");
  expect(html).toContain("<svg");
  expect(html).toContain("离线提示块");
  expect(html).not.toMatch(/<script|blob:|\/v1\//);
  expect(strFromU8(files[`assets/${attachment.asset_id}`])).toBe(
    "离线附件正文",
  );
  // Serve only bytes from the archive; every other request is refused.
  const offline = await context.newPage();
  await offline.route("**/*", (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (files[name])
      return route.fulfill({
        body: Buffer.from(files[name]),
        contentType:
          name === `assets/${image.asset_id}` ? "image/png" : "text/html",
      });
    return route.abort();
  });
  await offline.goto("http://offline.invalid/index.html");
  await offline.getByRole("link", { name: note.title, exact: true }).click();
  await expect(
    offline.getByRole("heading", { name: note.title, exact: true }),
  ).toBeVisible();
  await expect(
    offline.getByRole("img", { name: "离线图片", exact: true }),
  ).toBeVisible();
  expect(
    await offline
      .getByRole("img", { name: "离线图片", exact: true })
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBe(16);
  await expect(
    offline.getByRole("link", { name: /offline.txt/ }),
  ).toHaveAttribute("href", `../assets/${attachment.asset_id}`);
  await offline
    .getByRole("link", { name: notes[1].title, exact: true })
    .click();
  await expect(
    offline.getByRole("heading", { name: notes[1].title, exact: true }),
  ).toBeVisible();
  await offline.close();
});

test("official articles retain ordinary community reading position after refresh", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { publication } = await importAndPublish(page, "technical");
  const target = await legacyTarget(
    page,
    "technical",
    "thought-workshop",
    publication.id,
  );
  const me = await (await page.request.get("/v1/auth/me")).json();
  const resourceId = `community/${me.user.id}/${publication.id}/${target.note_id}`;
  const key = `fpl-reading:${me.user.id}:${resourceId}`;
  const url = `/apps/thought-workshop/community/${publication.id}/documents/${target.note_id}`;
  const reading = () =>
    page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
      key,
    );
  await page.goto(url);
  await expect(page.locator(".thought-prose")).toBeVisible();
  await expect
    .poll(async () => (await reading())?.position?.ratio)
    .toBeDefined();
  await page.locator(".knowledge-main").evaluate((main) => {
    main.scrollTop = main.scrollHeight / 2;
  });
  await expect
    .poll(async () => (await reading())?.position?.ratio ?? 0)
    .toBeGreaterThan(0.2);
  const before = (await reading()).position.ratio;
  await page.reload();
  await expect(page.locator(".thought-prose")).toBeVisible();
  await expect
    .poll(async () =>
      page
        .locator(".knowledge-main")
        .evaluate(
          (main) =>
            main.scrollTop / Math.max(1, main.scrollHeight - main.clientHeight),
        ),
    )
    .toBeGreaterThan(before / 2);
});

test("reference, find replacement, templates, copies and named history connect in the editor", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const { project, notes } = await fixture(page, 2);
  await page.goto(
    `/apps/thought-workshop/knowledge-bases/${project.id}/documents/${notes[0].id}`,
  );
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await expect(prose).toHaveAttribute("contenteditable", "true");
  await prose.press("ControlOrMeta+End");
  await prose.pressSequentially(" @");
  const picker = page.getByRole("alertdialog", {
    name: "引用文档",
    exact: true,
  });
  await expect(picker).toBeVisible();
  await picker.getByLabel("搜索引用文档", { exact: true }).fill(notes[1].title);
  await picker
    .getByRole("button", {
      name: `${notes[1].title} · ${project.title}`,
      exact: true,
    })
    .click();
  await picker.getByRole("button", { name: "插入引用", exact: true }).click();
  await expect(prose.locator(".thought-reference a")).toContainText(
    notes[1].title,
  );
  await prose.press("ControlOrMeta+End");
  await prose.press("Enter");
  await prose.pressSequentially("/");
  await page
    .locator(".thought-insert-menu")
    .getByRole("option", { name: /提示块/ })
    .click();
  await expect(prose.locator(".thought-callout")).toBeVisible();
  await prose.press("ControlOrMeta+h");
  await page.getByLabel("查找文本", { exact: true }).fill("测试文本");
  await page.getByLabel("替换文本", { exact: true }).fill("查找替换完成");
  await page.getByRole("button", { name: "全部替换", exact: true }).click();
  await expect(prose).toContainText("查找替换完成");
  await page.getByRole("button", { name: "关闭查找", exact: true }).click();
  await saveNote(page);
  await page
    .getByRole("button", { name: "新建文档", exact: true })
    .last()
    .click();
  await page.getByRole("menuitem", { name: "从模板新建", exact: true }).click();
  const templates = page.getByRole("alertdialog", {
    name: "Workspace 文档模板",
    exact: true,
  });
  await templates
    .getByRole("button", { name: "将当前文档存为模板", exact: true })
    .click();
  const name = page.getByRole("dialog", { name: "保存文档模板", exact: true });
  await name.getByRole("textbox").fill("编辑器复用模板");
  await name.getByRole("button", { name: "确认", exact: true }).click();
  await expect(templates.getByLabel("模板名称", { exact: true })).toHaveValue(
    "编辑器复用模板",
  );
  await templates
    .getByRole("button", { name: "从模板创建文档", exact: true })
    .click();
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "编辑器复用模板",
  );
  await pickNoteMore(page, "复制文档 / 子树");
  await page
    .getByRole("alertdialog", { name: /复制「编辑器复用模板」/ })
    .getByRole("button", { name: "创建副本", exact: true })
    .click();
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "编辑器复用模板（副本）",
  );
  await openNoteHistory(page);
  await page.getByRole("button", { name: "命名此快照", exact: true }).click();
  const snapshot = page.getByRole("dialog", {
    name: "命名历史快照",
    exact: true,
  });
  await snapshot.getByLabel("快照名称", { exact: true }).fill("浏览器交付版");
  await snapshot.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "浏览器交付版", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("named-history.png"),
    fullPage: true,
  });
});
