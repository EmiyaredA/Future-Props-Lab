import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi, type Mock } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import {
  createImageComposition,
  type ImageCompositionInput,
  type VisualCanvasNode,
} from "@features/visual-workshop/api";
import { useImageGridComposition } from "@features/visual-workshop/canvas/useImageGridComposition";
import { ImageGridCompositionDialog } from "@features/visual-workshop/canvas/ImageGridCompositionDialog";
import { placeNode } from "@features/visual-workshop/canvas/canvasPlacement";

vi.mock("@features/visual-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/visual-workshop/api")
  >("@features/visual-workshop/api");
  return { ...actual, createImageComposition: vi.fn() };
});

function setup(prepare: Mock) {
  const nodesRef = {
    current: [
      {
        id: "source",
        kind: "image",
        title: "图",
        position: { x: 100, y: 200 },
        asset_id: "asset",
      },
      {
        id: "blocker",
        kind: "image",
        title: "挡住",
        position: { x: 868, y: 200 },
      },
    ] as VisualCanvasNode[],
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const view = renderHook(
    () =>
      useImageGridComposition({
        projectId: "p",
        nodes: nodesRef.current,
        nodesRef,
        selectedNodeIds: ["source"],
        revisionRef: { current: 1 },
        prepareCanvas: () => prepare(nodesRef),
        client,
        resolveNodePosition: (kind, anchor) =>
          placeNode(nodesRef.current, kind, anchor),
        revealNodes: vi.fn(),
        setSelectedNodeIds: vi.fn(),
        setInspectedNodeId: vi.fn(),
        setAssetsOpen: vi.fn(),
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  act(() => view.result.current.openComposition(["source"]));
  const children = view.result.current.compositionOverlay.props.children as {
    type: unknown;
    props: ComponentProps<typeof ImageGridCompositionDialog>;
  }[];
  const dialog = children.find(
    (child) => child && child.type === ImageGridCompositionDialog,
  )!;
  return { nodesRef, invalidate, submit: dialog.props.onSubmit };
}
const body: ImageCompositionInput = {
  grid_size: 4,
  items: Array.from({ length: 4 }, () => ({
    node_id: "source",
    asset_id: "asset",
    caption: "",
  })),
  title: "结果",
  expected_canvas_revision: 1,
  result_position: { x: 0, y: 0 },
};

test("composition flushes the draft then uses the latest positions and revision", async () => {
  const prepare = vi.fn(async (ref: { current: VisualCanvasNode[] }) => {
    ref.current[0] = { ...ref.current[0], position: { x: 500, y: 200 } };
    return 7;
  });
  vi.mocked(createImageComposition).mockResolvedValue({
    id: "batch",
  } as Awaited<ReturnType<typeof createImageComposition>>);
  const { submit, nodesRef, invalidate } = setup(prepare);
  await act(async () => {
    await submit(body);
  });
  expect(prepare).toHaveBeenCalledOnce();
  expect(createImageComposition).toHaveBeenCalledWith(
    "p",
    expect.objectContaining({
      expected_canvas_revision: 7,
      result_position: placeNode(nodesRef.current, "image", { x: 868, y: 200 }),
    }),
  );
  expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(createImageComposition).mock.invocationCallOrder[0],
  );
  await waitFor(() => expect(invalidate).toHaveBeenCalledOnce());
});

test("failed draft saving prevents composition submission", async () => {
  vi.mocked(createImageComposition).mockClear();
  const { submit } = setup(
    vi.fn().mockRejectedValue(new Error("草稿尚未保存")),
  );
  await expect(submit(body)).rejects.toThrow("草稿尚未保存");
  expect(createImageComposition).not.toHaveBeenCalled();
});
