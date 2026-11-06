import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { OutputHistory } from "@features/visual-workshop/board/OutputHistory";
import type { BoardController } from "@features/visual-workshop/board/boardTypes";
import {
  deleteNodeOutput,
  getNodeOutput,
  getNodeOutputs,
  type VisualNodeOutput,
} from "@features/visual-workshop/api";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";

type CanvasResponse = Awaited<ReturnType<typeof deleteNodeOutput>>;

vi.mock("@features/visual-workshop/api", async (original) => ({
  ...(await original<typeof import("@features/visual-workshop/api")>()),
  getNodeOutputs: vi.fn(),
  getNodeOutput: vi.fn(),
  deleteNodeOutput: vi.fn(),
}));
vi.mock("@features/visual-workshop/board/VideoOutputPreview", () => ({
  VideoOutputPreview: ({ assetId }: { assetId?: string }) => (
    <div data-testid="output-preview">{assetId ?? "暂无输出"}</div>
  ),
}));
vi.mock("@features/visual-workshop/board/OutputPreview", () => ({
  OutputPreview: ({ assetId }: { assetId?: string }) => (
    <div data-testid="output-preview">{assetId ?? "暂无输出"}</div>
  ),
}));

function output(
  version: number,
  source: VisualNodeOutput["source"] = "uploaded",
): VisualNodeOutput {
  return {
    id: `output-${version}`,
    node_id: "dance",
    version,
    kind: "video",
    asset_id: `asset-${version}`,
    text: null,
    source,
    generation_task_id: null,
    input_snapshot: [],
    is_final: version === 2,
    created_at: "2026-10-17T04:00:00Z",
  };
}
let outputs: VisualNodeOutput[];
beforeEach(() => {
  vi.resetAllMocks();
  outputs = [output(2), output(1)];
  vi.mocked(getNodeOutputs).mockImplementation(async () => ({
    items: [...outputs],
    total: outputs.length,
  }));
  vi.mocked(getNodeOutput).mockImplementation(async (_project, _node, id) =>
    outputs.find((item) => item.id === id)!,
  );
});

function setup(preview?: VisualNodeOutput) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const initialNode = {
    id: "dance",
    kind: "video" as const,
    title: "舞蹈",
    position: { x: 0, y: 0 },
    final_output_id: "output-2",
    final_version: 2,
    asset_id: "asset-2",
  };
  const initial: CanvasResponse = {
    project_id: "project",
    revision: 7,
    categories: [],
    edges: [],
    updated_at: "2026-10-17T04:00:00Z",
    nodes: [initialNode],
  };
  const prepare = vi.fn().mockResolvedValue(7);
  function Harness() {
    const canvas = useQuery({
      queryKey: visualWorkshopQueryKeys.canvas("project"),
      queryFn: async () => initial,
      initialData: initial,
      staleTime: Infinity,
    });
    const [selected, onPreview] = useState(preview);
    const controller = {
      projectId: "project",
      nodes: canvas.data.nodes,
      edges: [],
      client,
      prepareCanvasForAgent: prepare,
    } as unknown as BoardController;
    return (
      <OutputHistory
        controller={controller}
        nodeId="dance"
        preview={selected}
        onPreview={onPreview}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  const updated = (
    remaining: VisualNodeOutput[] = [output(1)],
  ): CanvasResponse => ({
    ...initial,
    revision: 8,
    nodes: [
      {
        ...initialNode,
        asset_id: remaining[0]?.asset_id ?? null,
        final_output_id: remaining[0]?.id ?? null,
        final_version: remaining[0]?.version ?? null,
      },
    ],
  });
  return { client, prepare, updated };
}

test("uploaded final and historical versions have separate delete actions with a cancellable confirmation", async () => {
  const user = userEvent.setup();
  setup();
  await user.click(
    await screen.findByRole("button", { name: "删除上传版本 v1" }),
  );
  const dialog = screen.getByRole("alertdialog", { name: "删除输出版本 v1" });
  expect(screen.getByLabelText("当前预览 v2 · 最终输出 v2")).toBeVisible();
  expect(screen.getByRole("button", { name: "删除上传版本 v2" })).toBeEnabled();
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(deleteNodeOutput).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

test("deleting the uploaded final uses the saved revision, disables duplicate actions and previews the fallback", async () => {
  const user = userEvent.setup();
  const { prepare, updated, client } = setup(outputs[0]);
  let complete!: (canvas: CanvasResponse) => void;
  vi.mocked(deleteNodeOutput).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await user.click(
    await screen.findByRole("button", { name: "删除上传版本 v2" }),
  );
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent("删除后将使用剩余的最新版本");
  await user.click(within(dialog).getByRole("button", { name: "删除版本" }));
  await waitFor(() =>
    expect(deleteNodeOutput).toHaveBeenCalledWith(
      "project",
      "dance",
      "output-2",
      7,
    ),
  );
  expect(prepare).toHaveBeenCalledOnce();
  expect(
    within(dialog).getByRole("button", { name: "处理中…" }),
  ).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
  outputs = [{ ...output(1), is_final: true }];
  complete(updated());
  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "删除上传版本 v2" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("当前预览 v1 · 最终输出 v1")).toBeVisible();
  expect(screen.getAllByTestId("output-preview")[0]).toHaveTextContent(
    "asset-1",
  );
  expect(
    client.getQueryData<CanvasResponse>(
      visualWorkshopQueryKeys.canvas("project"),
    )?.revision,
  ).toBe(8);
});

test("removing the only uploaded output clears an explicit preview and shows an empty output", async () => {
  const user = userEvent.setup();
  outputs = [output(2)];
  const { updated } = setup(outputs[0]);
  vi.mocked(deleteNodeOutput).mockImplementation(async () => {
    outputs = [];
    return updated([]);
  });
  await user.click(
    await screen.findByRole("button", { name: "删除上传版本 v2" }),
  );
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "删除版本",
    }),
  );
  expect(
    await screen.findByLabelText("当前预览 — · 最终输出 未设置"),
  ).toBeVisible();
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "删除上传版本 v2" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getAllByTestId("output-preview")[0]).toHaveTextContent(
    "暂无输出",
  );
});

test("fixed reference or CAS failure keeps the dialog, version and preview for an explicit retry", async () => {
  const user = userEvent.setup();
  setup();
  vi.mocked(deleteNodeOutput).mockRejectedValue(
    new Error("请先解除固定引用，再删除版本"),
  );
  await user.click(
    await screen.findByRole("button", { name: "删除上传版本 v2" }),
  );
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "删除版本",
    }),
  );
  expect(
    await within(screen.getByRole("alertdialog")).findByRole("alert"),
  ).toHaveTextContent("请先解除固定引用");
  expect(screen.getByLabelText("当前预览 v2 · 最终输出 v2")).toBeVisible();
  expect(screen.getByRole("button", { name: "删除上传版本 v2" })).toBeEnabled();
  expect(deleteNodeOutput).toHaveBeenCalledOnce();
});

test("an unsaved canvas failure stops deletion before calling the API", async () => {
  const user = userEvent.setup();
  const { prepare } = setup();
  prepare.mockRejectedValue(new Error("请先处理画布保存冲突"));
  await user.click(
    await screen.findByRole("button", { name: "删除上传版本 v2" }),
  );
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "删除版本",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "请先处理画布保存冲突",
  );
  expect(deleteNodeOutput).not.toHaveBeenCalled();
});

test("generated and legacy outputs keep the existing history deletion flow", async () => {
  const user = userEvent.setup();
  outputs = [output(2, "generated"), output(1, "legacy")];
  setup(outputs[1]);
  expect(
    await screen.findByRole("button", { name: "删除当前历史版本" }),
  ).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: /删除上传版本/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "删除当前历史版本" }));
  expect(
    screen.getByRole("alertdialog", { name: "删除输出版本 v1" }),
  ).toBeVisible();
});

test("deleting a different uploaded version preserves an explicitly selected historical preview", async () => {
  const user = userEvent.setup();
  const historical = { ...output(3, "generated"), is_final: false };
  outputs.push(historical);
  const { updated } = setup(historical);
  vi.mocked(deleteNodeOutput).mockImplementation(async () => {
    outputs = outputs.filter((item) => item.id !== "output-1");
    return updated([output(2)]);
  });
  await user.click(
    await screen.findByRole("button", { name: "删除上传版本 v1" }),
  );
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "删除版本",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("当前预览 v3 · 最终输出 v2")).toBeVisible();
  expect(screen.getAllByTestId("output-preview")[0]).toHaveTextContent(
    "asset-3",
  );
});
