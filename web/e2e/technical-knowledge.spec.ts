import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { TECHNICAL_LIBRARY } from "../src/features/thought-workshop/official/technicalCatalog";
import { newDocument, pickNoteMore, saveNote } from "./thought-helpers";
import { importAndPublish, legacyTarget } from "./official-import-helpers";

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
test("imported technical articles retain CanvasScene and Mermaid in the shared reader", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const { publication } = await importAndPublish(page, "technical");
  for (const document of TECHNICAL_LIBRARY.documents) {
    const target = await legacyTarget(
      page,
      "technical",
      document.id,
      publication.id,
    );
    await page.goto(
      `/apps/thought-workshop/community/${publication.id}/documents/${target.note_id}`,
    );
    await expect(
      page.getByRole("heading", { name: document.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".thought-mermaid-preview svg").first(),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.locator(".diagram-viewer svg[role=img]").first(),
    ).toBeVisible();
    await expect(page.getByText("图表语法有误，请编辑源码")).toHaveCount(0);
    if (document.id === "thought-workshop")
      await page.screenshot({
        path: info.outputPath("imported-architecture.png"),
      });
  }
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
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
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
