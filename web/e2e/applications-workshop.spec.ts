import { expect, test } from "@playwright/test";

test("enters the visual workshop, persists projects, and supports deep navigation", async ({
  page,
}) => {
  let projects: Array<Record<string, unknown>> = [];
  let generationTasks: Array<Record<string, unknown>> = [];
  let exposeReferenceImage = false;
  const referenceImage = {
    id: "e2e-reference-image",
    project_id: "e2e-project",
    folder_id: null,
    reference_id: null,
    original_filename: "e2e-reference.png",
    display_name: "E2E 参考图.png",
    media_kind: "image",
    mime_type: "image/png",
    byte_size: 1024,
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
  let assistantConversation: Record<string, unknown> | undefined;
  await page.route("**/v1/visual-workshop/projects**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.includes("/conversations")) {
      if (url.pathname.endsWith("/conversations/models")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                id: "e2e-chat-model",
                provider_id: "e2e-openai",
                provider_name: "OpenAI 兼容网关",
                slug: "e2e-chat-model",
                label: "E2E Chat",
                description: "确定性文本模型",
                capabilities: ["chat", "tools"],
              },
              {
                id: "e2e-vision-model",
                provider_id: "e2e-anthropic",
                provider_name: "Anthropic",
                slug: "e2e-vision-model",
                label: "E2E Vision",
                description: "确定性视觉模型",
                capabilities: ["chat", "vision"],
              },
            ],
          }),
        });
        return;
      }
      if (url.pathname.endsWith("/messages/stream")) {
        const body = request.postDataJSON() as {
          content?: string;
          content_parts?: Array<{ type: string; text?: string }>;
        };
        const content =
          body.content ??
          body.content_parts
            ?.filter((part) => part.type === "text")
            .map((part) => part.text ?? "")
            .join("") ??
          "";
        assistantConversation = {
          ...assistantConversation,
          title: content.slice(0, 24),
          revision: 2,
          updated_at: "2026-08-03T08:01:10Z",
          messages: [
            {
              id: "e2e-user-message",
              turn_id: "e2e-turn",
              role: "user",
              content,
              model_slug: "",
              status: "completed",
              error_message: null,
              created_at: "2026-08-03T08:01:00Z",
              assets: [],
            },
            {
              id: "e2e-assistant-message",
              turn_id: "e2e-turn",
              role: "assistant",
              content: "E2E 助手建议：先完善主视觉，再统一素材色调。",
              model_slug: "e2e-chat-model",
              status: "completed",
              error_message: null,
              created_at: "2026-08-03T08:01:01Z",
              assets: [],
              actions: [
                {
                  id: "e2e-action",
                  action_id: "e2e-read-canvas",
                  run_id: "e2e-run",
                  approval_group_id: null,
                  position: 0,
                  tool_name: "read_canvas",
                  effect: "read",
                  status: "completed",
                  display_payload: { label: "读取最新画布" },
                  result_payload: { canvas_revision: canvas.revision },
                  error_message: null,
                  duration_ms: 8,
                  canvas_revision: canvas.revision,
                  generation_task_id: null,
                  created_at: "2026-08-03T08:01:00Z",
                  updated_at: "2026-08-03T08:01:01Z",
                },
              ],
            },
          ],
        };
        const events = [
          {
            type: "start",
            schema_version: 2,
            sequence: 0,
            payload: {
              run_id: "e2e-run",
              assistant_message_id: "e2e-assistant-message",
              model: String(
                assistantConversation?.model_slug || "e2e-chat-model",
              ),
              model_changed_from: null,
              agent_mode: "tools",
              revision: 1,
            },
          },
          {
            type: "step",
            schema_version: 2,
            sequence: 1,
            payload: {
              run_id: "e2e-run",
              actions: (
                assistantConversation?.messages as Array<
                  Record<string, unknown>
                >
              )[1].actions,
            },
          },
          {
            type: "delta",
            schema_version: 2,
            sequence: 2,
            payload: { text: "E2E 助手建议：先完善主视觉，再统一素材色调。" },
          },
          {
            type: "done",
            schema_version: 2,
            sequence: 3,
            payload: { revision: 2 },
          },
        ];
        await route.fulfill({
          contentType: "text/event-stream",
          body: events
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(""),
        });
        return;
      }
      if (url.pathname.endsWith("/conversations")) {
        if (request.method() === "POST") {
          assistantConversation = {
            id: "e2e-conversation",
            project_id: "e2e-project",
            title: "AI 助手对话",
            model_id: null,
            model_slug: "",
            revision: 0,
            created_at: "2026-08-03T08:00:30Z",
            updated_at: "2026-08-03T08:00:30Z",
            messages: [],
          };
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(assistantConversation),
          });
          return;
        }
        const summary = Object.fromEntries(
          Object.entries(assistantConversation ?? {}).filter(
            ([key]) => key !== "messages",
          ),
        );
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            items: assistantConversation ? [summary] : [],
          }),
        });
        return;
      }
      if (request.method() === "PATCH" && assistantConversation) {
        const body = request.postDataJSON() as { model_id?: string | null };
        assistantConversation = {
          ...assistantConversation,
          model_id: body.model_id,
          model_slug:
            body.model_id === "e2e-vision-model" ? "e2e-vision-model" : "",
          revision: Number(assistantConversation.revision) + 1,
        };
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(assistantConversation),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(assistantConversation),
      });
      return;
    }
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
        items: exposeReferenceImage ? [referenceImage] : [],
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
  await page.getByRole("button", { name: /浏览应用/ }).click();
  await expect(page).toHaveURL(/\/apps$/);
  await page.getByRole("button", { name: "打开视觉创作工坊" }).click();
  await expect(page).toHaveURL(/\/apps\/visual-workshop$/);
  await expect(page.locator(".studio-sidebar")).toHaveCount(0);
  await expect(page.locator(".workshop-brand img")).toHaveAttribute(
    "src",
    "/brand/visual-workshop-mark.png",
  );
  await expect(page.getByText("浏览全部应用")).toBeVisible();
  await expect(page.getByText("还没有创作项目")).toBeVisible();

  await page.getByRole("button", { name: /新建第一个项目/ }).click();
  await expect(page).toHaveURL(
    /\/apps\/visual-workshop\/projects\/e2e-project\/canvas$/,
  );
  await expect(page.getByText("未命名项目")).toBeVisible({ timeout: 15_000 });
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
  await page.getByRole("tab", { name: "跨项目" }).click();
  await expect(page.getByText("文件管理中还没有可导入的文件")).toBeVisible();
  await page.getByRole("button", { name: "管理素材" }).click();
  await expect(page).toHaveURL(
    /\/apps\/visual-workshop\/projects\/e2e-project\/assets$/,
  );
  await expect(page.getByRole("heading", { name: "项目素材库" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /从文件管理导入/ })).toBeVisible();
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
    buffer: Buffer.from("e2e-reference-image"),
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
  await page.getByRole("tab", { name: "AI 生成" }).click();
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

  await page.getByRole("button", { name: "对话" }).click();
  const assistantPanel = page.locator(".project-assistant-panel");
  await expect(assistantPanel).toHaveClass(/is-open/);
  await expect(assistantPanel).toHaveCSS("width", "418px");
  await page.getByRole("button", { name: "历史对话" }).click();
  await page.getByRole("button", { name: "删除对话 AI 助手对话" }).click();
  const deleteDialog = page.getByRole("alertdialog", {
    name: "删除助手对话",
  });
  await expect(deleteDialog).toBeVisible();
  await expect(page.locator(".confirm-dialog-backdrop")).toHaveCSS(
    "position",
    "fixed",
  );
  await expect(deleteDialog).toHaveCSS("width", "440px");
  await deleteDialog.getByRole("button", { name: "取消" }).click();
  await page.getByRole("button", { name: "历史对话" }).click();
  await page.getByRole("button", { name: "选择模型" }).click();
  await expect(
    page.getByRole("dialog", { name: "配置 Agent 模型" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /图像生成/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /视频生成/ })).toBeVisible();
  await page.getByRole("button", { name: /Anthropic/ }).click();
  await page.getByRole("button", { name: /E2E Vision/ }).click();
  await expect(
    page.getByRole("dialog", { name: "配置 Agent 模型" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭模型选择" }).click();
  await page.getByRole("button", { name: "总结当前画布内容" }).click();
  await expect(page.getByRole("textbox", { name: "消息内容" })).toContainText(
    "总结当前画布内容",
  );
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(/E2E 助手建议/)).toBeVisible();
  await expect(page.getByLabel("Agent 执行步骤")).toBeVisible();
  await expect(page.getByText("读取画布")).toBeVisible();

  await page.setViewportSize({ width: 700, height: 800 });
  await expect(assistantPanel).toHaveCSS("left", "10px");
  await expect(assistantPanel).toHaveCSS("right", "10px");
  await page.getByRole("button", { name: "收起对话" }).click();
  await expect(assistantPanel).not.toHaveClass(/is-open/);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "返回项目列表" }).click();
  await expect(page).toHaveURL(/\/apps\/visual-workshop$/);
  await expect(page.getByText("未命名项目")).toBeVisible();
  await page.getByRole("button", { name: /返回应用中心/ }).click();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(page.locator(".studio-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "文件管理" }).click();
  await expect(page).toHaveURL(/\/files$/);
  await expect(page.getByRole("heading", { name: "文件管理" })).toBeVisible();

  await page.setViewportSize({ width: 700, height: 800 });
  await page.goto("/apps/visual-workshop/tasks");
  await expect(page.getByText("E2E 未来城市海报")).toBeVisible();
  await expect(page.getByText("42%")).toBeVisible();
  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
