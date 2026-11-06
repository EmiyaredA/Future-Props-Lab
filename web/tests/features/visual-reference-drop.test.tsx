import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { getFiles, getFolders, type ManagedFile } from "@features/files";
import {
  createGenerationTask,
  getGenerationOptions,
  type VisualCanvasVideoGenerationDraft,
} from "@features/visual-workshop/api";
import { GenerationDrawer } from "@features/visual-workshop/generation/GenerationDrawer";
import { MaterialTree } from "@features/visual-workshop/board/MaterialTree";
import { ProjectMediaPicker } from "@features/visual-workshop/generation/ProjectMediaPicker";
import {
  CANVAS_ASSET_DRAG_MIME,
  setCanvasAssetDragData,
} from "@features/visual-workshop/canvas/canvasAssetDrag";

vi.mock("@features/files/api", async (original) => ({
  ...(await original<typeof import("@features/files/api")>()),
  getFiles: vi.fn(),
  getFolders: vi.fn(),
}));
vi.mock("@features/visual-workshop/api", async (original) => ({
  ...(await original<typeof import("@features/visual-workshop/api")>()),
  getGenerationOptions: vi.fn(),
  createGenerationTask: vi.fn(),
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({ url: undefined }),
}));

const files: ManagedFile[] = ["image", "video", "audio"].map((kind) => ({
  id: `${kind}-asset`,
  project_id: "project",
  folder_id: null,
  reference_id: null,
  original_filename: `${kind}.file`,
  display_name: `${kind}素材`,
  media_kind: kind as "image" | "video" | "audio",
  mime_type: `${kind}/test`,
  byte_size: 100,
  source: "project",
  is_reference: false,
  revision: 0,
  created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
}));
const initial: VisualCanvasVideoGenerationDraft = {
  model_id: "model",
  mode: "reference",
  prompt: "参考动作",
  duration: 5,
  resolution: "720p",
  ratio: "16:9",
  generate_audio: true,
  watermark: false,
  first_frame_asset_id: null,
  last_frame_asset_id: null,
  reference_asset_ids: [],
  audio_asset_ids: [],
  video_asset_ids: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
  vi.mocked(getFiles).mockImplementation(async ({ mediaKind }) => ({
    items: files.filter((file) => file.media_kind === mediaKind),
  }));
  vi.mocked(getGenerationOptions).mockResolvedValue({
    models: [
      {
        id: "model",
        provider_id: "provider",
        provider_name: "test",
        kind: "video",
        max_reference_images: 9,
        supports_seed: true,
        max_prompt_length: 6000,
        slug: "doubao-seedance-2-0-260128",
        label: "Test video",
        description: "",
        sizes: [],
      },
    ],
  });
  vi.mocked(createGenerationTask).mockRejectedValue(new Error("test complete"));
});

function transfer(
  assetId = "image-asset",
  mediaKind: "image" | "video" | "audio" = "image",
) {
  const store = new Map<string, string>();
  const data = {
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
    effectAllowed: "all",
    dropEffect: "none",
  } as unknown as DataTransfer;
  setCanvasAssetDragData(data, {
    assetId,
    mediaKind,
    displayName: "素材",
    importMode: "none",
    sourceProjectId: "project",
  });
  return data;
}
function mount(children: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>,
  );
}

test("board media drag adds typed references anywhere in the bar, saves and submits without selecting the source", async () => {
  const saved = vi.fn();
  const select = vi.fn();
  function Harness() {
    const [draft, setDraft] = useState(initial);
    return (
      <>
        <MaterialTree
          projectId="project"
          categories={[]}
          selectedId="target"
          nodes={[
            {
              id: "source",
              kind: "image",
              title: "参考角色",
              asset_id: "image-asset",
              position: { x: 0, y: 0 },
            },
            {
              id: "target",
              kind: "video",
              title: "视频目标",
              position: { x: 0, y: 0 },
            },
            {
              id: "text",
              kind: "text",
              title: "说明",
              text: "描述",
              position: { x: 0, y: 0 },
            },
          ]}
          onSelect={select}
          onAction={vi.fn()}
        />
        <GenerationDrawer
          compact
          layout="workbench"
          lockedKind="video"
          projectId="project"
          canvasNodeId="target"
          draft={draft}
          onDraftChange={(next, immediate) => {
            saved(next, immediate);
            setDraft(next as VisualCanvasVideoGenerationDraft);
          }}
          onBeforeSubmit={async () => 4}
          onClose={() => {}}
        />
      </>
    );
  }
  mount(<Harness />);
  await waitFor(() => expect(getFiles).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "上传参考图片" })).toBeEnabled(),
  );
  const source = screen.getByRole("button", { name: /参考角色/ });
  expect(source).toHaveAttribute("draggable", "true");
  expect(screen.getByRole("button", { name: /视频目标/ })).toHaveAttribute(
    "draggable",
    "false",
  );
  expect(screen.getByRole("button", { name: /说明/ })).toHaveAttribute(
    "draggable",
    "false",
  );
  const dataTransfer = transfer();
  fireEvent.dragStart(source, { dataTransfer });
  const bar = screen.getByRole("group", { name: "固定参考素材" });
  fireEvent.dragOver(bar, { dataTransfer });
  expect(bar).toHaveClass("is-reference-dragover");
  // An image over the audio slot still routes by its actual media kind.
  fireEvent.drop(screen.getByRole("button", { name: "上传参考音频" }), {
    dataTransfer,
  });
  expect(
    await screen.findByRole("button", { name: "image素材" }),
  ).toBeVisible();
  expect(await screen.findByText("已添加「image素材」。")).toBeVisible();
  expect(saved).toHaveBeenLastCalledWith(
    expect.objectContaining({ reference_asset_ids: ["image-asset"] }),
    true,
  );
  expect(select).not.toHaveBeenCalled();
  fireEvent.drop(bar, { dataTransfer });
  expect(
    await screen.findByText("「image素材」已经在参考框里。"),
  ).toBeVisible();
  for (const kind of ["video", "audio"] as const)
    fireEvent.drop(bar, { dataTransfer: transfer(`${kind}-asset`, kind) });
  expect(
    await screen.findByRole("button", { name: "audio素材" }),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "生成视频" }));
  await waitFor(() =>
    expect(createGenerationTask).toHaveBeenCalledWith(
      "project",
      expect.objectContaining({
        reference_asset_ids: ["image-asset"],
        video_asset_ids: ["video-asset"],
        audio_asset_ids: ["audio-asset"],
        expected_canvas_revision: 4,
      }),
    ),
  );
});

test("self references cannot be dragged or picked and old self selections are removed silently", async () => {
  const change = vi.fn();
  const invalid = vi.fn();
  function Harness() {
    const [value, setValue] = useState(["image-asset"]);
    return (
      <ProjectMediaPicker
        projectId="project"
        label="自己的参考"
        value={value}
        excludedAssetIds={["image-asset"]}
        minimal
        onChange={(next) => {
          change(next);
          setValue(next);
        }}
        onInvalidSelection={invalid}
      />
    );
  }
  mount(<Harness />);
  await waitFor(() => expect(change).toHaveBeenCalledWith([]));
  change.mockClear();
  fireEvent.drop(screen.getByRole("group", { name: "自己的参考" }), {
    dataTransfer: transfer(),
  });
  expect(change).not.toHaveBeenCalled();
  expect(invalid).not.toHaveBeenCalled();
  expect(screen.queryByText(/已添加/)).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "不能把当前节点自己的素材作为参考。",
  );
  await userEvent.click(screen.getByRole("button", { name: "上传自己的参考" }));
  await userEvent.click(screen.getByRole("menuitem", { name: /本项目素材/ }));
  await screen.findByText("当前来源暂无可用素材");
  expect(
    screen.queryByRole("option", { name: "image素材" }),
  ).not.toBeInTheDocument();
});

test("picker rejects full, incompatible, missing, foreign and malformed references without changing draft", async () => {
  const change = vi.fn();
  mount(
    <ProjectMediaPicker
      projectId="project"
      label="参考"
      value={[]}
      linkedValue={["linked"]}
      multiple
      max={1}
      onChange={change}
    />,
  );
  await screen.findByRole("button", { name: "image素材" });
  const picker = screen.getByRole("group", { name: "参考" });
  fireEvent.drop(picker, { dataTransfer: transfer() });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "参考素材已达到数量上限。",
  );
  fireEvent.drop(picker, { dataTransfer: transfer("video-asset", "video") });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "当前参考框不接受这种素材。",
  );
  fireEvent.drop(picker, { dataTransfer: transfer("missing") });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "素材还没准备好，或已不在当前项目中。",
  );
  const foreign = transfer();
  setCanvasAssetDragData(foreign, {
    assetId: "image-asset",
    mediaKind: "image",
    displayName: "跨项目",
    importMode: "none",
    sourceProjectId: "other",
  });
  fireEvent.drop(picker, { dataTransfer: foreign });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "请先把素材导入当前项目，再拖入参考框。",
  );
  foreign.setData(CANVAS_ASSET_DRAG_MIME, "null");
  fireEvent.drop(picker, { dataTransfer: foreign });
  expect(screen.getByRole("alert")).toHaveTextContent("无法识别拖入的素材。");
  expect(change).not.toHaveBeenCalled();
});

test("single frame accepts a replacement while disabled references stay unchanged", async () => {
  const change = vi.fn();
  const view = mount(
    <ProjectMediaPicker
      projectId="project"
      label="首帧"
      value={[]}
      minimal
      onChange={change}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "上传首帧" })).toBeEnabled(),
  );
  const picker = screen.getByRole("group", { name: "首帧" });
  fireEvent.drop(picker, { dataTransfer: transfer() });
  expect(change).toHaveBeenCalledWith(["image-asset"]);
  expect(screen.getByRole("status")).toHaveTextContent("已添加「image素材」。");
  change.mockClear();
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectMediaPicker
        projectId="project"
        label="首帧"
        value={[]}
        minimal
        disabled
        onChange={change}
      />
    </QueryClientProvider>,
  );
  fireEvent.drop(screen.getByRole("group", { name: "首帧" }), {
    dataTransfer: transfer(),
  });
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("这个参考框当前不可用。");
});
