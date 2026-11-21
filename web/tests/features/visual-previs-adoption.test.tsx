import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { PrevisReferenceDialog } from "@features/visual-workshop/previs/PrevisReferenceDialog";
import {
  getGenerationOptions,
  uploadMaterialNode,
  type VisualCanvasNode,
} from "@features/visual-workshop/api";
import type { BoardController } from "@features/visual-workshop/board/boardTypes";
import type { PrevisScene } from "@features/visual-workshop/previs/api";
vi.mock("@features/visual-workshop/api", () => ({
  getGenerationOptions: vi.fn(),
  uploadMaterialNode: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
test("an uploaded preview retries node persistence without uploading or patching twice", async () => {
  vi.stubGlobal("crypto", {
    randomUUID: () => "capture-request",
    subtle: { digest: async () => new ArrayBuffer(32) },
  });
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:preview",
    revokeObjectURL: vi.fn(),
  });
  vi.mocked(getGenerationOptions).mockResolvedValue({
    models: [{ id: "model", kind: "image", max_reference_images: 2 }],
  } as unknown as Awaited<ReturnType<typeof getGenerationOptions>>);
  let nodes: VisualCanvasNode[] = [
    {
      id: "target",
      kind: "image",
      title: "镜头",
      position: { x: 0, y: 0 },
      generation_draft: {
        model_id: "model",
        prompt: "保留原提示词",
        reference_asset_ids: [],
      },
    } as unknown as VisualCanvasNode,
  ];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.mocked(uploadMaterialNode).mockImplementation(async () => ({
    project_id: "project",
    revision: 2,
    updated_at: "",
    edges: [],
    nodes: [
      ...nodes,
      {
        id: "previs-capture-request",
        kind: "image",
        title: "帧",
        position: { x: 0, y: 0 },
        asset_id: "captured",
      },
    ],
  }));
  let saves = 0;
  const prepare = vi.fn(async () => {
    if (++saves === 2) throw new Error("保存中断");
    return 2;
  });
  const patch = vi.fn((_id: string, value: Partial<VisualCanvasNode>) => {
    nodes = nodes.map((node) =>
      node.id === "target" ? ({ ...node, ...value } as VisualCanvasNode) : node,
    );
  });
  const controller = {
    projectId: "project",
    nodes,
    edges: [],
    client,
    readCanvas: () => ({ nodes }),
    prepareCanvasForAgent: prepare,
    getInsertionAnchor: () => ({ x: 0, y: 0 }),
    applyServerCanvas: (canvas: { nodes: VisualCanvasNode[] }) => {
      nodes = canvas.nodes;
    },
    patchNode: patch,
  } as unknown as BoardController;
  const file = new File(["png"], "frame.png", { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new ArrayBuffer(3),
  });
  const done = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <PrevisReferenceDialog
        controller={controller}
        value={{
          scene: { id: "scene", revision: 0 } as PrevisScene,
          file,
          number: 1,
          nodeId: "target",
        }}
        onClose={vi.fn()}
        onAdopted={done}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /^加入参考素材$/ }),
    ).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: /^加入参考素材$/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存中断");
  await user.click(screen.getByRole("button", { name: /^加入参考素材$/ }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(uploadMaterialNode).toHaveBeenCalledOnce();
  expect(patch).toHaveBeenCalledOnce();
  expect(nodes[0]).toMatchObject({
    generation_draft: {
      prompt: "保留原提示词",
      reference_asset_ids: ["captured"],
    },
  });
});
