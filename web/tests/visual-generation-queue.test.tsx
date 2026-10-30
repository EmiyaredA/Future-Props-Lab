import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspacePermissionsProvider } from "@platform/auth/WorkspacePermissions";
import {
  CancelQueuedTasks,
  CancelQueuedBatch,
} from "@features/visual-workshop/generation/CancelQueuedTasks";
import { VisualWorkshopTasksPage } from "@features/visual-workshop/generation";
import { OutputHistory } from "@features/visual-workshop/board/OutputHistory";
import type { BoardController } from "@features/visual-workshop/board/boardTypes";
import { submitGenerationTasks } from "@features/visual-workshop/generation/generationSubmission";
import { visualWorkshopQueryKeys as keys } from "@features/visual-workshop/queryKeys";
import {
  cancelGenerationTask,
  createGenerationTask,
  getGenerationTask,
  getGenerationTasks,
  getGenerationBatches,
  getVisualWorkshopProjects,
  getNodeOutputs,
  type GenerationTask,
  type GenerationBatch,
} from "@features/visual-workshop/api";

vi.mock("@features/visual-workshop/api", async () => ({
  ...(await vi.importActual("@features/visual-workshop/api")),
  cancelGenerationTask: vi.fn(),
  createGenerationTask: vi.fn(),
  getGenerationTask: vi.fn(),
  getGenerationTasks: vi.fn(),
  getGenerationBatches: vi.fn(),
  getVisualWorkshopProjects: vi.fn(),
  getNodeOutputs: vi.fn(),
}));
const queued: GenerationTask = {
  id: "waiting",
  project_id: "project",
  canvas_node_id: "node",
  provider_id: "provider",
  model_id: "model",
  provider_kind: "senseaudio_video",
  kind: "video",
  provider_name: "Test",
  model_slug: "Test video",
  request_payload: { prompt: "等待镜头" },
  provider_task_id: null,
  status: "queued",
  progress: 0,
  error_message: null,
  result_asset_id: null,
  can_cancel: true,
  can_retry_materialization: false,
  queue_message: "任务已排队，获得生成额度后将自动执行",
  revision: 3,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  completed_at: null,
};
const batch: GenerationBatch = {
  id: "batch",
  project_id: "project",
  batch_kind: "generation",
  grid_size: 4,
  grid_output: "composite",
  child_task_ids: ["waiting"],
  status: "queued",
  completed_count: 0,
  failed_count: 0,
  cancelled_count: 0,
  result_asset_id: null,
  error_message: null,
  generation_node_id: "node",
  revision: 0,
  created_at: queued.created_at,
  updated_at: queued.updated_at,
  completed_at: null,
};
function mount(
  content: React.ReactNode,
  permissions = ["content.read", "content.write"],
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <WorkspacePermissionsProvider permissions={permissions}>
        {content}
      </WorkspacePermissionsProvider>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cancelGenerationTask).mockResolvedValue({
    ...queued,
    status: "cancelled",
    can_cancel: false,
    revision: 4,
  });
  vi.mocked(getGenerationTask).mockResolvedValue(queued);
  vi.mocked(getGenerationTasks).mockResolvedValue({
    items: [queued],
    total: 1,
  });
  vi.mocked(getGenerationBatches).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(getVisualWorkshopProjects).mockResolvedValue({ items: [] });
  vi.mocked(getNodeOutputs).mockResolvedValue({ items: [], total: 0 });
});

test("取消携带任务 revision，并更新任务缓存及列表", async () => {
  const client = mount(<CancelQueuedTasks tasks={[queued]} />);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await userEvent.click(
    screen.getByRole("button", { name: "取消排队 waiting" }),
  );
  await waitFor(() =>
    expect(cancelGenerationTask).toHaveBeenCalledExactlyOnceWith("waiting", 3),
  );
  await waitFor(() =>
    expect(client.getQueryData(keys.generationTask("waiting"))).toMatchObject({
      status: "cancelled",
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("已取消排队");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.generationTasks });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.generationBatches });
});

test("提交竞争冲突保留反馈并刷新任务，不自动重新取消", async () => {
  vi.mocked(cancelGenerationTask).mockRejectedValue(
    new Error("任务已开始提交，请刷新后重试"),
  );
  const client = mount(<CancelQueuedTasks tasks={[queued]} />);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await userEvent.click(
    screen.getByRole("button", { name: "取消排队 waiting" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("任务已开始提交");
  expect(cancelGenerationTask).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: keys.generationTask("waiting"),
  });
});

test("只读账号和已经提交或取消的任务不展示取消入口", () => {
  mount(
    <CancelQueuedTasks
      tasks={[queued, { ...queued, id: "remote", status: "pending" }]}
    />,
    ["content.read"],
  );
  expect(
    screen.queryByRole("button", { name: /取消排队/ }),
  ).not.toBeInTheDocument();
});

test("宫格读取子任务后允许逐张取消等待", async () => {
  mount(<CancelQueuedBatch batch={batch} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "取消排队 waiting" }),
  );
  await waitFor(() =>
    expect(cancelGenerationTask).toHaveBeenCalledExactlyOnceWith("waiting", 3),
  );
});

test("生成任务页展示本地排队和取消入口", async () => {
  mount(
    <VisualWorkshopTasksPage onOpenProject={vi.fn()} onOpenAssets={vi.fn()} />,
  );
  expect(await screen.findByText("等待镜头")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "取消排队 waiting" }),
  );
  await waitFor(() => expect(cancelGenerationTask).toHaveBeenCalled());
});

test("看板输出区保留排队反馈并提供取消", async () => {
  const client = new QueryClient();
  const controller = {
    projectId: "project",
    client,
    edges: [],
    nodes: [
      {
        id: "node",
        kind: "video",
        title: "视频",
        position: { x: 0, y: 0 },
        generation_task_id: "waiting",
      },
    ],
  } as unknown as BoardController;
  mount(
    <OutputHistory
      controller={controller}
      nodeId="node"
      onPreview={vi.fn()}
      tasks={[queued]}
    />,
  );
  expect(
    await screen.findByRole("button", { name: "取消排队 waiting" }),
  ).toBeVisible();
  expect(screen.getAllByText("排队中").length).toBeGreaterThan(0);
});

test("多次生成遇到队列满时保留已接纳的任务，不自动重提", async () => {
  vi.mocked(createGenerationTask)
    .mockResolvedValueOnce(queued)
    .mockRejectedValueOnce(new Error("队列已满"));
  const onTaskCreated = vi.fn();
  await expect(
    submitGenerationTasks(
      "project",
      {
        body: {
          kind: "image",
          model_id: "model",
          prompt: "镜头",
          size: "1024x1024",
        },
        count: 3,
      },
      { onTaskCreated },
    ),
  ).rejects.toThrow("已接受 1 个任务");
  expect(onTaskCreated).toHaveBeenCalledExactlyOnceWith(queued);
  expect(createGenerationTask).toHaveBeenCalledTimes(2);
});

test("看板合成宫格在任务未关联画布节点时仍可取消子任务", async () => {
  const client = new QueryClient();
  const controller = {
    projectId: "project",
    client,
    edges: [],
    nodes: [
      {
        id: "node",
        kind: "image",
        title: "合成图",
        position: { x: 0, y: 0 },
        generation_batch_id: "batch",
      },
    ],
  } as unknown as BoardController;
  mount(
    <OutputHistory
      controller={controller}
      nodeId="node"
      onPreview={vi.fn()}
      batches={[batch]}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "取消排队 waiting" }),
  );
  await waitFor(() =>
    expect(cancelGenerationTask).toHaveBeenCalledExactlyOnceWith("waiting", 3),
  );
});
