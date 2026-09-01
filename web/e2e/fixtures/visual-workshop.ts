import { test as base, type Page } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const project = {
  id: "persona-project",
  title: "人物旅程项目",
  kind: "canvas",
  status: "draft",
  revision: 0,
  created_at: "2026-08-07T01:00:00Z",
  updated_at: "2026-08-07T01:00:00Z",
};

const sourceProject = {
  ...project,
  id: "persona-source-project",
  title: "跨项目素材源",
  updated_at: "2026-08-06T01:00:00Z",
};

const publicAsset = {
  id: "public-image",
  project_id: null,
  folder_id: null,
  reference_id: null,
  original_filename: "public-image.png",
  display_name: "公共素材.png",
  media_kind: "image",
  mime_type: "image/png",
  byte_size: PNG.byteLength,
  source: "library",
  is_reference: false,
  revision: 0,
  created_at: "2026-08-07T01:00:00Z",
  updated_at: "2026-08-07T01:00:00Z",
};

const uploadedAsset = {
  ...publicAsset,
  id: "persona-upload",
  project_id: project.id,
  original_filename: "Persona 新素材.png",
  display_name: "Persona 新素材.png",
  source: "project",
};

const crossProjectAsset = {
  ...uploadedAsset,
  id: "persona-cross-source",
  project_id: sourceProject.id,
  original_filename: "跨项目参考图.png",
  display_name: "跨项目参考图.png",
};

const importedCrossProjectAsset = {
  ...crossProjectAsset,
  id: "persona-cross-imported",
  project_id: project.id,
};

const failedTask = {
  id: "persona-failed-task",
  project_id: project.id,
  provider_id: "fixture-provider",
  model_id: "fixture-image-model",
  provider_kind: "fixture",
  kind: "image",
  provider_name: "确定性测试供应商",
  model_slug: "fixture-image-model",
  request_payload: { prompt: "需要恢复保存的图片" },
  provider_task_id: "fixture-upstream-task",
  status: "failed",
  progress: 100,
  error_message: "生成已完成，但保存素材失败",
  result_asset_id: null,
  can_retry_materialization: true,
  revision: 1,
  created_at: "2026-08-07T01:00:00Z",
  updated_at: "2026-08-07T01:01:00Z",
  completed_at: null,
};

export type VisualWorkshopPersonaState = {
  projectAssets: Array<Record<string, unknown>>;
  fileListRequests: Array<{ projectId: string; mediaKind: string }>;
  taskListRequests: number;
  retryRequests: number;
  generationRequests: Array<Record<string, unknown>>;
  task: Record<string, unknown>;
};

async function installVisualWorkshopRoutes(
  page: Page,
  state: VisualWorkshopPersonaState,
) {
  let canvas = {
    project_id: project.id,
    edges: [],
    nodes: [
      {
        id: "persona-image-node",
        kind: "image",
        title: "图片1",
        position: { x: 240, y: 180 },
        asset_id: null,
      },
    ],
    revision: 0,
    updated_at: "2026-08-07T01:00:00Z",
  };

  await page.route("**/v1/file-folders**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  await page.route("**/v1/files**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/content")) {
      await route.fulfill({ contentType: "image/png", body: PNG });
      return;
    }
    if (request.method() === "POST") {
      state.projectAssets = [uploadedAsset];
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(uploadedAsset),
      });
      return;
    }
    const projectId = url.searchParams.get("project_id") ?? "";
    const mediaKind = url.searchParams.get("media_kind") ?? "";
    state.fileListRequests.push({ projectId, mediaKind });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items:
          projectId === project.id
            ? state.projectAssets
            : projectId === sourceProject.id
              ? [crossProjectAsset]
              : [publicAsset],
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
              id: "fixture-image-model",
              provider_id: "fixture-provider",
              provider_name: "确定性测试供应商",
              kind: "image",
              slug: "fixture-image-model",
              label: "Fixture Image",
              description: "不会调用真实模型",
              sizes: ["1024x1024"],
            },
          ],
        }),
      });
    },
  );

  await page.route(
    "**/v1/visual-workshop/generation-tasks**",
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.endsWith("/retry-materialization")) {
        state.retryRequests += 1;
        state.task = {
          ...state.task,
          status: "completed",
          error_message: null,
          can_retry_materialization: false,
          revision: 2,
          completed_at: "2026-08-07T01:02:00Z",
        };
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(state.task),
        });
        return;
      }
      state.taskListRequests += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ items: [state.task], total: 1 }),
      });
    },
  );

  await page.route("**/v1/visual-workshop/projects**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.pathname.endsWith("/asset-imports") &&
      request.method() === "POST"
    ) {
      state.projectAssets = [
        ...state.projectAssets.filter(
          (asset) => asset.id !== importedCrossProjectAsset.id,
        ),
        importedCrossProjectAsset,
      ];
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ items: [importedCrossProjectAsset] }),
      });
      return;
    }
    if (
      url.pathname.endsWith("/generation-tasks") &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.generationRequests.push(body);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ...failedTask,
          id: "persona-created-task",
          status: "queued",
          progress: 0,
          error_message: null,
          can_retry_materialization: false,
          request_payload: body,
        }),
      });
      return;
    }
    if (url.pathname.endsWith("/canvas")) {
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as {
          edges: typeof canvas.edges;
          nodes: typeof canvas.nodes;
          expected_revision: number;
        };
        canvas = {
          ...canvas,
          edges: body.edges,
          nodes: body.nodes,
          revision: body.expected_revision + 1,
        };
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(canvas),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        url.pathname.endsWith("/projects")
          ? { items: [project, sourceProject] }
          : url.pathname.includes(sourceProject.id)
            ? sourceProject
            : project,
      ),
    });
  });
}

export const test = base.extend<{
  visualWorkshop: VisualWorkshopPersonaState;
}>({
  visualWorkshop: async ({ page }, provide) => {
    const state: VisualWorkshopPersonaState = {
      projectAssets: [],
      fileListRequests: [],
      taskListRequests: 0,
      retryRequests: 0,
      generationRequests: [],
      task: { ...failedTask },
    };
    await installVisualWorkshopRoutes(page, state);
    await provide(state);
  },
});
