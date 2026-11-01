import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { GenerationActivity } from "@features/visual-workshop/generation/GenerationActivity";
import {
  batchActivity,
  nodeGenerationActivity,
  taskActivity,
} from "@features/visual-workshop/generation/generationActivityModel";
import { OutputHistory } from "@features/visual-workshop/board/OutputHistory";
import {
  nodeStatus,
  type BoardController,
} from "@features/visual-workshop/board/boardTypes";
import type {
  GenerationBatch,
  GenerationTask,
  VisualCanvasNode,
  VisualNodeOutput,
} from "@features/visual-workshop/api";
import { GenerationDrawer } from "@features/visual-workshop/generation/GenerationDrawer";

vi.mock("@features/visual-workshop/api", async () => ({
  ...(await vi.importActual<typeof import("@features/visual-workshop/api")>(
    "@features/visual-workshop/api",
  )),
  getNodeOutputs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getGenerationOptions: vi.fn().mockResolvedValue({ models: [] }),
  createGenerationTask: vi.fn(),
}));
vi.mock("@features/files/api", async () => ({
  ...(await vi.importActual<typeof import("@features/files/api")>(
    "@features/files/api",
  )),
  getFiles: vi.fn().mockResolvedValue({ items: [] }),
  getFolders: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock("@features/visual-workshop/board/VideoOutputPreview", () => ({
  VideoOutputPreview: ({ assetId }: { assetId?: string }) => (
    <div data-testid="output-preview">{assetId}</div>
  ),
}));
vi.mock("@features/visual-workshop/board/OutputPreview", () => ({
  OutputPreview: ({ assetId }: { assetId?: string }) => (
    <div data-testid="output-preview">{assetId ?? "暂无输出"}</div>
  ),
}));

const node: VisualCanvasNode = {
  id: "video",
  kind: "video",
  title: "绿幕舞蹈",
  position: { x: 0, y: 0 },
  generation_draft: {
    model_id: "model",
    prompt: "绿色背景，完整保留舞蹈动作",
    mode: "text",
    duration: 7,
    ratio: "16:9",
    resolution: "720p",
    watermark: false,
    generate_audio: false,
  },
};
const task: GenerationTask = {
  id: "task",
  project_id: "project",
  canvas_node_id: "video",
  provider_id: "provider",
  model_id: "model",
  provider_kind: "zealman_video",
  kind: "video",
  provider_name: "ZEALMAN",
  model_slug: "u17",
  request_payload: {},
  provider_task_id: "upstream",
  status: "processing",
  progress: 0,
  error_message: null,
  result_asset_id: null,
  can_cancel: false,
  can_retry_materialization: false,
  revision: 1,
  created_at: "2026-10-17T04:00:00Z",
  updated_at: "2026-10-17T04:00:00Z",
  completed_at: null,
};
afterEach(() => vi.useRealTimers());

test("unknown progress stays indeterminate while elapsed time advances", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T04:01:24Z"));
  render(<GenerationActivity activity={taskActivity(task)!} />);
  expect(screen.getByRole("status")).toHaveTextContent("正在生成视频");
  expect(screen.getByLabelText("已用时 01:24")).toBeVisible();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  expect(screen.getByRole("link", { name: "查看生成任务" })).toHaveAttribute(
    "href",
    "/apps/visual-workshop/tasks",
  );
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByLabelText("已用时 01:26")).toBeVisible();
});

test("real progress is rendered and terminal tasks never remain active", () => {
  const { rerender } = render(
    <GenerationActivity activity={taskActivity({ ...task, progress: 82 })!} />,
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "82",
  );
  expect(screen.getByText("82%")).toBeVisible();
  rerender(
    <GenerationActivity activity={taskActivity({ ...task, progress: 100 })!} />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("正在保存输出");
  for (const status of ["completed", "failed"] as const) {
    expect(taskActivity({ ...task, status })).toBeUndefined();
    expect(nodeGenerationActivity(node, [{ ...task, status }])).toBeUndefined();
  }
});

test("sampling and upstream reports stay distinct; stale sampling becomes indeterminate", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T04:01:24Z"));
  render(
    <GenerationActivity
      activity={taskActivity({
        ...task,
        progress: 5,
        execution_info: {
          phase: "running",
          node_id: "7",
          node_label: "SamplerCustom",
          step: 8,
          total_steps: 10,
          reported_progress: 5,
          updated_at: "2026-10-17T04:01:24Z",
          last_event_at: "2026-10-17T04:01:24Z",
          live_status: "connected",
        },
      })!}
    />,
  );
  expect(screen.getByText("采样 80%")).toBeVisible();
  expect(
    screen.getByText(/当前节点 SamplerCustom · 采样 8\/10 步 · 上游报告 5%/),
  ).toBeVisible();
  expect(
    screen.getByRole("progressbar", { name: "当前节点采样进度" }),
  ).toHaveAttribute("aria-valuenow", "80");
  act(() => vi.advanceTimersByTime(61_000));
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  expect(screen.getByText(/采样信息暂未更新/)).toBeVisible();
});

test("queue position and unavailable telemetry do not invent a percentage", () => {
  const { rerender } = render(
    <GenerationActivity
      activity={taskActivity({
        ...task,
        execution_info: {
          phase: "queued",
          queue_position: 3,
          updated_at: task.updated_at,
          live_status: "unavailable",
        },
      })!}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("上游排队中");
  expect(screen.getByText(/队列第 3 位/)).toBeVisible();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  rerender(
    <GenerationActivity
      activity={taskActivity({
        ...task,
        execution_info: {
          phase: "unknown",
          updated_at: task.updated_at,
          live_status: "reconnecting",
        },
      })!}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("等待上游状态");
  expect(screen.getByText(/实时连接重连中/)).toBeVisible();
});

test("node activity selects its newest active task without leaking another node's status", () => {
  const newer = {
    ...task,
    id: "newer",
    status: "queued" as const,
    created_at: "2026-10-17T04:10:00Z",
  };
  const unrelated = {
    ...newer,
    id: "unrelated",
    canvas_node_id: "other",
    created_at: "2026-10-17T04:20:00Z",
  };
  expect(nodeGenerationActivity(node, [task, unrelated, newer])?.id).toBe(
    "newer",
  );
  expect(
    nodeGenerationActivity({ ...node, id: "idle" }, [task]),
  ).toBeUndefined();
  expect(nodeStatus(node, [task], true)).toBe("生成中");
  expect(nodeStatus(node, [{ ...task, status: "failed" }], true)).toBe(
    "可生成",
  );
});

test("image batches stay active while outputs are being arranged", () => {
  const batch = {
    id: "batch",
    generation_node_id: "image",
    created_at: task.created_at,
    status: "processing",
    completed_count: 3,
    grid_size: 4,
  } as GenerationBatch;
  const image: VisualCanvasNode = {
    id: "image",
    kind: "image",
    title: "图片批次",
    position: { x: 0, y: 0 },
  };
  expect(nodeGenerationActivity(image, [], [batch])?.progress).toBe(75);
  expect(batchActivity({ ...batch, completed_count: 4 })?.label).toBe(
    "正在整理输出",
  );
  expect(batchActivity({ ...batch, status: "failed" })).toBeUndefined();
});

test.each(["image", "video", "audio"] as const)(
  "%s composer shows its active state and disables submission",
  async (kind) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { container } = render(
      <QueryClientProvider client={client}>
        <GenerationDrawer
          projectId="project"
          lockedKind={kind}
          compact
          layout="workbench"
          generating
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const button = container.querySelector("[aria-busy='true']");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("生成中");
    expect(
      button?.querySelector(".visual-generation-spinner"),
    ).toBeInTheDocument();
  },
);

test("right preview shows a compact waiting state and keeps existing versions inspectable", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const controller = {
    projectId: "project",
    nodes: [node],
    edges: [],
    client,
  } as unknown as BoardController;
  const onPreview = vi.fn();
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <OutputHistory
        controller={controller}
        nodeId="video"
        tasks={[task]}
        onPreview={onPreview}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText("等待生成画面")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("正在生成视频");
  expect(screen.queryByText("过程预览")).not.toBeInTheDocument();
  expect(screen.queryByText("已提交")).not.toBeInTheDocument();
  expect(
    screen.queryByText("保存输出", { exact: true }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("较早")).not.toBeInTheDocument();
  const preview = {
    id: "old",
    node_id: "video",
    version: 2,
    kind: "video",
    asset_id: "old-video",
    source: "generated",
    created_at: task.created_at,
    input_snapshot: [],
  } as unknown as VisualNodeOutput;
  rerender(
    <QueryClientProvider client={client}>
      <OutputHistory
        controller={controller}
        nodeId="video"
        tasks={[task]}
        preview={preview}
        onPreview={onPreview}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByTestId("output-preview")).toHaveTextContent("old-video");
  expect(screen.getByLabelText("当前预览 v2 · 最终输出 未设置")).toBeVisible();
  expect(screen.queryByLabelText("等待生成画面")).not.toBeInTheDocument();
  rerender(
    <QueryClientProvider client={client}>
      <OutputHistory
        controller={controller}
        nodeId="video"
        tasks={[{ ...task, status: "failed" }]}
        preview={preview}
        onPreview={onPreview}
      />
    </QueryClientProvider>,
  );
  expect(screen.queryByLabelText("当前生成状态")).not.toBeInTheDocument();
  expect(screen.getByTestId("output-preview")).toHaveTextContent("old-video");
});
