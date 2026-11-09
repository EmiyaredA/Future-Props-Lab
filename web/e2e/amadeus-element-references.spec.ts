import { expect, test, type Page } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";

const assistant = (page: Page) =>
  page.getByRole("complementary", { name: "Amadeus 助手" });
const refs = (page: Page) =>
  assistant(page).locator(".amadeus-pending-refs .amadeus-ref");
const addSelected = (page: Page) =>
  assistant(page).getByRole("button", { name: "引用当前选中项", exact: true });
const point = (page: Page) =>
  assistant(page).getByRole("button", { name: "点选页面元素", exact: true });
const openAssistant = async (page: Page) => {
  await page.getByRole("button", { name: "打开 Amadeus", exact: true }).click();
  await expect(
    page.getByRole("separator", { name: "调整 Amadeus 分屏宽度" }),
  ).toBeVisible();
  await expect(addSelected(page)).toBeVisible();
};
async function headers(page: Page) {
  const csrf = (await page.context().cookies()).find(
    ({ name }) => name === "fpl_csrf",
  );
  return { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf!.value };
}

test("visual canvas and board attach only explicit references and reopen saved targets", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/visual-workshop");
  const auth = await headers(page);
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers: auth,
    data: { title: "Amadeus 元素引用验收", kind: "canvas" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  const base = `/v1/visual-workshop/projects/${id}`;
  const nodes = [
    {
      id: "first",
      title: "开场镜头",
      kind: "video",
      position: { x: 220, y: 180 },
    },
    {
      id: "second",
      title: "参考画面",
      kind: "image",
      position: { x: 540, y: 180 },
    },
  ];
  const saved = await page.request.put(base + "/canvas", {
    headers: auth,
    data: { expected_revision: 0, nodes, edges: [] },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();

  await page.route("**/v1/code-agents", (route) =>
    route.fulfill({
      json: {
        items: [{ id: "codex", name: "Codex", available: true, models: [] }],
      },
    }),
  );
  let runInput:
    { references: unknown[]; context: Record<string, unknown>[] } | undefined;
  await page.route("**/v1/amadeus/conversations/*/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    runInput = route.request().postDataJSON();
    await route.fulfill({
      status: 503,
      json: { detail: "本地测试截获运行请求" },
    });
  });
  await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
  await openAssistant(page);
  await addSelected(page).click();
  await expect(
    assistant(page).getByText("请先在工坊中选中要引用的元素"),
  ).toBeVisible();
  const node = page.locator(".canvas-node[data-amadeus-id=first]");
  await node.locator("header").click({ position: { x: 12, y: 10 } });
  await expect(node).toHaveClass(/selected/);
  await expect(refs(page)).toHaveCount(0);
  const input = assistant(page).getByRole("textbox", {
    name: "向 Amadeus 提问",
  });
  const send = assistant(page).getByRole("button", {
    name: "发送",
    exact: true,
  });
  await input.fill("普通选择不发送");
  await send.click();
  await expect.poll(() => runInput?.references).toEqual([]);
  expect(runInput?.context.every((context) => !("selection" in context))).toBe(
    true,
  );
  await expect(send).toBeVisible();

  await addSelected(page).click();
  await expect(refs(page)).toHaveCount(1);
  await addSelected(page).click();
  await expect(refs(page)).toHaveCount(1);
  await point(page).click();
  await expect(assistant(page)).toBeHidden();
  await page
    .getByRole("button", { name: "看板", exact: true })
    .dispatchEvent("click");
  await expect(assistant(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(input).toBeFocused();
  await expect(refs(page)).toHaveCount(1);
  await page.getByRole("button", { name: "看板", exact: true }).press("Enter");
  await point(page).click();
  await page.locator('.board-material[data-amadeus-id="second"]').click();
  await expect(refs(page)).toHaveCount(2);
  await expect(input).toBeFocused();
  await assistant(page)
    .getByRole("button", { name: "移除引用：开场镜头" })
    .click();
  await expect(refs(page)).toHaveCount(1);
  const chip = refs(page)
    .first()
    .getByRole("button", { name: "定位：参考画面", exact: true });
  expect((await refs(page).first().boundingBox())!.height).toBeLessThanOrEqual(
    30,
  );
  await chip.hover();
  await expect(page.locator(".amadeus-ref-tooltip")).toContainText(
    "视觉创作工坊 · 图片",
  );
  await page.mouse.move(0, 0);
  await chip.focus();
  await expect(page.locator(".amadeus-ref-tooltip")).toContainText("参考画面");
  await chip.press("Enter");
  await expect(
    page.locator('.board-material[data-amadeus-id="second"]'),
  ).toHaveClass(/amadeus-located/);
  await page.screenshot({
    path: info.outputPath("visual-split-reference.png"),
  });

  runInput = undefined;
  await input.fill("读取参考画面");
  const messageResponse = page.waitForResponse(
    (response) =>
      /\/v1\/amadeus\/conversations\/[^/]+\/messages$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await send.click();
  const response = await messageResponse;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect
    .poll(() => runInput?.references)
    .toEqual(response.request().postDataJSON().references);
  expect(runInput?.references).toEqual([
    expect.objectContaining({
      target: {
        project_resource: "visual",
        project_id: id,
        element_kind: "node",
        element_id: "second",
        unsaved: false,
      },
    }),
  ]);
  await page.reload();
  await openAssistant(page);
  const historical = assistant(page)
    .getByRole("article", { name: "你的消息" })
    .filter({ hasText: "读取参考画面" })
    .getByRole("button", { name: /参考画面/ });
  await historical.click();
  await expect(
    page.locator('.board-material[data-amadeus-id="second"]'),
  ).toHaveClass(/amadeus-located/);
  const currentCanvas = await (await page.request.get(base + "/canvas")).json();
  const removed = await page.request.put(base + "/canvas", {
    headers: auth,
    data: {
      expected_revision: currentCanvas.revision,
      nodes: [nodes[0]],
      edges: [],
    },
  });
  expect(removed.ok(), await removed.text()).toBeTruthy();
  await page.reload();
  await openAssistant(page);
  await historical.click();
  await expect(
    assistant(page).getByText("找不到这个元素，可能已经删除或移动"),
  ).toBeVisible();

  const { project: other } = await createProject(page, "visual-workshop", {
    kind: "canvas",
  });
  await page.goto(`/apps/visual-workshop/projects/${other.id}/canvas`);
  await openAssistant(page);
  await historical.click();
  await expect(
    assistant(page).getByText("请先打开引用的来源项目"),
  ).toBeVisible();
});

test("presentation resolves a reference on a different slide", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  const document = newDeck("blank");
  const firstSlide = document.slides[0];
  const secondSlide = {
    ...firstSlide,
    id: "slide-2",
    elements: [
      newElement("roundRect", {
        id: "shape-2",
        x: 200,
        y: 160,
        width: 300,
        height: 160,
      }),
    ],
  };
  document.slides.push(secondSlide);
  const created = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: await headers(page),
      data: { title: "跨页元素引用", document },
    },
  );
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  await page.goto(`/apps/presentation-workshop/projects/${id}`);
  await openAssistant(page);
  const slide1 = page.getByRole("button", { name: "幻灯片 1", exact: true });
  const slide2 = page.getByRole("button", { name: "幻灯片 2", exact: true });
  await slide2.click({ modifiers: ["Shift"] });
  await addSelected(page).click();
  await expect(refs(page)).toHaveCount(2);
  const element = page.locator(
    '.presentation-canvas [data-amadeus-id="shape-2"]',
  );
  await point(page).click();
  await element.click();
  await expect(refs(page)).toHaveCount(3);
  await slide1.click();
  await expect(element).toHaveCount(0);
  await refs(page).last().locator(".amadeus-ref-content").click();
  await expect(slide2).toHaveAttribute("aria-current", "true");
  await expect(element).toHaveClass(/amadeus-located/);
});

async function createProject(
  page: Page,
  app: string,
  data: object = {},
  collection = "projects",
) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/apps/${app}`);
  const auth = await headers(page);
  const response = await page.request.post(`/v1/${app}/${collection}`, {
    headers: auth,
    data: { title: `引用验收 ${app}`, ...data },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return { auth, project: await response.json() };
}

async function attachAndLocate(page: Page, id: string) {
  await openAssistant(page);
  const element = page
    .locator(`.website-page [data-amadeus-id="${id}"]`)
    .first();
  await point(page).click();
  await element.click();
  await expect(refs(page)).toHaveCount(1);
  await refs(page).first().locator(".amadeus-ref-content").click();
  await expect(element).toHaveClass(/amadeus-located/);
  await addSelected(page).click();
  await expect(refs(page)).toHaveCount(1);
}

test("video native multi-selection attaches both clips", async ({ page }) => {
  const { project, auth } = await createProject(page, "video-editor");
  const base = `/v1/video-editor/projects/${project.id}`;
  const updated = await page.request.post(base + "/timeline/operations", {
    headers: auth,
    data: {
      expectedRevision: 0,
      requestId: "reference-clips",
      operations: [0, 1].map((i) => ({
        type: "addClip",
        clip: {
          id: `caption-${i}`,
          kind: "text",
          trackId: "visual-1",
          name: `字幕 ${i + 1}`,
          text: "分屏元素引用",
          timelineStartUs: i * 2_000_000,
          sourceInUs: 0,
          durationUs: 2_000_000,
        },
      })),
    },
  });
  expect(updated.ok(), await updated.text()).toBeTruthy();
  await page.goto(`/apps/video-editor/projects/${project.id}/editor`);
  await openAssistant(page);
  await page.locator('[data-clip-id="caption-0"]').click();
  await page
    .locator('[data-clip-id="caption-1"]')
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(refs(page)).toHaveCount(0);
  await addSelected(page).click();
  await expect(refs(page)).toHaveCount(2);
  await refs(page).first().locator(".amadeus-ref-content").click();
  await expect(page.locator('[data-clip-id="caption-0"]')).toHaveClass(
    /amadeus-located/,
  );
});

test("thought attaches a note and opens it from a sibling note", async ({
  page,
}) => {
  const { project, auth } = await createProject(
    page,
    "thought-workshop",
    {},
    "knowledge-bases",
  );
  const response = await page.request.post("/v1/thought-workshop/notes", {
    headers: auth,
    data: {
      title: "可引用的笔记",
      knowledge_base_id: project.id,
      expected_knowledge_revision: project.revision,
      document: { type: "doc", content: [{ type: "paragraph" }] },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const note = await response.json();
  await page.goto(`/apps/thought-workshop/knowledge-bases/${project.id}`);
  await openAssistant(page);
  await point(page).click();
  await page
    .locator(`.knowledge-tree-name[data-amadeus-id="${note.id}"]`)
    .click();
  await expect(refs(page)).toHaveCount(1);
  await refs(page).first().locator(".amadeus-ref-content").click();
  await expect(page.getByRole("textbox", { name: "笔记标题" })).toHaveValue(
    "可引用的笔记",
  );
  await addSelected(page).click();
  await expect(refs(page)).toHaveCount(1);
});

test("Galgame attaches and locates a story block", async ({ page }) => {
  const { project, auth } = await createProject(page, "galgame-workshop");
  const base = `/v1/galgame-workshop/projects/${project.id}/story`;
  const { document, revision } = await (await page.request.get(base)).json();
  document.chapters[0].fragments[0].blocks = [
    { id: "story-ref", type: "narration", text: "故事开场" },
  ];
  const updated = await page.request.put(base, {
    headers: auth,
    data: { document, expected_revision: revision },
  });
  expect(updated.ok(), await updated.text()).toBeTruthy();
  await page.goto(`/apps/galgame-workshop/projects/${project.id}/editor`);
  const created = await page.request.post("/v1/amadeus/conversations", {
    headers: auth,
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const conversation = await created.json();
  const detailPath = `/v1/amadeus/conversations/${conversation.id}`;
  let releaseDetail!: () => void;
  const waitForPick = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });
  await page.route(
    (url) => url.pathname === detailPath,
    async (route) => {
      await waitForPick;
      await route.continue();
    },
  );
  await openAssistant(page);
  const block = page.locator('[data-block-id="story-ref"]').first();
  await point(page).click();
  await block.click({ position: { x: 4, y: 4 } });
  await expect(refs(page)).toHaveCount(1);
  releaseDetail();
  await expect(
    assistant(page).getByRole("link", { name: "在新标签页打开 Amadeus" }),
  ).toHaveAttribute("href", `/amadeus?conversation=${conversation.id}`);
  await expect(refs(page)).toHaveCount(1);

  await refs(page).first().locator(".amadeus-ref-content").click();
  await expect(block).toHaveClass(/amadeus-located/);
  await addSelected(page).click();
  await expect(refs(page)).toHaveCount(1);
});

test("motion references a composition layer", async ({ page }) => {
  const { project } = await createProject(page, "motion-compositor");
  await page.goto(`/apps/motion-compositor/projects/${project.id}/editor`);
  await page.getByRole("button", { name: /图形与速度线/ }).click();
  const layer = page.locator(".mc-layer-name[data-amadeus-id]").first();
  await expect(layer).toBeVisible();
  await attachAndLocate(page, (await layer.getAttribute("data-amadeus-id"))!);
});

test("audio annotation references a saved segment without copying its transcript", async ({
  page,
}) => {
  await page.goto("/apps/audio-annotation");
  const auth = await headers(page);
  const wav = Buffer.alloc(16044);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  const asset = await page.request.post("/v1/files", {
    headers: auth,
    multipart: {
      upload: { name: "reference.wav", mimeType: "audio/wav", buffer: wav },
    },
  });
  expect(asset.ok(), await asset.text()).toBeTruthy();
  const { project } = await createProject(page, "audio-annotation", {
    asset_id: (await asset.json()).id,
  });
  const base = `/v1/audio-annotation/projects/${project.id}/document`;
  const { revision } = await (await page.request.get(base)).json();
  const saved = await page.request.put(base, {
    headers: auth,
    data: {
      expected_revision: revision,
      segments: [
        {
          id: "segment-ref",
          start_ms: 100,
          end_ms: 800,
          text: "正文只通过业务接口读取",
        },
      ],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto(`/apps/audio-annotation/projects/${project.id}`);
  await attachAndLocate(page, "segment-ref");
  await expect(refs(page)).not.toContainText("正文只通过业务接口读取");
});

test("director references an entity selected in the scene workspace", async ({
  page,
}) => {
  const { project } = await createProject(page, "director-desk");
  await page.goto(`/apps/director-desk/projects/${project.id}`);
  const entity = page.locator(".object-row[data-amadeus-id]").first();
  await expect(entity).toBeVisible();
  await attachAndLocate(page, (await entity.getAttribute("data-amadeus-id"))!);
  const switcher = page.locator("#scene-switch");
  const sourceScene = await switcher.inputValue();
  await page.getByRole("button", { name: "戏段", exact: true }).click();
  await page.getByRole("button", { name: "按模板新增" }).click();
  await expect(switcher).not.toHaveValue(sourceScene);
  await refs(page).first().locator(".amadeus-ref-content").click();
  await expect(switcher).toHaveValue(sourceScene);
});

test("interview references an uploaded item in a saved room", async ({
  page,
}) => {
  const { project, auth } = await createProject(
    page,
    "interview-assistant",
    { request_id: "ref-fixture" },
    "rooms",
  );
  const uploaded = await page.request.post(
    `/v1/interview-assistant/rooms/${project.id}/materials?expected_revision=${project.revision}`,
    {
      headers: auth,
      multipart: {
        file: {
          name: "面试材料.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("测试材料内容"),
        },
      },
    },
  );
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const { materials } = await uploaded.json();
  await page.reload();
  await attachAndLocate(page, materials[0].id);
  await expect(refs(page)).toContainText("面试材料.txt");
});
