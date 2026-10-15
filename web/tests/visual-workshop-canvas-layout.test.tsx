import { beforeEach, expect, test, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@platform/api/client";
import {
  getVisualCanvas,
  getGenerationBatches,
  getNodeOutputs,
  putVisualCanvas,
  uploadMaterialNode,
  type VisualCanvasNode,
  type VisualCanvasDocument,
} from "@features/visual-workshop/api";
import {
  rectanglesOverlap,
  nodeRect,
} from "@features/visual-workshop/canvas/canvasPlacement";
import { CANVAS_ASSET_DRAG_MIME } from "@features/visual-workshop/canvas/canvasAssetDrag";
import {
  primeCanvasMocks,
  renderCanvas,
} from "./support/visual-workshop-canvas-harness";

vi.mock("@features/visual-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/visual-workshop/api")
  >("@features/visual-workshop/api");
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function" ? vi.fn() : value,
    ]),
  );
});
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
vi.mock("@platform/api/client", async () => {
  const actual = await vi.importActual<typeof import("@platform/api/client")>(
    "@platform/api/client",
  );
  return { ...actual, fetchApiBlob: vi.fn() };
});
vi.mock("@features/files/AssetBrowser", () => ({
  AssetBrowser: () => <div>素材列表</div>,
}));

const textNode = (id: string, x = 0, y = 0): VisualCanvasNode => ({
  id,
  kind: "text",
  title: id,
  text: "原文",
  position: { x, y },
});
let saved: VisualCanvasDocument;
beforeEach(() => {
  primeCanvasMocks();
  saved = {
    project_id: "project-1",
    nodes: [textNode("a"), textNode("b"), textNode("stationary", 800, 800)],
    edges: [{ id: "a-b", source_node_id: "a", target_node_id: "b" }],
    revision: 0,
    updated_at: "2026-10-07T00:00:00Z",
  };
  vi.mocked(getVisualCanvas).mockImplementation(async () =>
    structuredClone(saved),
  );
  vi.mocked(putVisualCanvas).mockImplementation(
    async (_id, nodes, revision, edges) => {
      saved = { ...saved, nodes, edges: edges ?? [], revision: revision + 1 };
      return structuredClone(saved);
    },
  );
  vi.mocked(getGenerationBatches).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(getNodeOutputs).mockResolvedValue({ items: [], total: 0 });
});
function expectSeparated(nodes: VisualCanvasNode[]) {
  nodes.forEach((a, i) =>
    nodes
      .slice(i + 1)
      .forEach((b) =>
        expect(rectanglesOverlap(nodeRect(a), nodeRect(b))).toBe(false),
      ),
  );
}

test("one click arranges and saves once; undo/redo each restore the whole layout; unchanged layout is a no-op", async () => {
  const user = userEvent.setup();
  const original = structuredClone(saved);
  renderCanvas();
  await user.click(await screen.findByRole("button", { name: "一键整理" }));
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(1));
  const arranged = structuredClone(saved);
  expectSeparated(arranged.nodes);
  expect(arranged.edges).toEqual(original.edges);
  await user.click(screen.getByRole("button", { name: "一键整理" }));
  expect(putVisualCanvas).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByRole("region", { name: "节点画布" }), {
    key: "z",
    ctrlKey: true,
  });
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(2));
  expect(saved.nodes).toEqual(original.nodes);
  fireEvent.keyDown(screen.getByRole("region", { name: "节点画布" }), {
    key: "z",
    ctrlKey: true,
    shiftKey: true,
  });
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(3));
  expect(saved.nodes).toEqual(arranged.nodes);
});

test("selected layout preserves unselected nodes and menu keyboard navigation preserves selection", async () => {
  const user = userEvent.setup();
  const { container } = renderCanvas();
  await screen.findByRole("button", { name: "一键整理" });
  const surface = screen.getByRole("region", { name: "节点画布" });
  fireEvent.pointerDown(surface, {
    button: 0,
    clientX: -10,
    clientY: -10,
    pointerId: 1,
  });
  fireEvent.pointerMove(surface, { clientX: 400, clientY: 250, pointerId: 1 });
  fireEvent.pointerUp(surface, { pointerId: 1 });
  const trigger = screen.getByRole("button", { name: "选中节点整理方式" });
  trigger.focus();
  await user.keyboard("{ArrowDown}");
  expect(
    screen.getByRole("menuitem", { name: "按连线整理选中" }),
  ).toHaveFocus();
  await user.keyboard("{ArrowDown}{Escape}");
  expect(trigger).toHaveFocus();
  expect(container.querySelectorAll(".canvas-node.selected")).toHaveLength(2);
  expect(putVisualCanvas).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "整理选中节点" }));
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledOnce());
  expect(saved.nodes[2].position).toEqual({ x: 800, y: 800 });
  expect(container.querySelectorAll(".canvas-node.selected")).toHaveLength(2);
});

test("dragging disables layout until pointer release", async () => {
  const { container } = renderCanvas();
  const button = await screen.findByRole("button", { name: "一键整理" });
  const node = container.querySelector('[data-node-id="a"]')!;
  fireEvent.pointerDown(node, {
    button: 0,
    clientX: 40,
    clientY: 40,
    pointerId: 1,
  });
  expect(button).toBeDisabled();
  fireEvent.pointerCancel(node, { pointerId: 1 });
  expect(button).toBeEnabled();
  expect(putVisualCanvas).not.toHaveBeenCalled();
});

test("save failure keeps the arranged draft; conflict prevents another layout", async () => {
  const user = userEvent.setup();
  vi.mocked(putVisualCanvas).mockRejectedValueOnce(new Error("离线"));
  const { container } = renderCanvas();
  await user.click(await screen.findByRole("button", { name: "一键整理" }));
  await screen.findByText("离线");
  expect(container.querySelector('[data-node-id="b"]')).toHaveStyle({
    left: "396px",
  });
  expect(putVisualCanvas).toHaveBeenCalledOnce();
  vi.mocked(putVisualCanvas).mockRejectedValueOnce(
    new ApiError("冲突", { detail: "冲突", status: 409, current: saved }, 409),
  );
  await user.click(screen.getByRole("button", { name: "画布整理方式" }));
  await user.click(screen.getByRole("menuitem", { name: "网格整理全部" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "一键整理" })).toBeDisabled(),
  );
  expect(putVisualCanvas).toHaveBeenCalledTimes(2);
});

test("toolbar, right-click and board additions share avoidance and view switches preserve positions", async () => {
  const user = userEvent.setup();
  const consoleError = vi.spyOn(console, "error");
  renderCanvas();
  await user.click(await screen.findByRole("button", { name: "添加内容" }));
  await user.click(screen.getByRole("menuitem", { name: "添加文本节点" }));
  await waitFor(() => expect(saved.nodes).toHaveLength(4));
  const surface = screen.getByRole("region", { name: "节点画布" });
  fireEvent.contextMenu(surface, { clientX: 0, clientY: 0 });
  await user.click(screen.getByRole("menuitem", { name: "添加文本节点" }));
  await waitFor(() => expect(saved.nodes).toHaveLength(5));
  // Existing overlaps are retained; the newly created cards avoid every existing card.
  for (const added of saved.nodes.slice(3)) {
    for (const other of saved.nodes.filter((node) => node.id !== added.id))
      expect(rectanglesOverlap(nodeRect(added), nodeRect(other))).toBe(false);
  }
  const before = structuredClone(saved.nodes);
  await user.click(screen.getByRole("button", { name: "看板" }));
  await user.click(screen.getByRole("button", { name: "新建" }));
  await waitFor(() => expect(saved.nodes).toHaveLength(6));
  expect(saved.nodes.slice(0, 5)).toEqual(before);
  await user.click(screen.getByRole("button", { name: "画布" }));
  expect(saved.nodes.slice(0, 5)).toEqual(before);
  expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
  consoleError.mockRestore();
});

test("batch uploads use latest returned nodes and stop on failure without replaying earlier files", async () => {
  saved.nodes = [textNode("original", 80, 80)];
  vi.mocked(uploadMaterialNode).mockImplementation(
    async (_id, file, revision, position) => {
      if (file.name === "fail.png") throw new Error("上传中断");
      saved = {
        ...saved,
        revision: revision + 1,
        nodes: [
          ...saved.nodes,
          {
            id: file.name,
            kind: "image",
            title: file.name,
            position: position!,
            asset_id: file.name,
          },
        ],
      };
      return structuredClone(saved);
    },
  );
  const { container } = renderCanvas();
  await screen.findByRole("button", { name: "添加内容" });
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: {
      files: [
        new File(["png"], "one.png", { type: "image/png" }),
        new File(["png"], "two.png", { type: "image/png" }),
        new File(["png"], "fail.png", { type: "image/png" }),
      ],
    },
  });
  await screen.findByText("上传中断");
  expect(uploadMaterialNode).toHaveBeenCalledTimes(3);
  expect(
    vi.mocked(uploadMaterialNode).mock.calls.map((call) => call[2]),
  ).toEqual([0, 1, 2]);
  expectSeparated(saved.nodes);
  expect(saved.nodes).toHaveLength(3);
});

test("board uploads keep the chosen category and group for every file and persist on reload", async () => {
  const user = userEvent.setup();
  saved.categories = [
    { id: "character", name: "人设", groups: ["主角"] },
    { id: "scene", name: "场景", groups: [] },
  ];
  saved.nodes = [];
  vi.mocked(uploadMaterialNode).mockImplementation(
    async (_id, file, revision, position, destination) => {
      saved = {
        ...saved,
        revision: revision + 1,
        nodes: [
          ...saved.nodes,
          {
            id: file.name,
            kind: "image",
            title: file.name,
            position,
            ...destination,
          },
        ],
      };
      return structuredClone(saved);
    },
  );
  const view = renderCanvas();
  await screen.findByRole("button", { name: "添加内容" });
  await user.click(screen.getByRole("button", { name: "看板" }));
  await user.click(screen.getByRole("button", { name: "管理分类 人设" }));
  await user.click(screen.getByRole("menuitem", { name: "上传到此分类" }));
  expect(screen.getByRole("combobox", { name: "上传分类" })).toHaveTextContent(
    "人设",
  );
  await user.click(screen.getByRole("combobox", { name: "上传分组" }));
  await user.click(screen.getByRole("option", { name: "主角" }));
  const files = ["one.png", "two.png"].map(
    (name) => new File(["png"], name, { type: "image/png" }),
  );
  await user.upload(screen.getByLabelText("上传项目素材文件"), files);
  await waitFor(() => expect(saved.nodes).toHaveLength(2));
  expect(
    vi.mocked(uploadMaterialNode).mock.calls.map((call) => [call[2], call[4]]),
  ).toEqual([
    [0, { category_id: "character", group: "主角" }],
    [1, { category_id: "character", group: "主角" }],
  ]);
  view.unmount();
  renderCanvas();
  const material = await screen.findByRole("button", {
    name: /^one\.png 图像/,
  });
  expect(material.closest(".board-category")).toHaveTextContent("人设");
  expect(material.closest(".board-group")).toHaveTextContent("主角");
});

test("asset drop at an occupied point creates a free card without moving the original", async () => {
  saved.nodes = [textNode("original")];
  renderCanvas();
  const surface = await screen.findByRole("region", { name: "节点画布" });
  const event = new MouseEvent("drop", {
    bubbles: true,
    cancelable: true,
    clientX: 0,
    clientY: 0,
  });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types: [CANVAS_ASSET_DRAG_MIME],
      getData: () =>
        JSON.stringify({
          assetId: "asset",
          mediaKind: "image",
          displayName: "参考",
          importMode: "none",
        }),
    },
  });
  fireEvent(surface, event);
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledOnce());
  expectSeparated(saved.nodes);
  expect(saved.nodes[0].position).toEqual({ x: 0, y: 0 });
  await act(async () => {});
});
