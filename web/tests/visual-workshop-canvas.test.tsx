import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
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
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
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
