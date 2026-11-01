import { beforeEach, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getVisualCanvas } from "@features/visual-workshop/api";
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

test("keeps the viewport unchanged when selecting an image node or its material action", async () => {
  vi.mocked(getVisualCanvas).mockResolvedValueOnce({
    project_id: "project-1",
    edges: [],
    nodes: [
      {
        id: "image-1",
        kind: "image",
        title: "图片1",
        position: { x: 240, y: 120 },
        asset_id: null,
      },
    ],
    revision: 0,
    updated_at: "2026-08-03T08:00:00Z",
  });
  const user = userEvent.setup();
  const { container } = renderCanvas();

  expect(await screen.findByText("图片1")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "放大" }));
  expect(screen.getByRole("button", { name: "110%" })).toBeInTheDocument();

  const node = container.querySelector<HTMLElement>(
    "[data-node-id='image-1']",
  )!;
  await user.click(node.querySelector<HTMLElement>(".canvas-node-media")!);

  expect(
    screen.getByRole("complementary", { name: "节点检查器" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "110%" })).toBeInTheDocument();

  await user.dblClick(node.querySelector<HTMLElement>(".canvas-node-media")!);
  expect(screen.getByRole("dialog", { name: "图片1" })).toBeVisible();
  expect(
    screen.queryByRole("complementary", { name: "节点检查器" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "关闭媒体预览" }));

  await user.click(screen.getByRole("button", { name: "选择图片素材" }));
  expect(screen.getByRole("tab", { name: "素材" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("button", { name: "110%" })).toBeInTheDocument();
});

test("keeps canvas panning stable when pointer movement and release are batched", async () => {
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();
  const surface = container.querySelector<HTMLElement>(
    ".visual-canvas-surface",
  )!;
  fireEvent.keyDown(window, { code: "Space", key: " " });

  act(() => {
    surface.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 120,
        clientY: 140,
      }),
    );
    surface.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        button: 0,
        clientX: 220,
        clientY: 200,
      }),
    );
    surface.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        clientX: 220,
        clientY: 200,
      }),
    );
  });
  fireEvent.keyUp(window, { code: "Space", key: " " });

  expect(container.querySelector(".visual-canvas")).toBeInTheDocument();
  expect(
    container.querySelector<HTMLElement>(".visual-canvas-world")?.style
      .transform,
  ).toContain("translate(100px, 60px)");
});

test("captures trackpad pinch zoom after the asynchronous canvas mount", async () => {
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();
  const surface = container.querySelector<HTMLElement>(
    ".visual-canvas-surface",
  )!;
  const pinch = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: 400,
    clientY: 300,
    ctrlKey: true,
    deltaY: -10,
  });
  fireEvent(surface, pinch);
  expect(pinch.defaultPrevented).toBe(true);
  expect(screen.getByRole("button", { name: "111%" })).toBeInTheDocument();
});

test("rebinds pinch zoom to each canvas surface after switching through the board", async () => {
  const user = userEvent.setup();
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();

  for (let cycle = 0; cycle < 2; cycle++) {
    const previous = container.querySelector<HTMLElement>(
      ".visual-canvas-surface",
    )!;
    await user.click(screen.getByRole("button", { name: "看板" }));
    const detachedPinch = new WheelEvent("wheel", {
      cancelable: true,
      ctrlKey: true,
      deltaY: -10,
    });
    fireEvent(previous, detachedPinch);
    expect(detachedPinch.defaultPrevented).toBe(false);

    await user.click(screen.getByRole("button", { name: "画布" }));
    const surface = container.querySelector<HTMLElement>(
      ".visual-canvas-surface",
    )!;
    expect(surface).not.toBe(previous);
    const pinch = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 400,
      clientY: 300,
      ctrlKey: true,
      deltaY: -10,
    });
    fireEvent(surface, pinch);
    expect(pinch.defaultPrevented).toBe(true);
    expect(
      screen.getByRole("button", { name: cycle === 0 ? "111%" : "122%" }),
    ).toBeInTheDocument();
  }
});

test("handles native pinch gestures when the project initially opens in board mode", async () => {
  window.localStorage.setItem("visual-project-view:project-1", "board");
  const user = userEvent.setup();
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "画布" }));
  const surface = container.querySelector<HTMLElement>(
    ".visual-canvas-surface",
  )!;
  const start = new Event("gesturestart", { cancelable: true });
  fireEvent(surface, start);
  expect(start.defaultPrevented).toBe(true);
  for (const scale of [1.2, 1.5]) {
    const change = Object.assign(
      new Event("gesturechange", { cancelable: true }),
      { scale, clientX: 400, clientY: 300 },
    );
    fireEvent(surface, change);
    expect(change.defaultPrevented).toBe(true);
  }
  expect(screen.getByRole("button", { name: "150%" })).toBeInTheDocument();
  expect(
    container.querySelector<HTMLElement>(".visual-canvas-world")?.style
      .transform,
  ).toContain("translate(-200px, -150px)");
  const end = new Event("gestureend", { cancelable: true });
  fireEvent(surface, end);
  expect(end.defaultPrevented).toBe(true);
});

test("keeps ordinary panel scrolling but captures panel pinch zoom", async () => {
  vi.mocked(getVisualCanvas).mockResolvedValueOnce({
    project_id: "project-1",
    edges: [],
    nodes: [
      {
        id: "video-1",
        kind: "video",
        title: "视频1",
        position: { x: 240, y: 120 },
        asset_id: null,
      },
    ],
    revision: 0,
    updated_at: "2026-08-03T08:00:00Z",
  });
  const user = userEvent.setup();
  renderCanvas();
  expect(await screen.findByText("视频1")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "选择视频素材" }));
  const inspector = screen.getByRole("complementary", { name: "节点检查器" });
  const wheel = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 120,
  });
  fireEvent(inspector, wheel);
  expect(wheel.defaultPrevented).toBe(false);
  expect(screen.getByRole("button", { name: "100%" })).toBeInTheDocument();
  const pinch = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    deltaY: -10,
  });
  fireEvent(inspector, pinch);
  expect(pinch.defaultPrevented).toBe(true);
  expect(screen.getByRole("button", { name: "111%" })).toBeInTheDocument();
});

test("canvas chrome opens the current website in a browser window", async () => {
  const user = userEvent.setup();
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "新建窗口" }));
  expect(open).toHaveBeenCalledWith(
    window.location.href,
    "_blank",
    "noopener,noreferrer",
  );
});
