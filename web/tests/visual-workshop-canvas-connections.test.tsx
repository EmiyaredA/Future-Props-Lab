import { beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ManagedFile } from "@features/files";
import { getFiles } from "@features/files/api";
import {
  getVisualCanvas,
  putVisualCanvas,
} from "@features/visual-workshop/api";
import { ApiError } from "@platform/api/client";
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

test("uses connection ports without selecting the node or opening its inspector", async () => {
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
      {
        id: "video-2",
        kind: "video",
        title: "视频2",
        position: { x: 640, y: 120 },
        asset_id: null,
      },
    ],
    revision: 0,
    updated_at: "2026-08-03T08:00:00Z",
  });
  const { container } = renderCanvas();
  expect(await screen.findByText("图片1")).toBeInTheDocument();
  const node = container.querySelector<HTMLElement>(
    "[data-node-id='image-1']",
  )!;
  expect(node).not.toHaveClass("selected");

  fireEvent.pointerDown(
    screen.getByRole("button", { name: "从图片1创建连线" }),
    { button: 0, clientX: 560, clientY: 220 },
  );
  const targetPort = screen.getByRole("button", { name: "连接到视频2" });
  const targetNode = container.querySelector<HTMLElement>(
    "[data-node-id='video-2']",
  )!;
  fireEvent.pointerEnter(targetPort);
  expect(targetPort).toHaveClass("is-valid-target");
  expect(targetNode).toHaveClass("is-connectable-target");
  fireEvent.pointerUp(targetPort);
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalled());
  expect(node).not.toHaveClass("selected");
  expect(targetNode).not.toHaveClass("is-connectable-target");
  expect(
    screen.queryByRole("complementary", { name: "节点检查器" }),
  ).not.toBeInTheDocument();
});

test("selects a connection line and removes it with Delete", async () => {
  vi.mocked(getVisualCanvas).mockResolvedValueOnce({
    project_id: "project-1",
    edges: [
      {
        id: "edge-1",
        source_node_id: "image-1",
        target_node_id: "video-2",
      },
    ],
    nodes: [
      {
        id: "image-1",
        kind: "image",
        title: "图片1",
        position: { x: 240, y: 120 },
        asset_id: "linked-image",
      },
      {
        id: "video-2",
        kind: "video",
        title: "视频2",
        position: { x: 640, y: 120 },
        asset_id: null,
        generation_draft: {
          mode: "reference",
          prompt: "",
          duration: 5,
          resolution: "720p",
          ratio: "16:9",
          watermark: true,
          generate_audio: false,
          reference_asset_ids: ["linked-image", "manual-image"],
          video_asset_ids: [],
          audio_asset_ids: [],
          prompt_reference_names: {
            "linked-image": "图片1",
            "manual-image": "手动图片",
          },
        },
      },
    ],
    revision: 0,
    updated_at: "2026-08-03T08:00:00Z",
  });
  const user = userEvent.setup();
  const { container } = renderCanvas();

  expect(await screen.findByText("图片1")).toBeInTheDocument();
  const edge = screen.getByRole("button", {
    name: "连线：图片1 → 视频2",
  });
  await user.click(edge);
  expect(edge).toHaveClass("hit-area");

  fireEvent.keyDown(window, { key: "Delete" });
  await waitFor(() =>
    expect(
      container.querySelector('[aria-label="连线：图片1 → 视频2"]'),
    ).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalled());
  const lastCall = vi.mocked(putVisualCanvas).mock.calls.at(-1);
  expect(lastCall?.[3]).toEqual([]);
  expect(lastCall?.[1]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "video-2",
        generation_draft: expect.objectContaining({
          reference_asset_ids: ["manual-image"],
          prompt_reference_names: { "manual-image": "手动图片" },
        }),
      }),
    ]),
  );
});

test("requires unlinking before deleting a referenced node", async () => {
  vi.mocked(getVisualCanvas).mockResolvedValueOnce({
    project_id: "project-1",
    edges: [
      { id: "edge-1", source_node_id: "source", target_node_id: "target" },
    ],
    nodes: [
      {
        id: "source",
        kind: "image",
        title: "来源图片",
        position: { x: 240, y: 120 },
        asset_id: "source-asset",
      },
      {
        id: "target",
        kind: "video",
        title: "目标视频",
        position: { x: 640, y: 120 },
        asset_id: null,
        generation_draft: {
          mode: "reference",
          prompt: "",
          duration: 5,
          resolution: "720p",
          ratio: "16:9",
          watermark: true,
          generate_audio: false,
          reference_asset_ids: ["source-asset", "manual-asset"],
          video_asset_ids: [],
          audio_asset_ids: [],
        },
      },
    ],
    revision: 0,
    updated_at: "2026-08-03T08:00:00Z",
  });
  const { container } = renderCanvas();
  const user = userEvent.setup();
  expect(await screen.findByText("来源图片")).toBeInTheDocument();
  await user.click(screen.getByText("来源图片"));
  await user.click(screen.getByRole("button", { name: "删除节点" }));
  expect(container.querySelector('[data-node-id="source"]')).not.toBeNull();
  await user.click(
    screen.getByRole("button", { name: "连线：来源图片 → 目标视频" }),
  );
  fireEvent.keyDown(window, { key: "Delete" });
  await waitFor(() =>
    expect(
      container.querySelector('[aria-label="连线：来源图片 → 目标视频"]'),
    ).toBeNull(),
  );
  await user.click(screen.getByText("来源图片"));
  await user.click(screen.getByRole("button", { name: "删除节点" }));
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalled());
  const lastCall = vi.mocked(putVisualCanvas).mock.calls.at(-1);
  expect(lastCall?.[3]).toEqual([]);
  expect(lastCall?.[1]).toEqual([
    expect.objectContaining({
      id: "target",
      generation_draft: expect.objectContaining({
        reference_asset_ids: ["manual-asset"],
      }),
    }),
  ]);
  expect(container.querySelector('[data-node-id="source"]')).toBeNull();
});

test("merges direct linked assets into reference rows and prompt mentions", async () => {
  const mediaFile = (
    id: string,
    displayName: string,
    mediaKind: "image" | "video" | "audio",
  ): ManagedFile => ({
    id,
    project_id: "project-1",
    folder_id: null,
    reference_id: null,
    original_filename: displayName,
    display_name: displayName,
    media_kind: mediaKind,
    mime_type:
      mediaKind === "image"
        ? "image/png"
        : mediaKind === "video"
          ? "video/mp4"
          : "audio/mpeg",
    byte_size: 1024,
    source: "project",
    is_reference: false,
    revision: 0,
    created_at: "2026-08-03T08:00:00Z",
    updated_at: "2026-08-03T08:00:00Z",
  });
  const files = {
    image: [
      mediaFile("linked-image", "连线图片.png", "image"),
      mediaFile("manual-image", "手动图片.png", "image"),
      mediaFile("unrelated-image", "项目其他图片.png", "image"),
    ],
    video: [mediaFile("linked-video", "连线视频.mp4", "video")],
    audio: [mediaFile("linked-audio", "连线音频.mp3", "audio")],
  };
  vi.mocked(getFiles).mockImplementation(async ({ mediaKind }) => ({
    items:
      mediaKind === "image" || mediaKind === "video" || mediaKind === "audio"
        ? files[mediaKind]
        : [],
  }));
  vi.mocked(getVisualCanvas).mockResolvedValueOnce({
    project_id: "project-1",
    edges: [
      {
        id: "edge-1",
        source_node_id: "image-1",
        target_node_id: "video-1",
      },
      {
        id: "edge-2",
        source_node_id: "video-source",
        target_node_id: "video-1",
      },
      {
        id: "edge-3",
        source_node_id: "audio-1",
        target_node_id: "video-1",
      },
    ],
    nodes: [
      {
        id: "image-1",
        kind: "image",
        title: "上游图片",
        position: { x: 100, y: 120 },
        asset_id: "linked-image",
        generation_draft: {
          model_id: null,
          prompt: "这里的参考素材不能递归继承",
          size: "1024x1024",
          seed: null,
          image_count: 1,
          reference_asset_id: "unrelated-image",
        },
      },
      {
        id: "video-source",
        kind: "video",
        title: "上游视频",
        position: { x: 100, y: 420 },
        asset_id: "linked-video",
      },
      {
        id: "audio-1",
        kind: "audio",
        title: "上游音频",
        position: { x: 100, y: 700 },
        asset_id: "linked-audio",
      },
      {
        id: "video-1",
        kind: "video",
        title: "目标视频",
        position: { x: 520, y: 120 },
        asset_id: null,
        generation_draft: {
          mode: "reference",
          prompt: "",
          duration: 5,
          resolution: "720p",
          ratio: "16:9",
          watermark: true,
          generate_audio: false,
          first_frame_asset_id: null,
          last_frame_asset_id: null,
          reference_asset_ids: ["linked-image", "manual-image"],
          video_asset_ids: [],
          audio_asset_ids: [],
        },
      },
    ],
    revision: 0,
    updated_at: "2026-08-03T08:00:00Z",
  });
  const user = userEvent.setup();
  renderCanvas();

  const targetVideo = (await screen.findByText("目标视频")).closest(
    ".canvas-node",
  )!;
  await user.click(
    targetVideo.querySelector<HTMLElement>(".canvas-node-media")!,
  );
  await user.click(screen.getByRole("button", { name: "替换素材" }));
  await user.click(screen.getByRole("tab", { name: "AI 生成" }));
  expect(screen.getByRole("button", { name: "全能参考" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const referenceBar = screen.getByRole("group", { name: "固定参考素材" });
  expect(screen.queryByText("上游引用")).not.toBeInTheDocument();
  const cards = referenceBar.querySelectorAll<HTMLElement>(
    ".generation-media-card",
  );
  expect(cards).toHaveLength(4);
  expect(cards[0]).toHaveAttribute("data-linked-reference", "true");
  expect(cards[0]).toContainElement(
    screen.getByRole("button", { name: "连线图片.png" }),
  );
  expect(
    screen
      .getByRole("button", { name: "连线图片.png" })
      .compareDocumentPosition(
        screen.getByRole("button", { name: "手动图片.png" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "移除参考文件 连线图片.png" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "移除参考文件 手动图片.png" }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "连线图片.png" })).toHaveLength(
    1,
  );

  const promptEditor = screen.getByRole("textbox", { name: "视频提示词" });
  await user.click(promptEditor);
  await user.type(promptEditor, "@");
  const mentions = await screen.findByRole("listbox", {
    name: "引用已选素材",
  });
  expect(mentions).toHaveTextContent("上游图片.png");
  expect(mentions).toHaveTextContent("上游视频.mp4");
  expect(mentions).toHaveTextContent("上游音频.mp3");
  expect(mentions).toHaveTextContent("手动图片.png");
  expect(mentions).not.toHaveTextContent("项目其他图片.png");
});

test("keeps the local draft visible when canvas CAS conflicts", async () => {
  vi.mocked(putVisualCanvas).mockRejectedValueOnce(
    new ApiError(
      "内容已被其他操作更新",
      {
        code: "revision_conflict",
        current: {
          project_id: "project-1",
          edges: [],
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
