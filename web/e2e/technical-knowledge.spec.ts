import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { TECHNICAL_LIBRARY } from "../src/features/thought-workshop/official/technicalCatalog";
import { newDocument, pickNoteMore, saveNote } from "./thought-helpers";
import { setResponsiveTheme } from "./responsive-capture";

const root = "/apps/thought-workshop/official-knowledge-bases/technical";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGN8Wh3JQApgIkk1w6gG4gATkergYFQDMYDkUAIAeAUB2WkfhqEAAAAASUVORK5CYII=",
  "base64",
);
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  await info.attach("browser-errors", {
    body: (browserErrors.get(page) || []).join("\n"),
    contentType: "text/plain",
  });
  const id = page.url().match(/\/(?:documents|notes)\/([^/?#]+)/)?.[1];
  if (id && !page.url().includes("official-knowledge-bases")) {
    const response = await page.request.get(`/v1/thought-workshop/notes/${id}`);
    await info.attach("saved-note", {
      body: await response.body(),
      contentType: "application/json",
    });
  }
});
async function choose(page: Page, name: string, value: string) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
async function copyFigure(
  page: Page,
  kind: "canvas" | "mermaid",
  library: string,
) {
  await page
    .locator(".diagram-viewer")
    .filter({
      has: page.locator(
        kind === "canvas" ? "svg[role=img]" : ".thought-mermaid-preview",
      ),
    })
    .getByRole("button", { name: "复制到个人笔记", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "复制到个人笔记",
    exact: true,
  });
  await choose(page, "目标知识库", library);
  await dialog.getByRole("button", { name: "创建副本", exact: true }).click();
  await expect(page.getByLabel("笔记标题", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toContainText("来源：官方技术原理");
}

test("all 22 technical articles render their bundled UML and canvas without write requests", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/v1/thought-workshop/") &&
      !["GET", "HEAD"].includes(request.method())
    )
      writes.push(request.url());
  });
  await page.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.fallback()
      : route.abort(),
  );
  for (const document of TECHNICAL_LIBRARY.documents) {
    await page.goto(`${root}/documents/${document.id}`);
    const article = page.getByRole("article", { name: "官方文档正文" });
    await expect(article).toBeVisible();
    await expect(article.locator(".thought-mermaid-preview svg")).toBeVisible({
      timeout: 20_000,
    });
    await expect(article.locator(".diagram-viewer svg[role=img]")).toHaveCount(
      1,
    );
    await expect(article.getByText("图表语法有误，请编辑源码")).toHaveCount(0);
    await expect(
      article.getByRole("button", { name: "复制到个人笔记", exact: true }),
    ).toHaveCount(2);
  }
  await page.goto(root);
  await page
    .locator(".official-article-cards")
    .getByRole("button", {
      name: new RegExp(TECHNICAL_LIBRARY.documents[0].title),
    })
    .click();
  await expect(page).toHaveURL(`${root}/documents/system`);
  await page
    .getByRole("navigation", { name: "官方文档目录" })
    .getByRole("button", {
      name: TECHNICAL_LIBRARY.documents[1].title,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(`${root}/documents/modules`);
  await page.reload();
  await expect(page.locator(".thought-mermaid-preview svg")).toBeVisible();
  expect(writes).toEqual([]);
});

test("official UML and canvas copies remain editable personal notes after refresh", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/thought-workshop");
  const library = `技术副本 ${Date.now()}`;
  await page.getByRole("button", { name: "创建知识库", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(library);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "编辑首页", exact: true }),
  ).toBeVisible();
  await page.goto(`${root}/documents/system`);
  await expect(
    page.getByRole("button", { name: "复制到个人笔记", exact: true }),
  ).toHaveCount(2);
  const copyCanvas = page
    .locator(".diagram-viewer")
    .filter({ has: page.locator("svg[role=img]") })
    .getByRole("button", { name: "复制到个人笔记", exact: true });
  await copyCanvas.click();
  await page
    .getByRole("dialog", { name: "复制到个人笔记", exact: true })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(copyCanvas).toBeFocused();
  await copyFigure(page, "canvas", library);
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑画板", exact: true });
  const viewWrites: string[] = [];
  const recordWrite = (request: import("@playwright/test").Request) => {
    if (
      request.method() === "PUT" &&
      request.url().includes("/thought-workshop/notes/")
    )
      viewWrites.push(request.url());
  };
  page.on("request", recordWrite);
  await editor.locator(".react-flow__node").first().click();
  await editor.locator(".react-flow__controls-zoomin").click();
  await editor.locator(".react-flow__controls-fitview").click();
  // Watch through one complete autosave debounce: view state must never save.
  await page.waitForTimeout(1200);
  expect(viewWrites).toEqual([]);
  page.off("request", recordWrite);
  await editor.getByLabel("画板标题", { exact: true }).fill("我自己的系统架构");
  await choose(page, "添加图形", "菱形");
  await editor.getByRole("button", { name: "返回笔记", exact: true }).click();
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "我自己的系统架构", exact: true }),
  ).toBeVisible();
  await page.goto(`${root}/documents/system`);
  await expect(
    page.getByRole("button", { name: "复制到个人笔记", exact: true }),
  ).toHaveCount(2);
  await copyFigure(page, "mermaid", library);
  await expect(
    page.getByRole("button", { name: "编辑图表", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "编辑图表", exact: true }).click();
  await page
    .getByLabel("Mermaid 源码")
    .fill("flowchart LR\n  A[个人副本] --> B[保存成功]");
  await expect(page.locator(".thought-mermaid-preview svg")).toContainText(
    "个人副本",
  );
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".thought-mermaid-preview svg")).toContainText(
    "个人副本",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 SVG", exact: true }).click();
  expect(await fs.readFile((await (await download).path())!, "utf8")).toContain(
    "个人副本",
  );
});

test("read-only technical figures stay readable offline across themes and viewport sizes", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const principal = await response.json();
    principal.workspace.permission_keys = ["content.read"];
    await route.fulfill({ response, json: principal });
  });
  await page.goto(`${root}/documents/system`);
  await expect(page.locator(".thought-mermaid-preview svg")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "复制到个人笔记", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "编辑画板", exact: true }),
  ).toHaveCount(0);
  for (const width of [1600, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await setResponsiveTheme(page, theme);
      await page.locator(".diagram-viewer").first().scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`technical-${width}-${theme}.png`),
      });
    }
  }
  const enlarge = page
    .getByRole("button", { name: "放大阅读", exact: true })
    .first();
  await enlarge.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(enlarge).toBeFocused();
  await page.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.fallback()
      : route.abort(),
  );
  await page.goto(`${root}/documents/tasks`);
  await expect(page.locator(".thought-mermaid-preview svg")).toBeVisible();
});

test("personal canvas inserts, saves managed images, and exports portable editable packages", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await prose.fill("信息图验收");
  await prose.press("End");
  await prose.press("Enter");
  await prose.pressSequentially("/");
  const insertCanvas = page
    .locator(".thought-insert-menu")
    .getByRole("option", { name: /画板/ });
  await expect(insertCanvas).toBeVisible();
  await insertCanvas.click();
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑画板", exact: true });
  await choose(page, "替换画板模板", "系统架构");
  await editor.getByRole("button", { name: "应用模板", exact: true }).click();
  await expect(editor.locator(".react-flow__node")).toHaveCount(3);
  await editor.locator(".react-flow__node").nth(0).click();
  await editor.getByLabel("图形文字", { exact: true }).fill("用户入口");
  const firstNode = editor.locator(".react-flow__node").nth(0);
  await firstNode.click();
  const beforeMove = await firstNode.getAttribute("style");
  await firstNode.press("ArrowRight");
  await expect(firstNode).not.toHaveAttribute("style", beforeMove!);
  await firstNode.press("Delete");
  await expect(editor.locator(".react-flow__node")).toHaveCount(2);
  await editor.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor.locator(".react-flow__node")).toHaveCount(3);
  await editor.locator(".react-flow__node").nth(0).click();
  await editor
    .locator(".react-flow__node")
    .nth(1)
    .click({ modifiers: ["Shift"] });
  await expect(editor.locator(".react-flow__node.selected")).toHaveCount(2);
  await editor.getByRole("button", { name: "分组", exact: true }).click();
  await expect(editor.locator(".react-flow__node")).toHaveCount(4);
  await editor.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor.locator(".react-flow__node")).toHaveCount(3);
  await choose(page, "添加图形", "椭圆");
  await expect(editor.locator(".react-flow__node")).toHaveCount(4);
  await editor.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor.locator(".react-flow__node")).toHaveCount(3);
  await editor.getByRole("button", { name: "重做", exact: true }).click();
  await expect(editor.locator(".react-flow__node")).toHaveCount(4);
  await editor
    .locator('input[type="file"]')
    .setInputFiles({ name: "canvas.png", mimeType: "image/png", buffer: png });
  await expect(editor.locator(".react-flow__node image")).toHaveCount(1);
  await editor.getByLabel("画板标题", { exact: true }).fill("可移植信息图");
  for (const theme of ["light", "dark"]) {
    await setResponsiveTheme(page, theme);
    await page.screenshot({
      path: info.outputPath(`canvas-editor-desktop-${theme}.png`),
    });
  }
  await editor.getByRole("button", { name: "返回笔记", exact: true }).click();
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  const savedCanvasNote = await (
    await page.request.get(
      `/v1/thought-workshop/notes/${page.url().split("/").pop()!}`,
    )
  ).json();
  const savedCanvas = savedCanvasNote.document.content.find(
    (node: { type: string }) => node.type === "canvas",
  ).attrs.scene;
  expect(
    savedCanvas.elements.find(
      (element: { text: string }) => element.text === "用户入口",
    ).x,
  ).toBe(50);
  await page.reload();
  await expect(prose.locator(".thought-canvas svg image")).toHaveCount(1);
  for (const format of ["SVG", "PNG"]) {
    const pending = page.waitForEvent("download");
    await page
      .getByRole("button", { name: `导出 ${format}`, exact: true })
      .click();
    const data = await fs.readFile((await (await pending).path())!);
    if (format === "SVG")
      expect(data.toString()).toContain("data:image/png;base64,");
    else expect(data.subarray(1, 4).toString()).toBe("PNG");
  }
  const htmlDownload = page.waitForEvent("download");
  await pickNoteMore(page, "导出 HTML 离线阅读");
  const html = await fs.readFile((await (await htmlDownload).path())!, "utf8");
  expect(html).toContain("<svg");
  expect(html).toContain("data:image/png;base64,");
  const mdDownload = page.waitForEvent("download");
  await pickNoteMore(page, "导出 Markdown");
  await page.getByRole("button", { name: "继续导出", exact: true }).click();
  const zip = await fs.readFile((await (await mdDownload).path())!);
  const files = unzipSync(zip);
  const markdown = strFromU8(
    files[Object.keys(files).find((key) => key.endsWith(".md"))!],
  );
  expect(markdown).toContain("```fpl-canvas");
  expect(Object.keys(files).some((key) => key.startsWith("assets/"))).toBe(
    true,
  );
  const imported = page.waitForResponse(
    (response) =>
      response.url().includes("/thought-workshop/imports") &&
      response.request().method() === "POST",
  );
  await page
    .locator('input[type="file"][accept=".zip,.md,.markdown"]')
    .setInputFiles({
      name: "canvas-roundtrip.zip",
      mimeType: "application/zip",
      buffer: zip,
    });
  const response = await imported;
  expect(response.ok(), await response.text()).toBe(true);
  const id = (await response.json()).note_ids[0];
  await page.goto(`/apps/thought-workshop/notes/${id}`);
  await expect(page.locator(".thought-canvas svg image")).toHaveCount(1);
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  await expect(editor.getByLabel("画板标题", { exact: true })).toHaveValue(
    "可移植信息图",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await editor.locator(".react-flow__controls-fitview").click();
  for (const theme of ["light", "dark"]) {
    await setResponsiveTheme(page, theme);
    const fit = editor.locator(".react-flow__controls-fitview");
    await fit.hover();
    const contrast = await fit.evaluate((element) => {
      const style = getComputedStyle(element);
      const luminance = (value: string) => {
        const rgb = value
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((channel) => {
            const linear = channel / 255;
            return linear <= 0.04045
              ? linear / 12.92
              : ((linear + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const fg = luminance(style.color),
        bg = luminance(style.backgroundColor);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(3);
    await page.screenshot({
      path: info.outputPath(`canvas-editor-mobile-${theme}.png`),
    });
  }
});

async function seedCanvas(page: Page, count: number) {
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  const id = page.url().split("/").pop()!;
  const endpoint = `/v1/thought-workshop/notes/${id}`;
  const note = await (await page.request.get(endpoint)).json();
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const scene = {
    sceneVersion: 1,
    title: "隔离测试画板",
    elements: Array.from({ length: count }, (_, i) => ({
      id: `node-${i}`,
      kind: "rounded",
      x: (i % 10) * 220,
      y: Math.floor(i / 10) * 120,
      width: 180,
      height: 80,
      text: `模块 ${i + 1}`,
      fill: "#eef5f3",
      stroke: "#365f62",
    })),
    edges: Array.from({ length: count - 1 }, (_, i) => ({
      id: `edge-${i}`,
      source: `node-${i}`,
      target: `node-${i + 1}`,
      label: "",
      arrow: true,
      style: "step",
    })),
  };
  const response = await page.request.put(endpoint, {
    headers,
    data: {
      title: "画板隔离验收",
      knowledge_base_id: note.knowledge_base_id,
      parent_id: null,
      schema_version: 2,
      document: {
        type: "doc",
        content: [{ type: "canvas", attrs: { scene } }, { type: "paragraph" }],
      },
      tags: [],
      pinned: false,
      favorite: false,
      expected_revision: note.revision,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "编辑画板", exact: true }),
  ).toBeVisible();
  return { id, endpoint, headers };
}

test("canvas failures and real revision conflicts preserve drafts and guard navigation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { id, endpoint, headers } = await seedCanvas(page, 3);
  await page.route(`**${endpoint}`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500, json: { detail: "隔离测试保存失败" } })
      : route.continue(),
  );
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑画板", exact: true });
  await editor.getByLabel("画板标题", { exact: true }).fill("失败时保留的画板");
  await choose(page, "添加图形", "菱形");
  await editor.getByRole("button", { name: "返回笔记", exact: true }).click();
  await saveNote(page);
  await expect(page.getByText("保存失败", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "失败时保留的画板", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "所有知识库", exact: true }).click();
  const guard = page.getByRole("alertdialog", { name: "仍有未保存的内容" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await page.unroute(`**${endpoint}`);
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  const saved = await (await page.request.get(endpoint)).json();
  expect(saved.document.content[0].attrs.scene.elements).toHaveLength(4);
  const external = await page.request.put(endpoint, {
    headers,
    data: {
      title: "服务器先更新",
      knowledge_base_id: saved.knowledge_base_id,
      parent_id: saved.parent_id,
      schema_version: 2,
      document: saved.document,
      tags: [],
      pinned: false,
      favorite: false,
      expected_revision: saved.revision,
    },
  });
  expect(external.ok(), await external.text()).toBe(true);
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  await editor.getByLabel("画板标题", { exact: true }).fill("冲突时保留的画板");
  await editor.getByRole("button", { name: "返回笔记", exact: true }).click();
  await saveNote(page);
  await expect(page.getByText("保存冲突", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "冲突时保留的画板", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "另存本地副本", exact: true }).click();
  await expect.poll(() => page.url().split("/").pop()).not.toBe(id);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "冲突时保留的画板", exact: true }),
  ).toBeVisible();
  const original = await (await page.request.get(endpoint)).json();
  expect(original.title).toBe("服务器先更新");
  expect(original.document.content[0].attrs.scene.title).toBe(
    "失败时保留的画板",
  );
});

test("150-node canvas completes repeated input and dragging and persists its final state", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { endpoint } = await seedCanvas(page, 150);
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑画板", exact: true });
  await expect(editor.locator(".react-flow__node")).toHaveCount(150);
  const node = editor.locator('.react-flow__node[data-id="node-0"]');
  await node.click();
  const text = editor.getByLabel("图形文字", { exact: true });
  await text.fill("");
  const finalText = "连续输入完成，所有节点与连接保持完整。".repeat(4);
  await text.pressSequentially(finalText);
  await expect(text).toHaveValue(finalText);
  for (let i = 0; i < 5; i++) {
    await editor
      .getByLabel("画板标题", { exact: true })
      .fill(`大图连续编辑 ${i + 1}`);
    const box = await node.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box!.x + box!.width / 2 + 20,
      box!.y + box!.height / 2 + 10,
      { steps: 4 },
    );
    await page.mouse.up();
  }
  await page.screenshot({ path: info.outputPath("canvas-150-nodes.png") });
  await editor.getByRole("button", { name: "返回笔记", exact: true }).click();
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  const saved = await (await page.request.get(endpoint)).json();
  const scene = saved.document.content[0].attrs.scene;
  expect(scene.elements).toHaveLength(150);
  expect(scene.edges).toHaveLength(149);
  expect(scene.title).toBe("大图连续编辑 5");
  const first = scene.elements.find(
    (element: { id: string }) => element.id === "node-0",
  );
  expect(first.text).toBe(finalText);
  expect(first.x).toBeGreaterThan(0);
  expect(first.y).toBeGreaterThan(0);
  await page.reload();
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  await expect(editor.locator(".react-flow__node")).toHaveCount(150);
  await expect(editor.getByLabel("画板标题", { exact: true })).toHaveValue(
    "大图连续编辑 5",
  );
});
