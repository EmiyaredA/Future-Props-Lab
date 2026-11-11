import { beforeEach, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createGenerationTask,
  putVisualCanvas,
  uploadMaterialNode,
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
    createGenerationTask: vi.fn(),
    getGenerationOptions: vi.fn(),
    getGenerationTask: vi.fn(),
    getGenerationTasks: vi.fn(),
    getVisualCanvas: vi.fn(),
    getVisualWorkshopProject: vi.fn(),
    patchVisualWorkshopProject: vi.fn(),
    putVisualCanvas: vi.fn(),
    uploadMaterialNode: vi.fn(),
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

test("opens an Updream-style context menu and persists created nodes", async () => {
  const user = userEvent.setup();
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();
  const surface = container.querySelector(".visual-canvas-surface")!;

  fireEvent.contextMenu(surface, { clientX: 260, clientY: 220 });
  expect(screen.getByRole("menuitem", { name: "上传" })).toBeInTheDocument();
  expect(
    screen.getByRole("menuitem", { name: "添加音频节点" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "添加文本节点" }));

  expect(await screen.findByPlaceholderText("输入文本…")).toBeInTheDocument();
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(1));
  const savedNodes = vi.mocked(putVisualCanvas).mock.calls[0]?.[1];
  expect(savedNodes?.[0]).toMatchObject({
    kind: "text",
    title: "文本1",
    position: { x: 260, y: 220 },
  });

  fireEvent.contextMenu(surface, { clientX: 420, clientY: 280 });
  await user.click(screen.getByRole("menuitem", { name: "添加图片节点" }));
  expect(
    await screen.findByRole("complementary", { name: "节点检查器" }),
  ).toBeVisible();
  expect(createGenerationTask).not.toHaveBeenCalled();
  expect(
    screen.getByRole("complementary", { name: "节点 AI 生成" }),
  ).toBeVisible();
  const imageNode = container.querySelector<HTMLElement>(
    "[data-node-id^='image-']",
  )!;
  expect(imageNode).toHaveClass("canvas-node", "image", "selected");
  expect(imageNode.querySelectorAll(".canvas-node-port")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "选择图片素材" })).toBeVisible();
  expect(screen.getByRole("complementary", { name: "节点检查器" })).toHaveClass(
    "is-embedded",
    "is-image",
  );
  const promptEditor = screen.getByRole("textbox", { name: "图片提示词" });
  const setPointerCapture = vi.mocked(HTMLElement.prototype.setPointerCapture);
  setPointerCapture.mockClear();
  fireEvent.pointerDown(promptEditor, { pointerId: 1 });
  expect(setPointerCapture).not.toHaveBeenCalled();
  await user.click(promptEditor);
  await user.type(promptEditor, "上传素材后仍可编辑");
  expect(promptEditor).toHaveTextContent("上传素材后仍可编辑");

  await user.click(screen.getByRole("button", { name: "选择图片素材" }));
  expect(screen.getByRole("tab", { name: "素材" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await user.click(screen.getByRole("tab", { name: "AI 生成" }));
  expect(
    screen.getByRole("complementary", { name: "节点 AI 生成" }),
  ).toBeVisible();

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
  const inspector = screen.getByRole("complementary", {
    name: "节点检查器",
  });
  Object.defineProperty(inspector, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 696,
      height: 610,
      left: 92,
      right: 502,
      top: 86,
      width: 410,
      x: 92,
      y: 86,
      toJSON: () => undefined,
    }),
  });
  await user.click(screen.getByRole("button", { name: "适配视图" }));
  const world = container.querySelector(".visual-canvas-world") as HTMLElement;
  const fittedX = Number(
    world.style.transform.match(/translate\(([-\d.]+)px/)?.[1],
  );
  expect(fittedX).toBeGreaterThan(200);
});

test("undoes and redoes canvas node changes with keyboard shortcuts", async () => {
  const user = userEvent.setup();
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();
  const surface = container.querySelector(".visual-canvas-surface")!;

  fireEvent.contextMenu(surface, { clientX: 260, clientY: 220 });
  await user.click(screen.getByRole("menuitem", { name: "添加文本节点" }));
  expect(container.querySelectorAll("[data-node-id^='text-']")).toHaveLength(1);

  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() =>
    expect(container.querySelectorAll("[data-node-id^='text-']")).toHaveLength(
      0,
    ),
  );

  fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
  await waitFor(() =>
    expect(container.querySelectorAll("[data-node-id^='text-']")).toHaveLength(
      1,
    ),
  );
});

test("undoes and redoes node prompt edits while the prompt editor is focused", async () => {
  const user = userEvent.setup();
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();
  const surface = container.querySelector(".visual-canvas-surface")!;

  fireEvent.contextMenu(surface, { clientX: 260, clientY: 220 });
  await user.click(screen.getByRole("menuitem", { name: "添加图片节点" }));
  const promptEditor = screen.getByRole("textbox", { name: "图片提示词" });

  await user.click(promptEditor);
  await user.type(promptEditor, "光");
  expect(promptEditor).toHaveAttribute("data-empty", "false");

  fireEvent.keyDown(promptEditor, { key: "z", ctrlKey: true });
  await waitFor(() =>
    expect(promptEditor).toHaveAttribute("data-empty", "true"),
  );

  fireEvent.keyDown(promptEditor, {
    key: "z",
    ctrlKey: true,
    shiftKey: true,
  });
  await waitFor(() =>
    expect(promptEditor).toHaveAttribute("data-empty", "false"),
  );
  expect(promptEditor).toHaveTextContent("光");

  await user.type(promptEditor, "影");
  await user.click(screen.getByRole("button", { name: "展开图片生成器" }));
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => expect(promptEditor).toHaveTextContent("光"));
});

test.each([
  ["image", "图片"],
  ["video", "视频"],
  ["audio", "音频"],
] as const)(
  "keeps the viewport stable when adding a %s node",
  async (kind, label) => {
    window.localStorage.setItem(
      "fpl_canvas_viewport_project-1",
      JSON.stringify({ x: 135, y: -48, zoom: 1.3 }),
    );
    const user = userEvent.setup();
    const { container } = renderCanvas();

    expect(await screen.findByText("未命名项目")).toBeInTheDocument();
    const surface = container.querySelector<HTMLElement>(
      ".visual-canvas-surface",
    )!;
    const world = container.querySelector<HTMLElement>(".visual-canvas-world")!;
    const initialTransform = world.style.transform;

    fireEvent.contextMenu(surface, { clientX: 455, clientY: 312 });
    await user.click(
      screen.getByRole("menuitem", { name: `添加${label}节点` }),
    );
    await act(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );

    const node = container.querySelector<HTMLElement>(
      `[data-node-id^='${kind}-']`,
    )!;
    expect(world.style.transform).toBe(initialTransform);
    expect(Number.parseFloat(node.style.left)).toBeCloseTo((455 - 135) / 1.3);
    expect(Number.parseFloat(node.style.top)).toBeCloseTo((312 + 48) / 1.3);
    expect(node).toHaveClass("selected");
    expect(
      screen.getByRole("complementary", { name: "节点检查器" }),
    ).toBeVisible();
  },
);

test("create menu opens to the right of the add button", async () => {
  const user = userEvent.setup();
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();

  const surface = container.querySelector(".visual-canvas-surface")!;
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
  const addButton = screen.getByRole("button", { name: "添加内容" });
  Object.defineProperty(addButton, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 382,
      height: 42,
      left: 31,
      right: 73,
      top: 340,
      width: 42,
      x: 31,
      y: 340,
      toJSON: () => undefined,
    }),
  });

  await user.click(addButton);
  const menu = screen.getByRole("menu", { name: "添加画布内容" });
  expect(menu).toHaveStyle({ left: "83px", top: "340px" });
});

test("context menu upload creates a media node at the click point", async () => {
  vi.mocked(uploadMaterialNode).mockImplementation(
    async (_projectId, _file, revision, position) => ({
      project_id: "project-1",
      nodes: [
        {
          id: "uploaded-node",
          kind: "image",
          title: "shot",
          position,
          asset_id: "asset-upload",
          final_version: 1,
          final_output_id: "output-1",
        },
      ],
      edges: [],
      revision: revision + 1,
      updated_at: "2026-08-03T08:00:00Z",
    }),
  );
  const user = userEvent.setup();
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();

  const surface = container.querySelector(".visual-canvas-surface")!;
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
  fireEvent.contextMenu(surface, { clientX: 260, clientY: 220 });

  const fileInput = container.querySelector<HTMLInputElement>(
    'input[type="file"][multiple]',
  )!;
  const clickSpy = vi.spyOn(fileInput, "click");
  await user.click(screen.getByRole("menuitem", { name: "上传" }));

  expect(clickSpy).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("menu", { name: "添加画布内容" }),
  ).toBeInTheDocument();

  const file = new File(["img"], "shot.png", { type: "image/png" });
  await user.upload(fileInput, file);

  expect(
    screen.queryByRole("menu", { name: "添加画布内容" }),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByRole("status", { name: "上传状态" }),
  ).toHaveTextContent(/正在上传|已上传并添加到画布/);

  await waitFor(() =>
    expect(uploadMaterialNode).toHaveBeenCalledWith(
      file ? "project-1" : "",
      file,
      0,
      { x: 260, y: 220 },
      undefined,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    ),
  );
  await waitFor(() =>
    expect(
      container.querySelector('[data-node-id="uploaded-node"]'),
    ).toBeInTheDocument(),
  );
  expect(
    await screen.findByRole("status", { name: "上传状态" }),
  ).toHaveTextContent("已上传并添加到画布");
});

test("context menu upload surfaces API failures", async () => {
  vi.mocked(uploadMaterialNode).mockRejectedValueOnce(new Error("磁盘已满"));
  const user = userEvent.setup();
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();

  const surface = container.querySelector(".visual-canvas-surface")!;
  fireEvent.contextMenu(surface, { clientX: 200, clientY: 180 });
  const fileInput = container.querySelector<HTMLInputElement>(
    'input[type="file"][multiple]',
  )!;
  await user.click(screen.getByRole("menuitem", { name: "上传" }));
  await user.upload(
    fileInput,
    new File(["img"], "shot.png", { type: "image/png" }),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent("磁盘已满");
});
