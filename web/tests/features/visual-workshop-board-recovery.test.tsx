import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { ProjectBoard } from "@features/visual-workshop/board/ProjectBoard";
import type { BoardController } from "@features/visual-workshop/board/boardTypes";
import { useCanvasPersistence } from "@features/visual-workshop/canvas/useCanvasPersistence";
import {
  putVisualCanvas,
  type VisualCanvasDocument,
} from "@features/visual-workshop/api";

vi.mock("@features/visual-workshop/api", async () => ({
  ...(await vi.importActual<typeof import("@features/visual-workshop/api")>(
    "@features/visual-workshop/api",
  )),
  putVisualCanvas: vi.fn(),
  getGenerationTasks: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getGenerationBatches: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));
vi.mock("@features/visual-workshop/board/OutputHistory", () => ({
  OutputHistory: () => null,
}));
vi.mock("@features/visual-workshop/board/BoardNodeEditor", () => ({
  BoardNodeEditor: () => null,
}));
vi.mock("@features/visual-workshop/board/CommonDesignCards", () => ({
  CommonDesignCards: () => null,
}));

test("loading the latest board after a failed save must unblock generation preparation", async () => {
  const document: VisualCanvasDocument = {
    project_id: "project",
    revision: 0,
    updated_at: "2026-11-20T00:00:00Z",
    categories: [],
    edges: [],
    nodes: [
      {
        id: "first",
        kind: "text",
        title: "original",
        text: "",
        position: { x: 0, y: 0 },
      },
    ],
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let store!: ReturnType<typeof useCanvasPersistence>;
  function Harness() {
    store = useCanvasPersistence("project", document);
    const controller = {
      ...store,
      projectId: "project",
      projectQuery: { data: { title: "Review" } },
      canvasQuery: { data: document },
      client,
      canvasReady: true,
      selectedId: "first",
      setSelectedId: vi.fn(),
      setSelectedNodeIds: vi.fn(),
      upload: { isPending: false, mutate: vi.fn() },
      uploadPosition: { current: undefined },
      renameMutation: { isPending: false, reset: vi.fn() },
    } as unknown as BoardController;
    return (
      <ProjectBoard
        controller={controller}
        onCanvas={vi.fn()}
        previews={{}}
        onPreview={vi.fn()}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  vi.mocked(putVisualCanvas).mockRejectedValueOnce(new Error("network failed"));
  await act(async () => {
    store.patchNode("first", { title: "local draft" }, true);
    await expect(store.prepareCanvasForAgent()).rejects.toThrow(
      "network failed",
    );
  });
  act(() => store.applyServerCanvas({ ...document, revision: 2 }));
  expect(screen.getByRole("button", { name: "加载最新项目" })).toBeVisible();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "加载最新项目" }));
  });
  expect(store.saveState).toBe("saved");
  expect(store.conflict).toBeUndefined();
  await expect(store.prepareCanvasForAgent()).resolves.toBe(2);
});
