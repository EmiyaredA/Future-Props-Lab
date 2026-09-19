import { beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { uploadManagedFile } from "@features/files/api";
import {
  createGenerationTask,
  getGenerationTask,
  getVisualCanvas,
  putVisualCanvas,
} from "@features/visual-workshop/api";
import { fetchApiBlob } from "@platform/api/client";
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

test("renders video nodes as an attached 16:9 creation workspace", async () => {
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

test.each([0.5, 1, 2])(
  "publishes inverse overlay geometry for canvas zoom %s",
  async (zoom) => {
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
    window.localStorage.setItem(
      "fpl_canvas_viewport_project-1",
      JSON.stringify({ x: 0, y: 0, zoom }),
    );
    const user = userEvent.setup();
    const { container } = renderCanvas();

    expect(await screen.findByText("视频1")).toBeInTheDocument();
    const world = container.querySelector<HTMLElement>(".visual-canvas-world")!;
    expect(world.style.getPropertyValue("--canvas-ui-scale")).toBe(
      String(1 / zoom),
    );
    expect(world.style.getPropertyValue("--canvas-media-actions-top")).toBe(
      `${-43 / zoom}px`,
    );
    expect(world.style.getPropertyValue("--canvas-inspector-gap")).toBe(
      `${22 / zoom}px`,
    );

    await user.click(screen.getByText("视频1"));
    expect(
      container.querySelector(".canvas-media-node-actions"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "选择视频素材" }));
    expect(
      screen.getByRole("complementary", { name: "节点检查器" }),
    ).toHaveClass("is-embedded");
  },
);

test("renders video node draft references as the canvas preview", async () => {
  vi.mocked(getVisualCanvas).mockResolvedValueOnce({
    project_id: "project-1",
    edges: [],
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
    edges: [],
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
    canvas_node_id: "video-1",
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
    canvas_node_id: "video-1",
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
  await user.click(screen.getByRole("button", { name: "替换素材" }));
  await user.click(screen.getByRole("tab", { name: "AI 生成" }));
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
    expect.any(Array),
  );
});

test("drags a selected video node from its preview and saves zoom-adjusted coordinates", async () => {
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
  expect(
    screen.queryByRole("complementary", { name: "节点检查器" }),
  ).not.toBeInTheDocument();
  fireEvent.pointerMove(node, {
    clientX: 410,
    clientY: 255,
    pointerId: 1,
  });
  fireEvent.pointerUp(node, { pointerId: 1 });

  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(1));
  expect(
    screen.queryByRole("complementary", { name: "节点检查器" }),
  ).not.toBeInTheDocument();
  expect(
    node.querySelector(".canvas-media-node-actions"),
  ).not.toBeInTheDocument();

  fireEvent.pointerDown(node, {
    button: 0,
    clientX: 410,
    clientY: 255,
    pointerId: 2,
  });
  fireEvent.pointerUp(node, { pointerId: 2 });
  expect(node.querySelector(".canvas-media-node-actions")).toBeInTheDocument();
  expect(vi.mocked(putVisualCanvas).mock.calls[0]?.[1][0]).toMatchObject({
    id: "video-1",
    position: { x: 340, y: 170 },
  });
});

test("does not start node dragging from interactive video controls", async () => {
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

test("exports a paused video frame and creates an unconnected image node", async () => {
  vi.mocked(getVisualCanvas).mockResolvedValueOnce({
    project_id: "project-1",
    edges: [],
    nodes: [
      {
        id: "video-1",
        kind: "video",
        title: "镜头一",
        position: { x: 240, y: 120 },
        asset_id: "asset-video",
      },
    ],
    revision: 0,
    updated_at: "2026-08-03T08:00:00Z",
  });
  vi.mocked(uploadManagedFile).mockResolvedValue({
    id: "asset-frame",
    project_id: "project-1",
    folder_id: null,
    original_filename: "镜头一-frame_00-00-03-250.png",
    display_name: "镜头一-frame_00-00-03-250",
    media_kind: "image",
    mime_type: "image/png",
    byte_size: 5,
    revision: 0,
    created_at: "2026-08-03T08:00:00Z",
    updated_at: "2026-08-03T08:00:00Z",
    source: "project",
    is_reference: false,
    reference_id: null,
  });
  const pause = vi
    .spyOn(HTMLMediaElement.prototype, "pause")
    .mockImplementation(() => {});
  const download = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback, type) => callback(new Blob(["frame"], { type })),
  );

  const user = userEvent.setup();
  const { container } = renderCanvas();
  const node = await waitFor(() => {
    const current = container.querySelector<HTMLElement>(
      "[data-node-id='video-1']",
    );
    expect(current).not.toBeNull();
    return current!;
  });
  await user.click(node.querySelector<HTMLElement>(".canvas-node-media")!);
  const video = node.querySelector("video")!;
  expect(video).not.toHaveAttribute("controls");
  const playButton = await screen.findByRole("button", { name: "播放视频" });
  await waitFor(() => expect(playButton).toBeEnabled());
  await user.click(playButton);
  expect(video).toHaveAttribute("controls");
  Object.defineProperties(video, {
    currentTime: { configurable: true, writable: true, value: 3.25 },
    duration: { configurable: true, value: 10 },
    readyState: { configurable: true, value: 2 },
    seeking: { configurable: true, value: false },
    videoWidth: { configurable: true, value: 1920 },
    videoHeight: { configurable: true, value: 1080 },
  });
  fireEvent.loadedData(video);
  const exportButton = screen.getByRole("button", {
    name: "导出当前视频帧",
  });
  await waitFor(() => expect(exportButton).toBeEnabled());
  await user.click(exportButton);

  expect(pause).toHaveBeenCalled();
  expect(await screen.findByAltText("当前导出视频帧预览")).toBeVisible();
  expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080);
  const scrubber = screen.getByRole("slider", {
    name: "导出视频帧时间点",
  });
  fireEvent.change(scrubber, { target: { value: "5.5" } });
  fireEvent.pointerUp(scrubber);
  await waitFor(() => expect(video.currentTime).toBe(5.5));
  fireEvent.seeked(video);
  await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole("button", { name: "导出并保存" }));

  await waitFor(() => expect(uploadManagedFile).toHaveBeenCalledTimes(1));
  const [file, projectId] = vi.mocked(uploadManagedFile).mock.calls[0]!;
  expect(projectId).toBe("project-1");
  expect(file.name).toBe("镜头一-frame_00-00-05-500.png");
  await waitFor(() =>
    expect(putVisualCanvas).toHaveBeenCalledWith(
      "project-1",
      expect.arrayContaining([
        expect.objectContaining({
          kind: "image",
          asset_id: "asset-frame",
          position: { x: 608, y: 120 },
        }),
      ]),
      expect.any(Number),
      [],
    ),
  );
  expect(container.querySelector(".canvas-node.image.selected")).not.toBeNull();
  expect(download).toHaveBeenCalledOnce();
  expect(video.currentTime).toBe(3.25);
});
