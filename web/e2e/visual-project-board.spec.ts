import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const screenshots = resolve(
  process.env.FPL_BOARD_SCREENSHOTS || "../.local/task-board/screenshots",
);

// All mutations use the public API and the temporary Playwright deployment.
test("看板与画布共用节点，历史预览、最终版本、文本和固定引用刷新后保留", async ({
  page,
}) => {
  test.setTimeout(90_000);
  mkdirSync(screenshots, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "AI 娘的日常", kind: "canvas" },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = (await created.json()).id;
  const base = `/v1/visual-workshop/projects/${projectId}`;
  const upload = await page.request.post(base + "/node-uploads", {
    headers,
    multipart: {
      expected_revision: "0",
      file: { name: "小夏人设.png", mimeType: "image/png", buffer: PNG },
    },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  let canvas = await upload.json();
  const imageId = canvas.nodes[0].id;
  for (let version = 2; version <= 3; version++) {
    const response = await page.request.post(
      `${base}/nodes/${imageId}/output-uploads`,
      {
        headers,
        multipart: {
          expected_revision: String(canvas.revision),
          file: {
            name: `小夏-v${version}.png`,
            mimeType: "image/png",
            buffer: PNG,
          },
        },
      },
    );
    expect(response.ok(), await response.text()).toBeTruthy();
    canvas = await response.json();
  }
  const history = await (
    await page.request.get(`${base}/nodes/${imageId}/outputs`)
  ).json();
  canvas.nodes[0] = {
    ...canvas.nodes[0],
    title: "小夏 · 人设图",
    category_id: "character",
    group: "主角",
  };
  const nodes = [
    ...canvas.nodes,
    {
      id: "script",
      kind: "text",
      title: "清晨 · 文本脚本",
      category_id: "storyboard",
      position: { x: 400, y: 100 },
      text: "小夏在晨光中醒来。",
    },
    {
      id: "scene",
      kind: "image",
      title: "卧室 · 场景图",
      category_id: "scene",
      position: { x: 600, y: 100 },
      asset_id: null,
    },
    {
      id: "shot",
      kind: "video",
      title: "镜头 01 · 视频",
      category_id: "storyboard",
      position: { x: 800, y: 100 },
      asset_id: null,
    },
    {
      id: "audio",
      kind: "audio",
      title: "清晨 · 环境音",
      category_id: "sound",
      position: { x: 1000, y: 100 },
      asset_id: null,
    },
  ];
  const saved = await page.request.put(base + "/canvas", {
    headers,
    data: {
      expected_revision: canvas.revision,
      nodes,
      edges: [],
      categories: [
        { id: "character", name: "人设", groups: ["主角"] },
        { id: "scene", name: "场景", groups: [] },
        { id: "storyboard", name: "分镜", groups: [] },
        { id: "sound", name: "声音设计", groups: [] },
      ],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto(`/apps/visual-workshop/projects/${projectId}/canvas`);
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "项目素材", exact: true }),
  ).toBeVisible();
  const tree = page.getByRole("complementary", {
    name: "项目素材",
    exact: true,
  });
  await tree.getByRole("button", { name: /^小夏 · 人设图/ }).click();
  await expect(page.getByLabel("当前预览 v3 · 最终输出 v3")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "a-workbench.png"),
  });
  await page
    .locator(".board-version-list")
    .getByRole("button")
    .filter({ hasText: /v2/ })
    .click();
  await expect(page.getByLabel("当前预览 v2 · 最终输出 v3")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "设为最终输出" }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "c-output-history.png"),
  });
  // Previewing v2 keeps tree and persisted final at v3.
  expect(
    (await (await page.request.get(base + "/canvas")).json()).nodes[0]
      .final_version,
  ).toBe(3);
  await tree.getByRole("button", { name: /^清晨 · 文本脚本/ }).click();
  await page
    .getByRole("textbox", { name: "文本内容" })
    .fill("小夏推开窗户，听见清晨的鸟鸣。");
  await page.getByRole("button", { name: "保存文本版本" }).click();
  await expect(page.getByLabel("当前预览 v1 · 最终输出 v1")).toBeVisible();
  await tree.getByRole("button", { name: /^镜头 01 · 视频/ }).click();
  await page.getByRole("button", { name: "引用任务输出" }).click();
  await page.getByRole("combobox", { name: "选择上游任务" }).click();
  await expect(
    page.getByRole("option", { name: /卧室 · 场景图/ }),
  ).toBeDisabled();
  await page.getByRole("option", { name: /小夏 · 人设图/ }).click();
  await page.getByRole("button", { name: "固定版本", exact: true }).click();
  await page.getByRole("combobox", { name: "固定历史版本" }).click();
  await page.getByRole("option", { name: /v2 ·/ }).click();
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "d-input-binding.png"),
  });
  await page.getByRole("button", { name: "绑定输入" }).click();
  await expect(page.getByText("固定版本 · v2")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(base + "/canvas")).json()).edges[0]
          ?.output_id,
    )
    .toBe(history.items[1].id);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "创作工作台", exact: true }),
  ).toBeVisible();
  await tree.getByRole("button", { name: /^镜头 01 · 视频/ }).click();
  await page
    .getByRole("region", { name: "输入引用" })
    .getByRole("button", { name: "输入素材 1", exact: true })
    .click();
  await expect(page.getByText("固定版本 · v2")).toBeVisible();
  await page.getByRole("button", { name: "状态分组", exact: true }).click();
  for (const status of ["待准备", "可生成", "生成中", "已完成"])
    await expect(
      page.getByRole("heading", { name: new RegExp(status) }),
    ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "b-status-groups.png"),
  });
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "dark.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBeTruthy();
  await page.getByRole("button", { name: "切换项目素材面板" }).click();
  await page.getByRole("button", { name: "创作工作台", exact: true }).click();
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "narrow.png"),
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await expect(page.locator(`[data-node-id='${imageId}']`)).toBeVisible();
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await tree.getByRole("button", { name: /^清晨 · 文本脚本/ }).click();
  await expect(page.getByRole("textbox", { name: "文本内容" })).toHaveValue(
    "小夏推开窗户，听见清晨的鸟鸣。",
  );
});

// Synthetic media and read-only task responses keep paid providers out of this journey.
test("音视频版本可预览，重新生成展示最终输出与真实状态反馈", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "媒体验收", kind: "canvas" },
  });
  const projectId = (await created.json()).id;
  const base = `/v1/visual-workshop/projects/${projectId}`;
  const wav = Buffer.alloc(44 + 16000);
  wav.write("RIFF", 0);
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
  wav.writeUInt32LE(16000, 40);
  const video = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#e36643";
    context.fillRect(0, 0, 96, 64);
    const stream = canvas.captureStream(10);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
      ? "video/webm"
      : "video/mp4";
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const ended = new Promise<void>(
      (resolve) => (recorder.onstop = () => resolve()),
    );
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 400));
    recorder.stop();
    await ended;
    stream.getTracks().forEach((track) => track.stop());
    const bytes = new Uint8Array(
      await new Blob(chunks, { type: mimeType }).arrayBuffer(),
    );
    return { mimeType, base64: btoa(String.fromCharCode(...bytes)) };
  });
  let revision = 0;
  let canvas;
  for (const file of [
    { name: "小夏.png", mimeType: "image/png", buffer: PNG },
    { name: "清晨.wav", mimeType: "audio/wav", buffer: wav },
    {
      name: video.mimeType === "video/webm" ? "镜头.webm" : "镜头.mp4",
      mimeType: video.mimeType,
      buffer: Buffer.from(video.base64, "base64"),
    },
  ]) {
    const response = await page.request.post(base + "/node-uploads", {
      headers,
      multipart: { expected_revision: String(revision), file },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    canvas = await response.json();
    revision = canvas.revision;
  }
  await page.goto(`/apps/visual-workshop/projects/${projectId}/canvas`);
  await page.getByRole("button", { name: "看板", exact: true }).click();
  const tree = page.getByRole("complementary", {
    name: "项目素材",
    exact: true,
  });
  await tree.getByRole("button", { name: /清晨 音频/ }).click();
  await expect(page.locator(".board-large-preview audio")).toBeVisible();
  await expect(page.locator(".audio-generate-submit")).toBeInViewport();
  await page.getByRole("button", { name: "展开音频生成器" }).click();
  await expect(page.locator(".audio-generation-composer")).toHaveClass(
    /is-expanded/,
  );
  await page.getByRole("button", { name: "收起音频生成器" }).click();
  await expect
    .poll(() =>
      page
        .locator(".board-large-preview audio")
        .evaluate((element: HTMLAudioElement) => element.readyState),
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "audio.png"),
  });
  await tree.getByRole("button", { name: /镜头 视频/ }).click();
  await expect(page.locator(".board-large-preview video")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成视频" })).toBeInViewport();
  await expect
    .poll(() =>
      page
        .locator(".board-large-preview video")
        .evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "video.png"),
  });
  const imageId = canvas.nodes[0].id;
  const videoId = canvas.nodes[2].id;
  const task = (
    id: string,
    nodeId: string,
    status: string,
    error_message: string | null = null,
  ) => ({
    id,
    project_id: projectId,
    canvas_node_id: nodeId,
    generation_kind: "image",
    provider_kind: "volcengine_image",
    status,
    progress: status === "processing" ? 48 : 0,
    error_message,
    request_payload: {},
    revision: 1,
    created_at: "2026-10-07T10:00:00Z",
    updated_at: "2026-10-07T10:00:00Z",
    result_asset_id: null,
  });
  await page.route("**/v1/visual-workshop/generation-tasks?**", (route) =>
    route.fulfill({
      json: {
        items: [
          task("running", imageId, "processing"),
          task("failed", videoId, "failed", "模拟供应商返回失败"),
        ],
        total: 2,
        page: 1,
        page_size: 100,
      },
    }),
  );
  await page.route(`**${base}/canvas`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const document = await response.json();
    document.nodes.find(
      (node: { id: string }) => node.id === videoId,
    ).generation_task_id = "failed";
    await route.fulfill({ response, json: document });
  });
  await page.reload();
  await page.getByRole("button", { name: "状态分组", exact: true }).click();
  await expect(page.getByText("48%", { exact: false })).toBeVisible();
  await expect(page.locator(".board-card-error summary")).toHaveText(
    "模拟供应商返回失败",
  );
  const card = page.locator(".board-task-card").filter({ hasText: "小夏" });
  await expect(card).toContainText("最终 v1");
  await expect(
    card.locator('.board-card-preview img[src^="blob:"]'),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "status-running-failed.png"),
  });
});
