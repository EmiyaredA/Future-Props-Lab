import { beforeEach, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneCanvasSelection } from "@features/visual-workshop/canvas/canvasClipboard";
import { ApiError } from "@platform/api/client";
import {
  createGenerationTask,
  getVisualCanvas,
  type VisualCanvasNode,
  type VisualCanvasDocument,
  putVisualCanvas,
} from "@features/visual-workshop/api";
import {
  primeCanvasMocks,
  renderCanvas,
} from "./support/visual-workshop-canvas-harness";

vi.mock("@features/files/AssetBrowser", () => ({
  AssetBrowser: ({
    importSource,
  }: {
    importSource?: "library" | "cross-project";
  }) => (
    <div>
      {importSource === "library"
        ? "文件管理内容"
        : importSource === "cross-project"
          ? "跨项目内容"
          : "项目素材内容"}
    </div>
  ),
}));
vi.mock("@features/files/api", async () => {
  const actual = await vi.importActual<typeof import("@features/files/api")>(
    "@features/files/api",
  );
  return {
    ...actual,
    getFiles: vi.fn(),
    getFolders: vi.fn(),
    uploadManagedFile: vi.fn(),
  };
});
vi.mock("@features/visual-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/visual-workshop/api")
  >("@features/visual-workshop/api");
  return {
    ...actual,
    createVisualAssistantConversation: vi.fn(),
    createGenerationTask: vi.fn(),
    deleteVisualAssistantConversation: vi.fn(),
    getGenerationOptions: vi.fn(),
    getGenerationTask: vi.fn(),
    getGenerationTasks: vi.fn(),
    getVisualAssistantConversation: vi.fn(),
    getVisualAssistantConversations: vi.fn(),
    getVisualAssistantModels: vi.fn(),
    getVisualCanvas: vi.fn(),
    getVisualWorkshopProject: vi.fn(),
    patchVisualAssistantConversation: vi.fn(),
    patchVisualWorkshopProject: vi.fn(),
    putVisualCanvas: vi.fn(),
    resolveVisualAssistantApproval: vi.fn(),
    streamVisualAssistant: vi.fn(),
  };
});
vi.mock("@platform/api/client", async () => {
  const actual = await vi.importActual<typeof import("@platform/api/client")>(
    "@platform/api/client",
  );
  return {
    ...actual,
    fetchApiBlob: vi.fn(),
  };
});

beforeEach(primeCanvasMocks);

const initialNodes: VisualCanvasNode[] = [
  {
    id: "image",
    kind: "image",
    title: "原图",
    asset_id: "asset",
    position: { x: 100, y: 100 },
  },
  {
    id: "video",
    kind: "video",
    title: "视频",
    position: { x: 500, y: 100 },
    generation_draft: {
      prompt: "视频描述",
      mode: "text",
      duration: 5,
      resolution: "720p",
      ratio: "16:9",
      watermark: true,
      generate_audio: false,
      reference_asset_ids: ["asset", "external", "manual"],
      prompt_reference_names: {
        asset: "原图",
        external: "外部图",
        manual: "手动素材",
      },
    },
  },
  {
    id: "text",
    kind: "text",
    title: "说明",
    text: "正文",
    position: { x: 100, y: 400 },
  },
  {
    id: "outside",
    kind: "image",
    title: "外部图",
    asset_id: "external",
    position: { x: 2000, y: 100 },
  },
];

function seedCanvas(nodes = initialNodes) {
  const canvas: VisualCanvasDocument = {
    project_id: "project-1",
    revision: 0,
    updated_at: "2026-10-01T00:00:00Z",
    nodes: structuredClone(nodes),
    edges:
      nodes === initialNodes
        ? [
            {
              id: "internal",
              source_node_id: "image",
              target_node_id: "video",
            },
            {
              id: "external",
              source_node_id: "outside",
              target_node_id: "video",
            },
          ]
        : [],
  };
  vi.mocked(getVisualCanvas).mockResolvedValue(canvas);
  vi.mocked(putVisualCanvas).mockImplementation(
    async (_projectId, nextNodes, expectedRevision, nextEdges) => {
      canvas.nodes = nextNodes;
      canvas.edges = nextEdges ?? [];
      canvas.revision = expectedRevision + 1;
      return structuredClone(canvas);
    },
  );
  return canvas;
}

async function openCanvas() {
  const rendered = renderCanvas();
  await screen.findByText("未命名项目");
  await waitFor(() =>
    expect(
      rendered.container.querySelectorAll(".canvas-node"),
    ).not.toHaveLength(0),
  );
  const surface = screen.getByRole("region", { name: "节点画布" });
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 800,
    right: 1000,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => undefined,
  });
  return { ...rendered, surface };
}

function marquee(surface: HTMLElement) {
  fireEvent.pointerDown(surface, { clientX: 90, clientY: 90, button: 0 });
  fireEvent.pointerMove(surface, { clientX: 850, clientY: 650 });
  fireEvent.pointerUp(surface);
}

test("copies mixed marquee selection and internal edges in one save and history step", async () => {
  seedCanvas();
  const { container, surface, unmount } = await openCanvas();
  // A previous text focus must not steal the shortcuts after marquee selection.
  screen.getByLabelText("说明内容").focus();
  marquee(surface);
  expect(document.activeElement).toBe(surface);
  // The existing text editor flushes its save when focus leaves it.
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(1));
  vi.mocked(putVisualCanvas).mockClear();
  expect(
    screen.getByRole("toolbar", { name: "已选节点操作" }),
  ).toHaveTextContent("已选 3 个节点");
  fireEvent.keyDown(surface, { key: "c", metaKey: true });
  expect(putVisualCanvas).not.toHaveBeenCalled();
  fireEvent.pointerMove(surface, { clientX: 1200, clientY: 800 });
  fireEvent.keyDown(surface, { key: "v", metaKey: true });
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(1));
  const [, nodes, revision, edges] = vi.mocked(putVisualCanvas).mock.calls[0];
  expect(revision).toBe(1);
  expect(nodes).toHaveLength(7);
  expect(edges).toHaveLength(3);
  expect(nodes.slice(4).map((node) => node.position)).toEqual([
    { x: 1200, y: 800 },
    { x: 1600, y: 800 },
    { x: 1200, y: 1100 },
  ]);
  expect(nodes[5]).toMatchObject({
    generation_task_id: null,
    generation_draft: { reference_asset_ids: ["asset", "manual"] },
  });
  expect(edges?.[2]).toMatchObject({
    source_node_id: nodes[4].id,
    target_node_id: nodes[5].id,
  });
  expect(container.querySelectorAll(".canvas-node.selected")).toHaveLength(3);
  fireEvent.keyDown(surface, { key: "z", ctrlKey: true });
  await waitFor(() =>
    expect(container.querySelectorAll(".canvas-node")).toHaveLength(4),
  );
  fireEvent.keyDown(surface, { key: "z", ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(3));
  expect(container.querySelectorAll(".canvas-node")).toHaveLength(7);
  unmount();
  const reopened = await openCanvas();
  expect(reopened.container.querySelectorAll(".canvas-node")).toHaveLength(7);
  fireEvent.keyDown(reopened.surface, { key: "v", ctrlKey: true });
  expect(putVisualCanvas).toHaveBeenCalledTimes(3);
  expect(createGenerationTask).not.toHaveBeenCalled();
});

test.each(["toolbar", "context", "text-button", "media-button"])(
  "uses the same snapshot for %s copy and context paste",
  async (entry) => {
    seedCanvas();
    const { container, surface } = await openCanvas();
    const user = userEvent.setup();
    let copiedCount = 3;
    if (entry === "toolbar" || entry === "context") {
      marquee(surface);
      if (entry === "toolbar")
        await user.click(screen.getByRole("button", { name: /^复制$/ }));
      else {
        fireEvent.contextMenu(surface, { clientX: 900, clientY: 700 });
        await user.click(
          screen.getByRole("menuitem", { name: "复制选中节点" }),
        );
      }
    } else {
      copiedCount = 1;
      fireEvent.click(
        container.querySelector(
          `[data-node-id='${entry === "text-button" ? "text" : "image"}']`,
        )!,
      );
      await user.click(screen.getByRole("button", { name: "复制节点" }));
    }
    expect(putVisualCanvas).not.toHaveBeenCalled();
    fireEvent.contextMenu(surface, { clientX: 900, clientY: 700 });
    const paste = screen.getByRole("menuitem", { name: "粘贴" });
    expect(paste).toBeEnabled();
    await user.click(paste);
    await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(1));
    expect(vi.mocked(putVisualCanvas).mock.calls[0][1]).toHaveLength(
      4 + copiedCount,
    );
    expect(vi.mocked(putVisualCanvas).mock.calls[0][1][4].position).toEqual({
      x: 900,
      y: 700,
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  },
);

test("uses current zoom and avoids repeat pastes, resetting the anchor after pointer motion", async () => {
  seedCanvas(initialNodes.slice(0, 1));
  window.localStorage.setItem(
    "fpl_canvas_viewport_project-1",
    JSON.stringify({ x: 100, y: 50, zoom: 0.5 }),
  );
  const { surface } = await openCanvas();
  fireEvent.keyDown(surface, { key: "a", ctrlKey: true });
  fireEvent.keyDown(surface, { key: "c", ctrlKey: true });
  fireEvent.pointerMove(surface, { clientX: 700, clientY: 450 });
  fireEvent.keyDown(surface, { key: "v", ctrlKey: true });
  fireEvent.keyDown(surface, { key: "v", ctrlKey: true });
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(2));
  expect(
    vi
      .mocked(putVisualCanvas)
      .mock.calls[1][1].slice(1)
      .map((node) => node.position),
  ).toEqual([
    { x: 1200, y: 800 },
    { x: 1232, y: 1046 },
  ]);
  fireEvent.pointerMove(surface, { clientX: 750, clientY: 500 });
  fireEvent.keyDown(surface, { key: "v", ctrlKey: true });
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(3));
  expect(vi.mocked(putVisualCanvas).mock.calls[2][1][3].position).toEqual({
    x: 1584,
    y: 900,
  });
  fireEvent.pointerMove(surface, { clientX: 700, clientY: 450 });
  fireEvent.pointerMove(surface, { clientX: 750, clientY: 500 });
  fireEvent.keyDown(surface, { key: "v", ctrlKey: true });
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(4));
  expect(vi.mocked(putVisualCanvas).mock.calls[3][1][4].position).toEqual({
    x: 1436,
    y: 554,
  });
});

test("falls back to the viewport center and keeps the clipboard after empty copy", async () => {
  seedCanvas(initialNodes.slice(0, 1));
  const { surface } = await openCanvas();
  fireEvent.keyDown(surface, { key: "a", ctrlKey: true });
  fireEvent.keyDown(surface, { key: "c", ctrlKey: true });
  fireEvent.keyDown(surface, { key: "Escape" });
  fireEvent.keyDown(surface, { key: "c", ctrlKey: true });
  fireEvent.keyDown(surface, { key: "v", ctrlKey: true });
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(1));
  expect(vi.mocked(putVisualCanvas).mock.calls[0][1][1].position).toEqual({
    x: 500,
    y: 400,
  });
});

test("leaves text, nested rich-text and modal copy/paste shortcuts untouched", async () => {
  seedCanvas();
  const { surface } = await openCanvas();
  marquee(surface);
  fireEvent.keyDown(surface, { key: "c", ctrlKey: true });
  const textarea = screen.getByLabelText("说明内容");
  const richText = document.createElement("div");
  richText.setAttribute("contenteditable", "true");
  richText.innerHTML = "<strong>富文本</strong>";
  const modal = document.createElement("div");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = "<button>弹窗内容</button>";
  surface.append(richText, modal);
  for (const target of [
    textarea,
    richText.firstElementChild!,
    modal.firstElementChild!,
  ]) {
    for (const key of ["c", "v"]) {
      const event = new KeyboardEvent("keydown", {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => target.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
  }
  expect(putVisualCanvas).not.toHaveBeenCalled();
});

test("retains the pasted draft on save failure without retrying the operation", async () => {
  seedCanvas();
  vi.mocked(putVisualCanvas).mockRejectedValueOnce(new Error("磁盘已满"));
  const { surface, container } = await openCanvas();
  marquee(surface);
  fireEvent.keyDown(surface, { key: "c", ctrlKey: true });
  fireEvent.keyDown(surface, { key: "v", ctrlKey: true });
  expect(await screen.findByText("磁盘已满")).toBeVisible();
  expect(container.querySelectorAll(".canvas-node")).toHaveLength(7);
  await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
  expect(putVisualCanvas).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(surface, { key: "z", ctrlKey: true });
  await waitFor(() =>
    expect(container.querySelectorAll(".canvas-node")).toHaveLength(4),
  );
});

test("blocks additional pastes until the save conflict is resolved", async () => {
  const server = structuredClone(seedCanvas());
  vi.mocked(putVisualCanvas).mockRejectedValueOnce(
    new ApiError(
      "冲突",
      {
        type: "about:blank",
        title: "冲突",
        status: 409,
        current: { ...server, revision: 1 },
      },
      409,
    ),
  );
  const { surface, container } = await openCanvas();
  marquee(surface);
  fireEvent.keyDown(surface, { key: "c", ctrlKey: true });
  fireEvent.keyDown(surface, { key: "v", ctrlKey: true });
  await screen.findByText("画布存在更新冲突");
  fireEvent.keyDown(surface, { key: "v", ctrlKey: true });
  expect(
    await screen.findByRole("alert", { name: "画布复制粘贴状态" }),
  ).toHaveTextContent("请先选择要使用的版本");
  expect(putVisualCanvas).toHaveBeenCalledTimes(1);
  expect(container.querySelectorAll(".canvas-node")).toHaveLength(7);
  fireEvent.click(screen.getByRole("button", { name: "载入服务器版本" }));
  fireEvent.keyDown(surface, { key: "v", ctrlKey: true });
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(2));
  expect(container.querySelectorAll(".canvas-node")).toHaveLength(7);
});

test("rejects an oversized group without changing the canvas or history", async () => {
  seedCanvas(
    Array.from({ length: 251 }, (_, index) => ({
      id: `text-${index}`,
      kind: "text",
      title: `说明${index}`,
      text: "",
      position: { x: 0, y: 0 },
    })),
  );
  const { surface, container } = await openCanvas();
  fireEvent.keyDown(surface, { key: "a", ctrlKey: true });
  fireEvent.keyDown(surface, { key: "c", ctrlKey: true });
  fireEvent.keyDown(surface, { key: "v", ctrlKey: true });
  expect(
    await screen.findByRole("alert", { name: "画布复制粘贴状态" }),
  ).toHaveTextContent("500 个节点上限");
  expect(container.querySelectorAll(".canvas-node")).toHaveLength(251);
  fireEvent.keyDown(surface, { key: "z", ctrlKey: true });
  expect(putVisualCanvas).not.toHaveBeenCalled();
});

test("copied fixed bindings retain the original output owner", () => {
  const copied = cloneCanvasSelection(
    {
      nodes: initialNodes.slice(0, 2),
      edges: [
        {
          id: "fixed",
          source_node_id: "image",
          target_node_id: "video",
          binding: "fixed",
          output_id: "image-v2",
          purpose: "reference",
        },
      ],
      origin: { x: 100, y: 100 },
    },
    { x: 1000, y: 1000 },
  );
  expect(copied.edges[0]).toMatchObject({
    source_node_id: "image",
    target_node_id: copied.nodes[1].id,
    binding: "fixed",
    output_id: "image-v2",
  });
  expect(copied.nodes[0].id).not.toBe("image");
});
