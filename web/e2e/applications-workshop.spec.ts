import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("enters the visual workshop, persists projects, and supports deep navigation", async ({
  page,
}, info) => {
  let projects: Array<Record<string, unknown>> = [];
  let generationTasks: Array<Record<string, unknown>> = [];
  let exposeReferenceImage = false;
  const referenceImageBytes = await readFile(
    "public/brand/visual-workshop-mark.png",
  );
  const referenceImage = {
    id: "e2e-reference-image",
    project_id: "e2e-project",
    folder_id: null,
    reference_id: null,
    original_filename: "e2e-reference.png",
    display_name: "E2E 参考图.png",
    media_kind: "image",
    mime_type: "image/png",
    byte_size: referenceImageBytes.length,
    source: "project",
    is_reference: false,
    revision: 0,
    created_at: "2026-08-03T08:00:00Z",
    updated_at: "2026-08-03T08:00:00Z",
  };
  let canvas = {
    project_id: "e2e-project",
    nodes: [] as Array<Record<string, unknown>>,
    edges: [] as Array<Record<string, unknown>>,
    revision: 0,
    updated_at: "2026-08-03T08:00:00Z",
  };
  await page.route("**/v1/visual-workshop/projects**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/canvas")) {
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as {
          nodes: Array<Record<string, unknown>>;
          edges?: Array<Record<string, unknown>>;
          expected_revision: number;
        };
        canvas = {
          ...canvas,
          nodes: body.nodes,
          edges: body.edges ?? canvas.edges,
          revision: body.expected_revision + 1,
          updated_at: "2026-08-03T08:00:10Z",
        };
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(canvas),
      });
      return;
    }
    const id = url.pathname.split("/").at(-1);
    if (request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          id === "projects"
            ? { items: projects }
            : projects.find((project) => project.id === id),
        ),
      });
      return;
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON() as { title: string; kind: string };
      const project = {
        id: "e2e-project",
        ...body,
        status: "draft",
        revision: 0,
        created_at: "2026-08-03T08:00:00Z",
        updated_at: "2026-08-03T08:00:00Z",
      };
      projects = [project];
      canvas = { ...canvas, nodes: [], revision: 0 };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(project),
      });
      return;
    }
    if (request.method() === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      projects = projects.map((project) =>
        project.id === id
          ? { ...project, ...body, revision: Number(project.revision) + 1 }
          : project,
      );
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(projects.find((project) => project.id === id)),
      });
      return;
    }
    projects = projects.filter((project) => project.id !== id);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ deleted: true }),
    });
  });
  await page.route("**/v1/file-folders**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });
  await page.route("**/v1/files**", async (route) => {
    const url = new URL(route.request().url());
    if (/\/v1\/files\/[^/]+\/(?:content|thumbnail)$/.test(url.pathname)) {
      await route.fulfill({
        contentType: "image/png",
        body: referenceImageBytes,
      });
      return;
    }
    if (route.request().method() === "POST") {
      exposeReferenceImage = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(referenceImage),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items:
          exposeReferenceImage &&
          (!url.searchParams.get("media_kind") ||
            url.searchParams.get("media_kind") === "image")
            ? [referenceImage]
            : [],
      }),
    });
  });
  await page.route(
    "**/v1/visual-workshop/generation-options",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            {
              id: "e2e-image-model",
              provider_id: "e2e-image-provider",
              provider_name: "SenseAudio 图片生成",
              kind: "image",
              slug: "senseaudio-image-2.0-260319",
              label: "SenseAudio Image 2.0",
              description: "E2E 确定性假供应商",
              sizes: ["1024x1024"],
            },
          ],
        }),
      });
    },
  );
  await page.route(
    "**/v1/visual-workshop/generation-tasks/*",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(generationTasks[0]),
      });
    },
  );
  await page.route(
    /\/v1\/visual-workshop\/(?:projects\/[^/]+\/)?generation-tasks(?:\?.*)?$/,
    async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        const task = {
          id: "e2e-generation-task",
          project_id: "e2e-project",
          canvas_node_id: body.canvas_node_id ?? null,
          provider_id: "e2e-image-provider",
          model_id: "e2e-image-model",
          provider_kind: "senseaudio_image",
          kind: "image",
          provider_name: "SenseAudio 图片生成",
          model_slug: "senseaudio-image-2.0-260319",
          request_payload: body,
          provider_task_id: "fake-upstream-task",
          status: "processing",
          progress: 42,
          error_message: null,
          result_asset_id: null,
          can_retry_materialization: false,
          revision: 1,
          created_at: "2026-08-03T08:00:00Z",
          updated_at: "2026-08-03T08:00:05Z",
          completed_at: null,
        };
        generationTasks = [task];
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(task),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          items: generationTasks,
          total: generationTasks.length,
        }),
      });
    },
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/home");
  await page.getByRole("button", { name: /全部应用/ }).click();
  await expect(page).toHaveURL(/\/apps$/);
  const status = page.getByRole("button", {
    name: /^查看视觉创作工坊服务状态/,
  });
  const details = page.getByRole("region", { name: "视觉创作工坊服务状态" });
  const appCard = page.locator(".application-card").filter({ has: status });
  await expect(status).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const before = await appCard.boundingBox();
    await status.hover();
    await expect(details).toContainText("最近检查");
    const panel = (await details.boundingBox())!;
    const anchor = (await status.boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    expect(
      Math.min(
        Math.abs(panel.y - anchor.y - anchor.height),
        Math.abs(anchor.y - panel.y - panel.height),
      ),
    ).toBeLessThan(12);
    expect((await appCard.boundingBox())!.height).toBeCloseTo(
      before!.height,
      2,
    );
    await page.mouse.move(0, 0);
    await expect(details).toBeHidden();
  }
  await page.getByRole("button", { name: "打开视觉创作工坊" }).click();
  await expect(page).toHaveURL(/\/apps\/visual-workshop$/);
  await expect(page.locator(".studio-sidebar")).toHaveCount(0);
  await expect(page.locator(".workshop-brand img")).toHaveAttribute(
    "src",
    /^\/brand\/(?:thumbnails\/)?visual-workshop-mark(?:-.*\.webp|\.png)$/,
  );
  await expect(page.getByText("浏览全部应用")).toBeVisible();
  await expect(page.getByText("还没有创作项目")).toBeVisible();

  await page.getByRole("button", { name: /新建第一个项目/ }).click();
  await expect(page).toHaveURL(
    /\/apps\/visual-workshop\/projects\/e2e-project\/canvas$/,
  );
  await expect(page.getByText("未命名项目")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".canvas-brand-mark")).toHaveAttribute(
    "data-load-state",
    "ready",
  );
  const zoom = page.locator(".canvas-zoom-value");
  await zoom.click();
  await expect(zoom).toHaveText("100%");
  await page.getByRole("button", { name: "放大" }).click();
  await expect(zoom).toHaveText("110%");
  await page.getByRole("button", { name: "素材库" }).click();
  await expect(
    page.getByRole("complementary", { name: "项目素材库" }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "项目素材库" }),
  ).toHaveCSS("width", "336px");
  await expect(page.getByRole("button", { name: "列表视图" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByPlaceholder("搜索素材")).toBeVisible();
  await expect(page.getByRole("button", { name: "添加素材" })).toBeVisible();
  await page.getByRole("button", { name: "筛选素材" }).click();
  await expect(page.getByRole("dialog", { name: "素材筛选" })).toBeVisible();
  await page.getByRole("button", { name: "筛选素材" }).click();
  await page.getByRole("tab", { name: "总文件" }).click();
  await expect(page.getByRole("button", { name: "添加素材" })).toBeVisible();
  await expect(page.getByText("文件管理中还没有文件")).toBeVisible();
  await expect(page.getByRole("tab", { name: "跨项目" })).toBeVisible();
  await page.goto("/apps/visual-workshop/projects/e2e-project/assets");
  await expect(page.getByRole("heading", { name: "项目素材库" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "总文件" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "跨项目" })).toBeVisible();
  await page.getByRole("button", { name: "返回画布" }).click();
  await page.reload();
  await expect(page.getByText("未命名项目")).toBeVisible();
  const canvasSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/canvas") &&
      response.request().method() === "PUT",
  );
  await page.locator(".visual-canvas-surface").click({
    button: "right",
    position: { x: 620, y: 300 },
  });
  await page.getByRole("menuitem", { name: "添加图片节点" }).click();
  await canvasSaved;
  await expect(
    page.getByRole("complementary", { name: "节点检查器" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("图片1")).toBeVisible();
  await page.getByText("图片1").dblclick();
  await expect(page.getByRole("dialog", { name: "图片1" })).toBeVisible();
  await page.getByRole("button", { name: "关闭媒体预览" }).click();
  await page.evaluate(() => {
    const farInput = document.createElement("input");
    farInput.style.position = "absolute";
    farInput.style.left = "6000px";
    document.querySelector(".visual-canvas-world")!.append(farInput);
    farInput.focus();
    farInput.remove();
  });
  await expect(
    page.getByRole("button", { name: "返回项目列表" }),
  ).toBeInViewport();
  await expect(
    page.getByRole("navigation", { name: "画布工具" }),
  ).toBeInViewport();
  await expect(page.getByLabel("画布视图控制")).toBeInViewport();
  expect(
    await page
      .locator(".visual-canvas-surface")
      .evaluate((surface) => surface.scrollLeft),
  ).toBe(0);
  const outputPort = page.getByRole("button", {
    name: "从图片1创建连线",
  });
  const portCenterOffset = await outputPort.evaluate((button) => {
    const buttonBounds = button.getBoundingClientRect();
    const iconBounds = button.querySelector("svg")!.getBoundingClientRect();
    return {
      x:
        iconBounds.left +
        iconBounds.width / 2 -
        (buttonBounds.left + buttonBounds.width / 2),
      y:
        iconBounds.top +
        iconBounds.height / 2 -
        (buttonBounds.top + buttonBounds.height / 2),
    };
  });
  expect(Math.abs(portCenterOffset.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(portCenterOffset.y)).toBeLessThanOrEqual(1);
  await outputPort.click();
  await expect(
    page.getByRole("complementary", { name: "节点检查器" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "替换素材" }).click();
  await page.getByRole("tab", { name: "AI 生成" }).click();
  await page.getByRole("button", { name: "上传参考图片（可选）" }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /本地上传/ }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "E2E 参考图.png",
    mimeType: "image/png",
    buffer: referenceImageBytes,
  });
  await expect(
    page.getByRole("button", { name: "E2E 参考图.png", exact: true }),
  ).toBeVisible();
  const promptEditor = page.getByRole("textbox", { name: "图片提示词" });
  await promptEditor.click();
  await promptEditor.type("@");
  await expect(
    page.getByRole("listbox", { name: "引用已选素材" }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await promptEditor.type(" 初始描述");
  await expect(
    page.getByRole("button", { name: "移除引用 E2E 参考图.png" }),
  ).toBeVisible();
  await promptEditor.press("ControlOrMeta+A");
  await promptEditor.press("Backspace");
  await promptEditor.type("E2E 未来城市海报");
  await expect(promptEditor).toContainText("E2E 未来城市海报");
  await page.getByRole("button", { name: "图片参数" }).click();
  await page.getByRole("spinbutton", { name: /种子/ }).fill("42");
  await page.getByRole("button", { name: "生成数量" }).click();
  await page.getByRole("option", { name: "×3" }).click();
  await page.getByRole("button", { name: "生成图片" }).click();
  await expect(page.getByText(/已提交 3 个生成任务/)).toBeVisible();
  await expect(page.locator(".canvas-save-state")).toContainText("已保存");

  await page.reload();
  await expect(page.getByText("图片1")).toBeVisible();
  await page.getByText("图片1").click();
  await page.getByRole("button", { name: "替换素材" }).click();
  await page.getByRole("tab", { name: "AI 生成" }).click();
  const restoredPrompt = page.getByRole("textbox", { name: "图片提示词" });
  await expect(restoredPrompt).toContainText("E2E 未来城市海报");
  await expect(
    page.getByRole("button", { name: "E2E 参考图.png", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "生成数量" })).toContainText(
    "×3",
  );
  await page.getByRole("button", { name: "图片参数" }).click();
  await expect(page.getByRole("spinbutton", { name: /种子/ })).toHaveValue(
    "42",
  );

  const linkedImageNode = canvas.nodes.find((node) => node.kind === "image")!;
  canvas = {
    ...canvas,
    nodes: [
      { ...linkedImageNode, asset_id: referenceImage.id },
      {
        id: "e2e-linked-video",
        kind: "video",
        title: "连线目标视频",
        position: { x: 980, y: 300 },
        asset_id: null,
        generation_draft: {
          model_id: null,
          prompt: "",
          mode: "reference",
          duration: 5,
          resolution: "720p",
          ratio: "16:9",
          watermark: true,
          generate_audio: false,
          first_frame_asset_id: null,
          last_frame_asset_id: null,
          reference_asset_ids: [],
          video_asset_ids: [],
          audio_asset_ids: [],
        },
      },
    ],
    edges: [
      {
        id: "e2e-linked-edge",
        source_node_id: linkedImageNode.id,
        target_node_id: "e2e-linked-video",
      },
    ],
    revision: canvas.revision + 1,
  };
  await page.reload();
  await page.getByText("连线目标视频").click();
  await page.getByRole("button", { name: "替换素材" }).click();
  const videoTabs = page.getByRole("tablist", { name: "视频节点操作" });
  await expect(
    videoTabs.getByRole("tab", { name: "素材", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "适配视图" }).click();
  await expect(videoTabs).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: info.outputPath("video-material-tab.png"),
    animations: "disabled",
  });
  await videoTabs.getByRole("tab", { name: "生成设置" }).click();
  await expect(
    videoTabs.getByRole("tab", { name: "生成设置" }),
  ).toHaveAttribute("aria-selected", "true");
  const linkedReferenceRow = page.getByRole("group", {
    name: "固定参考素材",
  });
  await expect(linkedReferenceRow).toBeVisible();
  await expect(page.getByText("上游引用")).toHaveCount(0);
  await expect(
    linkedReferenceRow.locator(
      '.generation-media-card[data-linked-reference="true"]',
    ),
  ).toHaveCount(1);
  await expect(
    linkedReferenceRow.getByRole("button", {
      name: "E2E 参考图.png",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    linkedReferenceRow.getByRole("button", {
      name: "移除参考文件 E2E 参考图.png",
    }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "适配视图" }).click();
  await expect(videoTabs).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: info.outputPath("video-generation-references.png"),
    animations: "disabled",
  });

  await expect(
    page.getByRole("button", { name: "对话", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打开 Amadeus", exact: true }),
  ).toBeVisible();

  projects.push({
    id: "legacy-completed-project",
    title: "历史作品",
    kind: "canvas",
    status: "completed",
    revision: 0,
    updated_at: "2026-08-03T08:00:00Z",
  });
  await page.getByRole("button", { name: "返回项目列表" }).click();
  await expect(page).toHaveURL(/\/apps\/visual-workshop$/);
  const cards = page.locator(".workshop-project-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.getByText("未命名项目", { exact: true })).toBeVisible();
  await expect(cards.getByText("历史作品", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "草稿", exact: true }),
  ).toHaveCount(0);
  await expect(cards.getByText(/^(草稿|已完成)$/)).toHaveCount(0);
  await expect(
    cards.getByRole("button", { name: /^(完成|恢复)$/ }),
  ).toHaveCount(0);
  const search = page.getByRole("textbox", { name: "搜索项目" });
  await search.fill("历史作品");
  await expect(cards).toHaveCount(1);
  await expect(cards.getByText("历史作品", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /返回应用中心/ }).click();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(page.locator(".studio-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "文件管理" }).click();
  await expect(page).toHaveURL(/\/files$/);
  await expect(page.locator(".file-management-page")).toBeVisible();

  await page.setViewportSize({ width: 700, height: 800 });
  await page.goto("/apps/visual-workshop/tasks");
  await expect(page.getByText("E2E 未来城市海报")).toBeVisible();
  await expect(page.getByText("42%")).toBeVisible();
  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

for (const entry of ["website", "independent"]) {
  test(`visual project views use Amadeus and never request old conversations (${entry})`, async ({
    page,
    baseURL,
  }) => {
    await page.goto("/apps/visual-workshop");
    const csrf = (await page.context().cookies()).find(
      (cookie) => cookie.name === "fpl_csrf",
    )!.value;
    const created = await page.request.post("/v1/visual-workshop/projects", {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title: "项目对话入口验收", kind: "canvas" },
    });
    expect(created.ok()).toBeTruthy();
    const { id } = await created.json();
    const path = `/apps/visual-workshop/projects/${id}/canvas`;
    if (entry === "independent") {
      // Exercise the independent Visual browser program against the same isolated API fixture.
      await page.route(
        (url) => url.pathname === path,
        async (route) => {
          if (!route.request().isNavigationRequest()) return route.fallback();
          const response = await route.fetch({
            url: new URL("/visual.html", baseURL).href,
          });
          await route.fulfill({ response });
        },
      );
    }
    const conversations = `/v1/visual-workshop/projects/${id}/conversations`;
    expect((await page.request.get(conversations)).status()).toBe(404);

    const oldConversationRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith(conversations))
        oldConversationRequests.push(request.url());
    });
    const oldButton = page.getByRole("button", { name: "对话", exact: true });
    const amadeus = page.getByRole("button", {
      name: "打开 Amadeus",
      exact: true,
    });
    await page.goto(path);
    await expect(amadeus).toBeVisible();
    await expect(oldButton).toHaveCount(0);
    await page.getByRole("button", { name: "看板", exact: true }).click();
    await expect(amadeus).toBeVisible();
    await expect(oldButton).toHaveCount(0);
    await amadeus.click();
    await expect(
      page.getByRole("complementary", { name: "Amadeus 助手" }),
    ).toBeVisible();

    await page.route("**/v1/auth/me", async (route) => {
      const response = await route.fetch();
      const account = await response.json();
      account.user.platform_role = "user";
      account.user.is_platform_admin = false;
      account.permission_keys = ["content.read"];
      await route.fulfill({ response, json: account });
    });
    await page.goto(path);
    await expect(
      page.getByRole("button", { name: "查看项目验收" }),
    ).toBeVisible();
    await expect(oldButton).toHaveCount(0);
    await expect(page.getByText("历史对话", { exact: true })).toHaveCount(0);
    expect(oldConversationRequests).toEqual([]);
  });
}
