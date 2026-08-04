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
import { VisualWorkshopCanvasPage } from "@features/visual-workshop/VisualWorkshopCanvasPage";
import { getFiles, getFolders, uploadManagedFile } from "@features/files/api";
import {
  createVisualAssistantConversation,
  createGenerationTask,
  deleteVisualAssistantConversation,
  getGenerationTask,
  getVisualAssistantConversation,
  getVisualAssistantConversations,
  getVisualAssistantModels,
  getVisualCanvas,
  getVisualWorkshopProject,
  patchVisualAssistantConversation,
  patchVisualWorkshopProject,
  putVisualCanvas,
  streamVisualAssistant,
  type VisualAssistantConversation,
} from "@features/visual-workshop/api";
import { ApiError } from "@platform/api/client";

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
    getGenerationTask: vi.fn(),
    getVisualAssistantConversation: vi.fn(),
    getVisualAssistantConversations: vi.fn(),
    getVisualAssistantModels: vi.fn(),
    getVisualCanvas: vi.fn(),
    getVisualWorkshopProject: vi.fn(),
    patchVisualAssistantConversation: vi.fn(),
    patchVisualWorkshopProject: vi.fn(),
    putVisualCanvas: vi.fn(),
    streamVisualAssistant: vi.fn(),
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
      revision: expectedRevision + 1,
    }),
  );
  vi.mocked(deleteVisualAssistantConversation).mockResolvedValue({
    deleted: true,
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
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: vi.fn().mockRejectedValue(new Error("unsupported")),
  });
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
  expect(screen.getByRole("tab", { name: "AI 生成" })).toBeInTheDocument();

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
  expect(fittedX).toBeGreaterThan(300);
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

test("zooms, opens project assets, renames, and falls back to immersive mode", async () => {
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
  await user.click(screen.getByRole("tab", { name: "文件管理" }));
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

  await user.click(screen.getByRole("button", { name: "进入全屏" }));
  await waitFor(() =>
    expect(container.querySelector(".visual-canvas")).toHaveClass(
      "is-immersive",
    ),
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(container.querySelector(".visual-canvas")).not.toHaveClass(
    "is-immersive",
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
          assistant_message_id: "assistant-message",
          revision: 1,
          model: "demo-chat",
        },
      });
      onEvent({
        type: "delta",
        schema_version: 2,
        sequence: 1,
        payload: { text: "画布建议" },
      });
      await new Promise<void>((resolve) => {
        finishStream = resolve;
      });
      current = {
        ...current,
        revision: 2,
        messages: current.messages?.map((message) =>
          message.id === "assistant-message"
            ? { ...message, content: "画布建议", status: "completed" as const }
            : message,
        ),
      };
      onEvent({
        type: "done",
        schema_version: 2,
        sequence: 2,
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

  await user.click(screen.getByRole("button", { name: "添加项目图片" }));
  expect(await screen.findByText("参考图.png")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "参考图.png" }));
  expect(screen.getByLabelText("待发送图片")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "总结当前画布内容" }));
  expect(
    screen.getByPlaceholderText("输入创意想法，询问当前画布…"),
  ).toHaveValue("总结当前画布内容");
  await user.click(screen.getByRole("button", { name: "发送" }));
  expect(await screen.findByText("画布建议")).toBeVisible();
  expect(streamVisualAssistant).toHaveBeenCalledWith(
    "project-1",
    "assistant-1",
    {
      expected_revision: 0,
      content: "总结当前画布内容",
      asset_ids: ["image-1"],
    },
    expect.any(AbortSignal),
    expect.any(Function),
  );

  finishStream?.();
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

test("opens the model picker from the assistant header and persists the selection", async () => {
  const user = userEvent.setup();
  renderCanvas();

  await user.click(await screen.findByRole("button", { name: "对话" }));
  await user.click(await screen.findByRole("button", { name: "选择模型" }));

  expect(
    await screen.findByRole("dialog", { name: "选择对话模型" }),
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
  expect(
    screen.queryByRole("dialog", { name: "选择对话模型" }),
  ).not.toBeInTheDocument();
  expect(await screen.findByText("已切换为 claude-vision")).toBeVisible();
});
