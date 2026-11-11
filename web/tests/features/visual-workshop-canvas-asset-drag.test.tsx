import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { importFile, importManagedFiles } from "@features/files/api";
import { putVisualCanvas } from "@features/visual-workshop/api";
import {
  CANVAS_ASSET_DRAG_MIME,
  isCanvasMediaKind,
  readCanvasAssetDragData,
  setCanvasAssetDragData,
} from "@features/visual-workshop/canvas/canvasAssetDrag";
import {
  primeCanvasMocks,
  renderCanvas,
} from "../support/visual-workshop-canvas-harness";

vi.mock("@features/files/AssetBrowser", () => ({
  AssetBrowser: () => <div>项目素材内容</div>,
}));
vi.mock("@features/files/api", async () => {
  const actual = await vi.importActual<typeof import("@features/files/api")>(
    "@features/files/api",
  );
  return {
    ...actual,
    getFiles: vi.fn(),
    getFolders: vi.fn(),
    importFile: vi.fn(),
    importManagedFiles: vi.fn(),
    uploadManagedFile: vi.fn(),
  };
});
vi.mock("@features/visual-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/visual-workshop/api")
  >("@features/visual-workshop/api");
  return {
    ...actual,
    createGenerationTask: vi.fn(),
    getGenerationOptions: vi.fn(),
    getGenerationTask: vi.fn(),
    getGenerationTasks: vi.fn(),
    getVisualCanvas: vi.fn(),
    getVisualWorkshopProject: vi.fn(),
    patchVisualWorkshopProject: vi.fn(),
    putVisualCanvas: vi.fn(),
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

function createCanvasAssetTransfer(
  payload: Parameters<typeof setCanvasAssetDragData>[1],
) {
  const store = new Map<string, string>();
  const types: string[] = [];
  const dataTransfer = {
    dropEffect: "none",
    effectAllowed: "all",
    files: [],
    items: [],
    get types() {
      return types.slice();
    },
    clearData(format?: string) {
      if (format) {
        store.delete(format);
        const index = types.indexOf(format);
        if (index >= 0) types.splice(index, 1);
        return;
      }
      store.clear();
      types.length = 0;
    },
    getData(format: string) {
      return store.get(format) ?? "";
    },
    setData(format: string, value: string) {
      store.set(format, value);
      if (!types.includes(format)) types.push(format);
    },
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
  setCanvasAssetDragData(dataTransfer, payload);
  return dataTransfer;
}

function fireCanvasDragEvent(
  element: Element,
  type: "dragover" | "drop",
  dataTransfer: DataTransfer,
  clientX: number,
  clientY: number,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  fireEvent(element, event);
}

async function prepareSurface() {
  const view = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();
  const surface = view.container.querySelector(".visual-canvas-surface")!;
  Object.defineProperty(surface, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 720,
      height: 720,
      left: 0,
      right: 1280,
      top: 0,
      width: 1280,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    }),
  });
  return { surface };
}

test("canvas asset drag payload round-trips and rejects non-media kinds", () => {
  expect(isCanvasMediaKind("image")).toBe(true);
  expect(isCanvasMediaKind("font")).toBe(false);

  const dataTransfer = createCanvasAssetTransfer({
    assetId: "asset-1",
    mediaKind: "image",
    displayName: "菲莉丝",
    importMode: "library",
  });
  expect(Array.from(dataTransfer.types)).toContain(CANVAS_ASSET_DRAG_MIME);
  expect(readCanvasAssetDragData(dataTransfer)).toEqual({
    assetId: "asset-1",
    mediaKind: "image",
    displayName: "菲莉丝",
    importMode: "library",
    sourceProjectId: undefined,
  });
});

test("dropping a project asset creates a media node at the world point", async () => {
  const { surface } = await prepareSurface();
  const dataTransfer = createCanvasAssetTransfer({
    assetId: "asset-project",
    mediaKind: "image",
    displayName: "本项目图",
    importMode: "none",
  });

  fireCanvasDragEvent(surface, "dragover", dataTransfer, 300, 180);
  fireCanvasDragEvent(surface, "drop", dataTransfer, 300, 180);

  await waitFor(() =>
    expect(putVisualCanvas).toHaveBeenCalledWith(
      "project-1",
      expect.arrayContaining([
        expect.objectContaining({
          kind: "image",
          asset_id: "asset-project",
          title: "本项目图",
          position: { x: 300, y: 180 },
        }),
      ]),
      expect.any(Number),
      [],
    ),
  );
  expect(importFile).not.toHaveBeenCalled();
  expect(importManagedFiles).not.toHaveBeenCalled();
  expect(
    await screen.findByRole("status", { name: "上传状态" }),
  ).toHaveTextContent("已添加到画布");
});

test("dropping a library asset imports a reference before creating the node", async () => {
  vi.mocked(importFile).mockResolvedValue({
    id: "asset-library",
    project_id: null,
    folder_id: null,
    original_filename: "lib.png",
    display_name: "总文件图",
    media_kind: "image",
    mime_type: "image/png",
    byte_size: 4,
    revision: 0,
    created_at: "2026-08-03T08:00:00Z",
    updated_at: "2026-08-03T08:00:00Z",
    source: "library",
    is_reference: true,
    reference_id: "ref-1",
  });
  const { surface } = await prepareSurface();
  const dataTransfer = createCanvasAssetTransfer({
    assetId: "asset-library",
    mediaKind: "image",
    displayName: "总文件图",
    importMode: "library",
  });

  fireCanvasDragEvent(surface, "drop", dataTransfer, 120, 90);

  await waitFor(() =>
    expect(importFile).toHaveBeenCalledWith("project-1", "asset-library"),
  );
  await waitFor(() =>
    expect(putVisualCanvas).toHaveBeenCalledWith(
      "project-1",
      expect.arrayContaining([
        expect.objectContaining({
          kind: "image",
          asset_id: "asset-library",
          title: "总文件图",
          position: { x: 120, y: 90 },
        }),
      ]),
      expect.any(Number),
      [],
    ),
  );
  expect(
    await screen.findByRole("status", { name: "上传状态" }),
  ).toHaveTextContent("已导入并添加到画布");
});

test("dropping a cross-project asset uses the copied asset id", async () => {
  vi.mocked(importManagedFiles).mockResolvedValue({
    items: [
      {
        id: "asset-copied",
        project_id: "project-1",
        folder_id: null,
        original_filename: "cross.png",
        display_name: "跨项目图",
        media_kind: "image",
        mime_type: "image/png",
        byte_size: 4,
        revision: 0,
        created_at: "2026-08-03T08:00:00Z",
        updated_at: "2026-08-03T08:00:00Z",
        source: "project",
        is_reference: false,
        reference_id: null,
      },
    ],
  });
  const { surface } = await prepareSurface();
  const dataTransfer = createCanvasAssetTransfer({
    assetId: "asset-source",
    mediaKind: "image",
    displayName: "跨项目图",
    importMode: "cross-project",
    sourceProjectId: "project-other",
  });

  fireCanvasDragEvent(surface, "drop", dataTransfer, 200, 140);

  await waitFor(() =>
    expect(importManagedFiles).toHaveBeenCalledWith("project-1", {
      sourceScope: "project",
      sourceProjectId: "project-other",
      assetIds: ["asset-source"],
    }),
  );
  await waitFor(() =>
    expect(putVisualCanvas).toHaveBeenCalledWith(
      "project-1",
      expect.arrayContaining([
        expect.objectContaining({
          kind: "image",
          asset_id: "asset-copied",
          title: "跨项目图",
          position: { x: 200, y: 140 },
        }),
      ]),
      expect.any(Number),
      [],
    ),
  );
});
