import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { VisualWorkshopCanvasPage } from "@features/visual-workshop/canvas";
import { getFiles, getFolders, uploadManagedFile } from "@features/files/api";
import {
  createVisualAssistantConversation,
  createGenerationTask,
  deleteVisualAssistantConversation,
  getGenerationOptions,
  getGenerationTask,
  getVisualAssistantConversation,
  getVisualAssistantConversations,
  getVisualAssistantModels,
  getVisualCanvas,
  getVisualWorkshopProject,
  patchVisualAssistantConversation,
  patchVisualWorkshopProject,
  putVisualCanvas,
  resolveVisualAssistantApproval,
  streamVisualAssistant,
  type VisualAssistantConversation,
} from "@features/visual-workshop/api";
import { ApiError, fetchApiBlob } from "@platform/api/client";

vi.mock("@features/files/AssetBrowser", () => ({
  AssetBrowser: ({ importMode }: { importMode?: boolean }) => (
    <div>{importMode ? "文件管理内容" : "项目素材内容"}</div>
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

const project = {
  id: "project-1",
  title: "未命名项目",
  kind: "canvas" as const,
  status: "draft" as const,
  revision: 0,
  created_at: "2026-08-03T08:00:00Z",
  updated_at: "2026-08-03T08:00:00Z",
};

const assistantConversation: VisualAssistantConversation = {
  id: "assistant-1",
  project_id: "project-1",
  title: "AI 助手对话",
  model_id: "model-chat",
  model_slug: "demo-chat",
  image_model_id: null,
  image_model_slug: "",
  video_model_id: null,
  video_model_slug: "",
  revision: 0,
  created_at: "2026-08-03T08:00:00Z",
  updated_at: "2026-08-03T08:00:00Z",
  messages: [],
};

function renderCanvas() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <VisualWorkshopCanvasPage
        projectId="project-1"
        onBack={vi.fn()}
        onAssets={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    value: MouseEvent,
  });
  vi.mocked(getVisualWorkshopProject).mockResolvedValue(project);
  vi.mocked(getVisualCanvas).mockResolvedValue({
    project_id: "project-1",
    nodes: [],
    revision: 0,
    updated_at: "2026-08-03T08:00:00Z",
  });
  vi.mocked(putVisualCanvas).mockImplementation(
    async (_projectId, nodes, expectedRevision) => ({
      project_id: "project-1",
      nodes,
      revision: expectedRevision + 1,
      updated_at: "2026-08-03T08:00:01Z",
    }),
  );
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
  vi.mocked(getFiles).mockResolvedValue({ items: [] });
  vi.mocked(fetchApiBlob).mockResolvedValue(
    new Blob(["preview"], { type: "image/png" }),
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  vi.mocked(uploadManagedFile).mockReset();
  vi.mocked(getVisualAssistantConversations).mockResolvedValue({
    items: [assistantConversation],
  });
  vi.mocked(getVisualAssistantConversation).mockResolvedValue(
    assistantConversation,
  );
  vi.mocked(createVisualAssistantConversation).mockResolvedValue(
    assistantConversation,
  );
  vi.mocked(getVisualAssistantModels).mockResolvedValue({
    items: [
      {
        id: "model-chat",
        provider_id: "provider-openai",
        provider_name: "OpenAI 兼容网关",
        slug: "demo-chat",
        label: "Demo Chat",
        description: "快速文本模型",
        capabilities: ["chat", "tools"],
      },
      {
        id: "model-vision",
        provider_id: "provider-anthropic",
        provider_name: "Anthropic",
        slug: "claude-vision",
        label: "Claude Vision",
        description: "支持图片理解",
        capabilities: ["chat", "vision"],
      },
    ],
  });
  vi.mocked(getGenerationOptions).mockResolvedValue({
    models: [
      {
        id: "model-image",
        provider_id: "provider-image",
        provider_name: "SenseAudio Image",
        kind: "image",
        slug: "senseaudio-image-pro",
        label: "Image Pro",
        description: "高质量图像生成",
        sizes: ["1024x1024"],
      },
      {
        id: "model-video",
        provider_id: "provider-video",
        provider_name: "SenseAudio Video",
        kind: "video",
        slug: "senseaudio-video-pro",
        label: "Video Pro",
        description: "高质量视频生成",
      },
    ],
  });
  vi.mocked(patchVisualAssistantConversation).mockImplementation(
    async (_projectId, _conversationId, expectedRevision, changes) => ({
      ...assistantConversation,
      title: changes.title ?? assistantConversation.title,
      model_id:
        changes.model_id === undefined
          ? assistantConversation.model_id
          : changes.model_id,
      model_slug:
        changes.model_id === "model-vision"
          ? "claude-vision"
          : changes.model_id === null
            ? ""
            : assistantConversation.model_slug,
      image_model_id:
        changes.image_model_id === undefined
          ? assistantConversation.image_model_id
          : changes.image_model_id,
      image_model_slug:
        changes.image_model_id === "model-image"
          ? "senseaudio-image-pro"
          : changes.image_model_id === null
            ? ""
            : assistantConversation.image_model_slug,
      video_model_id:
        changes.video_model_id === undefined
          ? assistantConversation.video_model_id
          : changes.video_model_id,
      video_model_slug:
        changes.video_model_id === "model-video"
          ? "senseaudio-video-pro"
          : changes.video_model_id === null
            ? ""
            : assistantConversation.video_model_slug,
      revision: expectedRevision + 1,
    }),
  );
  vi.mocked(deleteVisualAssistantConversation).mockResolvedValue({
    deleted: true,
  });
  vi.mocked(resolveVisualAssistantApproval).mockResolvedValue({
    accepted: true,
  });
  vi.mocked(streamVisualAssistant).mockReset();
  vi.mocked(createGenerationTask).mockReset();
  vi.mocked(getGenerationTask).mockReset();
  vi.mocked(patchVisualWorkshopProject).mockImplementation(
    async (current, changes) => ({
      ...current,
      ...changes,
      revision: current.revision + 1,
    }),
  );
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
});

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

test("keeps the local draft visible when canvas CAS conflicts", async () => {
  vi.mocked(putVisualCanvas).mockRejectedValueOnce(
    new ApiError(
      "内容已被其他操作更新",
      {
        code: "revision_conflict",
        current: {
          project_id: "project-1",
          nodes: [],
          revision: 3,
          updated_at: "2026-08-03T08:10:00Z",
        },
      },
      409,
    ),
  );
  const user = userEvent.setup();
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();
  fireEvent.contextMenu(container.querySelector(".visual-canvas-surface")!, {
    clientX: 100,
    clientY: 120,
  });
  await user.click(screen.getByRole("menuitem", { name: "添加文本节点" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "画布存在更新冲突",
  );
  expect(screen.getByDisplayValue("文本1")).toBeInTheDocument();
});

test("renders video nodes as an attached 16:9 creation workspace", async () => {
  vi.mocked(getVisualCanvas).mockResolvedValueOnce({
    project_id: "project-1",
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
  const { container } = renderCanvas();

  expect(await screen.findByText("视频1")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "选择视频素材" }),
  ).toBeInTheDocument();
  expect(container.querySelectorAll(".canvas-node-port")).toHaveLength(2);

  await user.click(screen.getByRole("button", { name: "选择视频素材" }));
  expect(screen.getByRole("complementary", { name: "节点检查器" })).toHaveClass(
    "is-embedded",
  );
  expect(screen.getByRole("tab", { name: "AI 生成" })).toBeInTheDocument();
});

test("renders video node draft references as the canvas preview", async () => {
  vi.mocked(getVisualCanvas).mockResolvedValueOnce({
    project_id: "project-1",
    nodes: [
      {
        id: "video-1",
        kind: "video",
        title: "咖啡馆桌面小世界",
        position: { x: 240, y: 120 },
        asset_id: null,
        generation_task_id: null,
        generation_draft: {
          model_id: "model-video",
          prompt: "桌面小人散步",
          mode: "reference",
          duration: 15,
          resolution: "720p",
          ratio: "16:9",
          watermark: true,
          generate_audio: false,
          first_frame_asset_id: null,
          last_frame_asset_id: null,
          reference_asset_ids: ["reference-image-1"],
          audio_asset_ids: [],
          video_asset_ids: [],
        },
      },
    ],
    revision: 0,
    updated_at: "2026-08-03T08:00:00Z",
  });
  const { container } = renderCanvas();

  expect(await screen.findByText("咖啡馆桌面小世界")).toBeInTheDocument();
  expect(await screen.findByAltText("生成参考素材预览")).toBeInTheDocument();
  expect(fetchApiBlob).toHaveBeenCalledWith(
    "/v1/files/reference-image-1/content",
  );
  expect(
    container
      .querySelector("[data-node-id='video-1']")
      ?.querySelector(".canvas-media-placeholder"),
  ).toBeNull();
});

test("creates video tasks with the selected canvas node link", async () => {
  vi.mocked(getVisualCanvas).mockResolvedValue({
    project_id: "project-1",
    nodes: [
      {
        id: "video-1",
        kind: "video",
        title: "镜头1",
        position: { x: 240, y: 120 },
        asset_id: null,
        generation_task_id: null,
        generation_draft: {
          model_id: "model-video",
          prompt: "轻快打闹镜头",
          mode: "text",
          duration: 5,
          resolution: "720p",
          ratio: "16:9",
          watermark: true,
          generate_audio: false,
          first_frame_asset_id: null,
          last_frame_asset_id: null,
          reference_asset_ids: [],
          audio_asset_ids: [],
          video_asset_ids: [],
        },
      },
    ],
    revision: 0,
    updated_at: "2026-08-03T08:00:00Z",
  });
  vi.mocked(createGenerationTask).mockResolvedValue({
    id: "task-video-1",
    project_id: "project-1",
    provider_id: "provider-video",
    model_id: "model-video",
    provider_kind: "senseaudio_video",
    kind: "video",
    provider_name: "SenseAudio Video",
    model_slug: "senseaudio-video-pro",
    request_payload: {},
    provider_task_id: null,
    status: "queued",
    progress: 0,
    error_message: null,
    result_asset_id: null,
    can_retry_materialization: false,
    revision: 0,
    created_at: "2026-08-03T08:00:00Z",
    updated_at: "2026-08-03T08:00:00Z",
    completed_at: null,
  });
  vi.mocked(getGenerationTask).mockResolvedValue({
    id: "task-video-1",
    project_id: "project-1",
    provider_id: "provider-video",
    model_id: "model-video",
    provider_kind: "senseaudio_video",
    kind: "video",
    provider_name: "SenseAudio Video",
    model_slug: "senseaudio-video-pro",
    request_payload: {},
    provider_task_id: null,
    status: "queued",
    progress: 0,
    error_message: null,
    result_asset_id: null,
    can_retry_materialization: false,
    revision: 0,
    created_at: "2026-08-03T08:00:00Z",
    updated_at: "2026-08-03T08:00:00Z",
    completed_at: null,
  });
  const user = userEvent.setup();
  const { container } = renderCanvas();

  expect(await screen.findByText("镜头1")).toBeInTheDocument();
  const node = container.querySelector<HTMLElement>(
    "[data-node-id='video-1']",
  )!;
  await user.click(node.querySelector<HTMLElement>(".canvas-node-media")!);
  await user.click(await screen.findByRole("button", { name: "生成视频" }));

  await waitFor(() =>
    expect(createGenerationTask).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        canvas_node_id: "video-1",
        expected_canvas_revision: expect.any(Number),
      }),
    ),
  );
  const taskBody = vi.mocked(createGenerationTask).mock.calls[0]?.[1];
  expect(taskBody?.expected_canvas_revision).toBeGreaterThan(0);
  expect(putVisualCanvas).toHaveBeenCalledWith(
    "project-1",
    expect.any(Array),
    0,
  );
});

test("keeps the viewport unchanged when selecting an image node or its material action", async () => {
  vi.mocked(getVisualCanvas).mockResolvedValueOnce({
    project_id: "project-1",
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

  expect(screen.getByRole("complementary", { name: "节点检查器" })).toHaveClass(
    "is-embedded",
  );
  expect(screen.getByRole("button", { name: "110%" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "选择图片素材" }));
  expect(screen.getByRole("tab", { name: "素材" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("button", { name: "110%" })).toBeInTheDocument();
});

test("drags a selected video node from its preview and saves zoom-adjusted coordinates", async () => {
  vi.mocked(getVisualCanvas).mockResolvedValueOnce({
    project_id: "project-1",
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
  const { container } = renderCanvas();

  expect(await screen.findByText("视频1")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "放大" }));
  const node = container.querySelector<HTMLElement>(
    "[data-node-id='video-1']",
  )!;
  const preview = node.querySelector<HTMLElement>(".canvas-node-media")!;

  fireEvent.pointerDown(preview, {
    button: 0,
    clientX: 300,
    clientY: 200,
    pointerId: 1,
  });
  expect(screen.getByRole("complementary", { name: "节点检查器" })).toHaveClass(
    "is-embedded",
  );
  fireEvent.pointerMove(node, {
    clientX: 410,
    clientY: 255,
    pointerId: 1,
  });
  fireEvent.pointerUp(node, { pointerId: 1 });

  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(1));
  expect(vi.mocked(putVisualCanvas).mock.calls[0]?.[1][0]).toMatchObject({
    id: "video-1",
    position: { x: 340, y: 170 },
  });
});

test("does not start node dragging from interactive video controls", async () => {
  vi.mocked(getVisualCanvas).mockResolvedValueOnce({
    project_id: "project-1",
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
  const { container } = renderCanvas();

  expect(await screen.findByText("视频1")).toBeInTheDocument();
  const node = container.querySelector<HTMLElement>(
    "[data-node-id='video-1']",
  )!;
  await user.click(screen.getByRole("button", { name: "选择视频素材" }));
  const blockedTargets = [
    screen.getByRole("textbox", { name: "节点标题" }),
    screen.getByRole("button", { name: "选择视频素材" }),
    screen.getByRole("button", { name: "复制节点" }),
    screen.getByRole("button", { name: "删除节点" }),
    node.querySelector(".canvas-node-port")!,
    screen.getByRole("complementary", { name: "节点检查器" }),
  ];

  blockedTargets.forEach((target, index) => {
    const pointerId = index + 1;
    fireEvent.pointerDown(target, {
      button: 0,
      clientX: 300,
      clientY: 200,
      pointerId,
    });
    fireEvent.pointerMove(node, {
      clientX: 380,
      clientY: 260,
      pointerId,
    });
    fireEvent.pointerUp(node, { pointerId });
  });

  expect(node.style.left).toBe("240px");
  expect(node.style.top).toBe("120px");
  expect(putVisualCanvas).not.toHaveBeenCalled();
});

test("keeps canvas panning stable when pointer movement and release are batched", async () => {
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();
  const surface = container.querySelector<HTMLElement>(
    ".visual-canvas-surface",
  )!;

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

test("keeps wheel scrolling inside an attached node editor", async () => {
  vi.mocked(getVisualCanvas).mockResolvedValueOnce({
    project_id: "project-1",
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
  const inspector = screen.getByRole("complementary", {
    name: "节点检查器",
  });
  const wheel = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 120,
  });

  fireEvent(inspector, wheel);

  expect(wheel.defaultPrevented).toBe(false);
  expect(screen.getByRole("button", { name: "100%" })).toBeInTheDocument();
});

test("zooms, opens project assets, and renames", async () => {
  const user = userEvent.setup();
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();

  const surface = container.querySelector(".visual-canvas-surface")!;
  expect(surface).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "外观模式" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "深色" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(window.localStorage.getItem("future_props_theme")).toBe("dark");
  await user.click(screen.getByRole("button", { name: "浅色" }));
  expect(document.documentElement.dataset.theme).toBe("light");
  await user.click(screen.getByRole("button", { name: "放大" }));
  expect(screen.getByRole("button", { name: "110%" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "素材库" }));
  expect(screen.getByText("项目素材内容")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "列表视图" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(screen.getByRole("tab", { name: "跨项目" }));
  expect(screen.getByText("文件管理内容")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /未命名项目/ }));
  const title = screen.getByDisplayValue("未命名项目");
  await user.clear(title);
  await user.type(title, "秋季主视觉");
  fireEvent.blur(title);
  await waitFor(() =>
    expect(patchVisualWorkshopProject).toHaveBeenCalledWith(project, {
      title: "秋季主视觉",
    }),
  );
  expect(
    screen.queryByRole("button", { name: "进入全屏" }),
  ).not.toBeInTheDocument();
});

test("uses the project dialog before deleting an assistant conversation", async () => {
  const user = userEvent.setup();
  renderCanvas();
  await user.click(await screen.findByRole("button", { name: "对话" }));
  await user.click(screen.getByRole("button", { name: "历史对话" }));
  await user.click(
    screen.getByRole("button", { name: "删除对话 AI 助手对话" }),
  );

  const dialog = screen.getByRole("alertdialog", { name: "删除助手对话" });
  expect(dialog).toHaveTextContent(
    "对话「AI 助手对话」及其中的全部消息将被永久删除。",
  );
  expect(deleteVisualAssistantConversation).not.toHaveBeenCalled();

  await user.click(within(dialog).getByRole("button", { name: "删除对话" }));
  await waitFor(() =>
    expect(deleteVisualAssistantConversation).toHaveBeenCalledWith(
      "project-1",
      "assistant-1",
      0,
    ),
  );
});

test("switches to a newly created assistant conversation immediately", async () => {
  const user = userEvent.setup();
  const createdConversation: VisualAssistantConversation = {
    ...assistantConversation,
    id: "assistant-2",
    title: "新的空白对话",
    revision: 0,
    messages: [],
  };
  vi.mocked(createVisualAssistantConversation).mockResolvedValue(
    createdConversation,
  );
  vi.mocked(getVisualAssistantConversation).mockImplementation(
    async (_projectId, conversationId) =>
      conversationId === createdConversation.id
        ? createdConversation
        : assistantConversation,
  );
  vi.mocked(getVisualAssistantConversations)
    .mockResolvedValueOnce({ items: [assistantConversation] })
    .mockResolvedValue({
      items: [createdConversation, assistantConversation],
    });

  renderCanvas();
  await user.click(await screen.findByRole("button", { name: "对话" }));
  expect(
    await screen.findByRole("button", { name: /AI 助手对话/ }),
  ).toBeVisible();

  await user.click(screen.getByRole("button", { name: "新建对话" }));

  expect(
    await screen.findByRole("button", { name: /新的空白对话/ }),
  ).toBeVisible();
  expect(createVisualAssistantConversation).toHaveBeenCalledWith("project-1");
  await waitFor(() =>
    expect(getVisualAssistantConversation).toHaveBeenCalledWith(
      "project-1",
      "assistant-2",
    ),
  );
});

test("opens the project assistant, attaches an image, streams a reply, and collapses", async () => {
  const user = userEvent.setup();
  const image = {
    id: "image-1",
    project_id: "project-1",
    folder_id: null,
    original_filename: "reference.png",
    display_name: "参考图.png",
    media_kind: "image" as const,
    mime_type: "image/png",
    byte_size: 128,
    revision: 0,
    created_at: "2026-08-03T08:00:00Z",
    updated_at: "2026-08-03T08:00:00Z",
    source: "project" as const,
    is_reference: false,
    reference_id: null,
  };
  vi.mocked(getFiles).mockResolvedValueOnce({ items: [image] });
  let current: VisualAssistantConversation = assistantConversation;
  vi.mocked(getVisualAssistantConversation).mockImplementation(
    async () => current,
  );
  let finishStream: (() => void) | undefined;
  const waitingAction = {
    id: "action-1",
    action_id: "write-1",
    run_id: "run-1",
    approval_group_id: "approval-1",
    position: 0,
    tool_name: "apply_canvas_changes",
    effect: "write" as const,
    status: "waiting_approval" as const,
    display_payload: { label: "更新画布", operation_count: 1 },
    result_payload: {},
    error_message: null,
    duration_ms: null,
    canvas_revision: null,
    generation_task_id: null,
    created_at: "2026-08-03T08:01:00Z",
    updated_at: "2026-08-03T08:01:00Z",
  };
  vi.mocked(streamVisualAssistant).mockImplementation(
    async (_projectId, _conversationId, _body, _signal, onEvent) => {
      current = {
        ...assistantConversation,
        revision: 1,
        messages: [
          {
            id: "user-message",
            turn_id: "turn-1",
            role: "user",
            content: "总结当前画布内容",
            content_parts: [
              { type: "text", text: "总结当前画布内容" },
              { type: "asset", asset_id: image.id },
            ],
            model_slug: "",
            status: "completed",
            error_message: null,
            created_at: "2026-08-03T08:01:00Z",
            assets: [
              {
                id: image.id,
                display_name: image.display_name,
                mime_type: image.mime_type,
                byte_size: image.byte_size,
              },
            ],
          },
          {
            id: "assistant-message",
            turn_id: "turn-1",
            role: "assistant",
            content: "",
            model_slug: "demo-chat",
            status: "pending",
            error_message: null,
            created_at: "2026-08-03T08:01:00Z",
            assets: [],
          },
        ],
      };
      onEvent({
        type: "start",
        schema_version: 2,
        sequence: 0,
        payload: {
          run_id: "run-1",
          assistant_message_id: "assistant-message",
          revision: 1,
          model: "demo-chat",
          agent_mode: "tools",
        },
      });
      onEvent({
        type: "step",
        schema_version: 2,
        sequence: 1,
        payload: { run_id: "run-1", actions: [waitingAction] },
      });
      onEvent({
        type: "approval_required",
        schema_version: 2,
        sequence: 2,
        payload: {
          approval_id: "approval-1",
          canvas_revision: 0,
        },
      });
      await new Promise<void>((resolve) => {
        finishStream = resolve;
      });
      onEvent({
        type: "delta",
        schema_version: 2,
        sequence: 3,
        payload: { text: "画布建议" },
      });
      current = {
        ...current,
        revision: 2,
        messages: current.messages?.map((message) =>
          message.id === "assistant-message"
            ? {
                ...message,
                content: "画布建议",
                status: "completed" as const,
                actions: [
                  {
                    ...waitingAction,
                    status: "completed" as const,
                    canvas_revision: 1,
                    duration_ms: 12,
                  },
                ],
              }
            : message,
        ),
      };
      onEvent({
        type: "approval_resolved",
        schema_version: 2,
        sequence: 4,
        payload: { approval_id: "approval-1", decision: "approve" },
      });
      onEvent({
        type: "step",
        schema_version: 2,
        sequence: 5,
        payload: {
          run_id: "run-1",
          actions: [
            {
              ...waitingAction,
              status: "completed",
              canvas_revision: 1,
              duration_ms: 12,
            },
          ],
        },
      });
      onEvent({
        type: "canvas_updated",
        schema_version: 2,
        sequence: 6,
        payload: { canvas_revision: 1, nodes: [] },
      });
      onEvent({
        type: "done",
        schema_version: 2,
        sequence: 7,
        payload: { revision: 2 },
      });
    },
  );

  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "对话" }));
  expect(await screen.findByText("Hi，我是创作助手")).toBeVisible();
  expect(container.querySelector(".project-assistant-panel")).toHaveClass(
    "is-open",
  );

  await user.click(screen.getByRole("button", { name: "历史对话" }));
  expect(screen.getByRole("dialog", { name: "历史对话" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "历史对话" }));

  await user.click(screen.getByRole("button", { name: "添加附件" }));
  expect(await screen.findByText("参考图.png")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /参考图.png/ }));
  expect(
    screen.getByRole("button", { name: "移除附件 参考图.png" }),
  ).toBeVisible();

  await user.click(screen.getByRole("button", { name: "总结当前画布内容" }));
  expect(screen.getByRole("textbox", { name: "消息内容" })).toHaveTextContent(
    "总结当前画布内容",
  );
  await user.click(screen.getByRole("button", { name: "发送" }));
  expect(streamVisualAssistant).toHaveBeenCalledWith(
    "project-1",
    "assistant-1",
    {
      expected_revision: 0,
      canvas_revision: 0,
      content_parts: [
        { type: "text", text: "总结当前画布内容" },
        { type: "asset", asset_id: "image-1" },
      ],
    },
    expect.any(AbortSignal),
    expect.any(Function),
  );

  expect(await screen.findByLabelText("Agent 执行步骤")).toBeVisible();
  expect(screen.getByTitle("参考图.png")).toBeVisible();
  expect(screen.getByText("等待确认")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "确认执行" }));
  await waitFor(() =>
    expect(resolveVisualAssistantApproval).toHaveBeenCalledWith(
      "project-1",
      "assistant-1",
      "run-1",
      "approval-1",
      "approve",
      0,
    ),
  );

  finishStream?.();
  expect(await screen.findByText("画布建议")).toBeVisible();
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "停止生成" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "收起对话" }));
  expect(container.querySelector(".project-assistant-panel")).not.toHaveClass(
    "is-open",
  );
});

test("mentions project assets inline and keeps duplicate references as one attachment", async () => {
  const user = userEvent.setup();
  const image = {
    id: "image-mention",
    project_id: "project-1",
    folder_id: null,
    original_filename: "mention.png",
    display_name: "角色参考.png",
    media_kind: "image" as const,
    mime_type: "image/png",
    byte_size: 256,
    revision: 0,
    created_at: "2026-08-03T08:00:00Z",
    updated_at: "2026-08-03T08:00:00Z",
    source: "project" as const,
    is_reference: false,
    reference_id: null,
  };
  vi.mocked(getFiles).mockResolvedValue({ items: [image] });
  renderCanvas();

  await user.click(await screen.findByRole("button", { name: "对话" }));
  const editor = screen.getByRole("textbox", { name: "消息内容" });
  await user.click(editor);
  await user.type(editor, "比较 @角色");
  const mentions = await screen.findByRole("listbox", {
    name: "引用项目素材",
  });
  await user.click(
    within(mentions).getByRole("option", { name: /角色参考.png/ }),
  );
  await user.type(editor, " 和 @角色", { skipClick: true });
  expect(
    within(
      await screen.findByRole("listbox", { name: "引用项目素材" }),
    ).getByRole("option", { name: /角色参考.png/ }),
  ).toBeVisible();
  await user.keyboard("{Enter}");

  expect(
    screen.getAllByRole("button", { name: "移除附件 角色参考.png" }),
  ).toHaveLength(2);
  await user.click(
    screen.getAllByRole("button", { name: "移除附件 角色参考.png" })[0],
  );
  expect(
    screen.getAllByRole("button", { name: "移除附件 角色参考.png" }),
  ).toHaveLength(1);

  await user.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() =>
    expect(streamVisualAssistant).toHaveBeenCalledWith(
      "project-1",
      "assistant-1",
      {
        expected_revision: 0,
        canvas_revision: 0,
        content_parts: [
          { type: "text", text: "比较  和 " },
          { type: "asset", asset_id: "image-mention" },
        ],
      },
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
});

test("keeps IME Enter in the editor and sends pasted multiline text", async () => {
  const user = userEvent.setup();
  renderCanvas();

  await user.click(await screen.findByRole("button", { name: "对话" }));
  const editor = screen.getByRole("textbox", { name: "消息内容" });
  await user.click(editor);
  await user.type(editor, "第一行");
  fireEvent.compositionStart(editor);
  fireEvent.keyDown(editor, { key: "Enter", isComposing: true });
  expect(streamVisualAssistant).not.toHaveBeenCalled();
  fireEvent.compositionEnd(editor);

  await user.keyboard("{Shift>}{Enter}{/Shift}");
  await user.type(editor, "第二行", { skipClick: true });
  fireEvent.paste(editor, {
    clipboardData: { getData: () => "<b>纯文本</b>" },
  });
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() =>
    expect(streamVisualAssistant).toHaveBeenCalledWith(
      "project-1",
      "assistant-1",
      {
        expected_revision: 0,
        canvas_revision: 0,
        content_parts: [{ type: "text", text: "第一行\n第二行<b>纯文本</b>" }],
      },
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
});

test("configures text, image, and video models from the assistant header", async () => {
  const user = userEvent.setup();
  renderCanvas();

  await user.click(await screen.findByRole("button", { name: "对话" }));
  await user.click(await screen.findByRole("button", { name: "选择模型" }));

  expect(
    await screen.findByRole("dialog", { name: "配置 Agent 模型" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: /OpenAI 兼容网关/ })).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Anthropic/ }));
  await user.click(screen.getByRole("button", { name: /Claude Vision/ }));

  await waitFor(() =>
    expect(patchVisualAssistantConversation).toHaveBeenCalledWith(
      "project-1",
      "assistant-1",
      0,
      { model_id: "model-vision" },
    ),
  );
  expect(screen.getByRole("dialog", { name: "配置 Agent 模型" })).toBeVisible();

  await user.click(screen.getByRole("tab", { name: /图像生成/ }));
  await user.click(screen.getByRole("button", { name: /Image Pro/ }));
  await waitFor(() =>
    expect(patchVisualAssistantConversation).toHaveBeenCalledWith(
      "project-1",
      "assistant-1",
      1,
      { image_model_id: "model-image" },
    ),
  );

  await user.click(screen.getByRole("tab", { name: /视频生成/ }));
  await user.click(screen.getByRole("button", { name: /Video Pro/ }));
  await waitFor(() =>
    expect(patchVisualAssistantConversation).toHaveBeenCalledWith(
      "project-1",
      "assistant-1",
      2,
      { video_model_id: "model-video" },
    ),
  );
  await user.click(screen.getByRole("button", { name: "恢复自动选择" }));
  await waitFor(() =>
    expect(patchVisualAssistantConversation).toHaveBeenCalledWith(
      "project-1",
      "assistant-1",
      3,
      { video_model_id: null },
    ),
  );
  expect(screen.getByText("配置已保存")).toBeVisible();
});

test("uses the unified attachment panel for project files and local uploads", async () => {
  const user = userEvent.setup();
  const documents = Array.from({ length: 6 }, (_, index) => ({
    id: `document-${index + 1}`,
    project_id: "project-1",
    folder_id: null,
    original_filename: `brief-${index + 1}.md`,
    display_name: `brief-${index + 1}.md`,
    media_kind: "document" as const,
    mime_type: "text/markdown",
    byte_size: 1024,
    revision: 0,
    created_at: "2026-08-03T08:00:00Z",
    updated_at: "2026-08-03T08:00:00Z",
    source: "project" as const,
    is_reference: false,
    reference_id: null,
  }));
  const uploaded = {
    ...documents[0],
    id: "uploaded-pdf",
    original_filename: "storyboard.pdf",
    display_name: "storyboard.pdf",
    mime_type: "application/pdf",
    byte_size: 2048,
  };
  vi.mocked(getFiles).mockResolvedValue({ items: documents });
  vi.mocked(uploadManagedFile).mockResolvedValue(uploaded);

  const { container } = renderCanvas();
  await user.click(await screen.findByRole("button", { name: "对话" }));
  expect(
    container.querySelector(
      'button[aria-label="选择模型"] .lucide-sliders-horizontal',
    ),
  ).toBeInTheDocument();
  expect(
    container.querySelector(
      'button[aria-label="收起对话"] .lucide-panel-right-close',
    ),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "添加附件" }));
  const search = await screen.findByPlaceholderText("搜索项目素材");
  await user.type(search, "brief");
  await waitFor(() =>
    expect(getFiles).toHaveBeenCalledWith({
      projectId: "project-1",
      query: "brief",
      includeReferences: true,
      sort: "updated",
    }),
  );

  const attachmentDialog = screen.getByRole("dialog", { name: "添加附件" });
  await user.click(
    within(attachmentDialog).getByRole("button", { name: /brief-1.md/ }),
  );
  expect(
    screen.getByRole("button", { name: "移除附件 brief-1.md" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "移除附件 brief-1.md" }));
  expect(
    screen.queryByRole("button", { name: "移除附件 brief-1.md" }),
  ).not.toBeInTheDocument();

  const input = container.querySelector(
    '.project-assistant-composer input[type="file"]',
  ) as HTMLInputElement;
  const file = new File(["PDF"], "storyboard.pdf", {
    type: "application/pdf",
  });
  await user.upload(input, file);
  await waitFor(() =>
    expect(uploadManagedFile).toHaveBeenCalledWith(file, "project-1"),
  );
  expect(
    screen.getByRole("button", { name: "移除附件 storyboard.pdf" }),
  ).toBeVisible();

  for (const document of documents.slice(0, 4)) {
    await user.click(
      within(attachmentDialog).getByRole("button", {
        name: new RegExp(document.display_name),
      }),
    );
  }
  expect(screen.getAllByRole("button", { name: /移除附件/ })).toHaveLength(5);
  expect(screen.getByRole("button", { name: "添加附件" })).toBeEnabled();
  expect(
    within(attachmentDialog).getByRole("button", { name: /brief-5.md/ }),
  ).toBeDisabled();
});
