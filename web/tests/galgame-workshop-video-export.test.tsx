import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import {
  createGalgameVideoEditorHandoff,
  createGalgameVideoExport,
  listGalgameVideoEditorHandoffs,
  listGalgameVideoExports,
  previewGalgameVideoExportFrame,
  previewGalgameVideoExport,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { VideoExportDialog } from "@features/galgame-workshop/editor/VideoExportDialog";
import { defaultVideoClipRange } from "@features/galgame-workshop/editor/videoExportRange";

vi.mock("@features/galgame-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/galgame-workshop/api")
  >("@features/galgame-workshop/api");
  return {
    ...actual,
    createGalgameVideoEditorHandoff: vi.fn(),
    createGalgameVideoExport: vi.fn(),
    listGalgameVideoExports: vi.fn(),
    listGalgameVideoEditorHandoffs: vi.fn(),
    previewGalgameVideoExport: vi.fn(),
    previewGalgameVideoExportFrame: vi.fn(),
  };
});

const document = {
  schemaVersion: "1.4",
  synopsis: "",
  entryChapterId: "chapter-one",
  characters: [],
  scenes: [],
  cgs: [],
  variables: [],
  assets: [],
  chapters: [
    {
      id: "chapter-one",
      title: "第一章",
      order: 1,
      entryFragmentId: "fragment-one",
      fragments: [
        {
          id: "fragment-one",
          title: "片段一",
          timeline: { durationMs: 1_780_000 },
          blocks: [],
        },
        { id: "fragment-two", title: "片段二", blocks: [] },
      ],
    },
  ],
} as GalgameStoryProject;

function renderDialog({
  story = document,
  positionMs = 600_000,
}: {
  story?: GalgameStoryProject;
  positionMs?: number;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <VideoExportDialog
        open
        projectId="project-one"
        storyRevision={3}
        document={story}
        currentFragmentId="fragment-one"
        currentTimelinePositionMs={positionMs}
        languageOptions={["zh"]}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(listGalgameVideoExports).mockResolvedValue({ items: [] });
  vi.mocked(listGalgameVideoEditorHandoffs).mockResolvedValue({ items: [] });
  vi.mocked(createGalgameVideoEditorHandoff).mockResolvedValue({
    id: "handoff-one",
    projectId: "project-one",
    requestId: "handoff-request",
    storyRevision: 3,
    status: "queued",
    progress: 0,
    trackCount: 0,
    assetCount: 0,
    revision: 0,
    createdAt: "2026-08-22T00:00:00Z",
    updatedAt: "2026-08-22T00:00:00Z",
  });
  vi.mocked(previewGalgameVideoExportFrame).mockResolvedValue(
    new Blob(["png"], { type: "image/png" }),
  );
  vi.mocked(previewGalgameVideoExport).mockImplementation(
    async (_projectId, body) => {
      const fragmentIds =
        body.scope === "clip" && body.clipRange
          ? [body.clipRange.fragmentId]
          : (body.fragmentIds ?? []);
      const estimatedDurationMs =
        body.scope === "clip" && body.clipRange
          ? body.clipRange.endMs - body.clipRange.startMs
          : Math.max(1000, fragmentIds.length * 1000);
      return {
        ready: true,
        storyRevision: 3,
        preset: body.preset,
        width: 1920,
        height: 1080,
        fps: 30,
        previewFingerprint: "a".repeat(64),
        route: {
          chapterIds: ["chapter-one"],
          fragmentIds,
          fragmentDurationsMs: fragmentIds.map(() => estimatedDurationMs),
          branchBlockIds: [],
          endingLabel:
            body.scope === "fragments"
              ? `${body.fragmentIds?.length ?? 0} 个片段`
              : body.scope === "clip"
                ? "片段一 · 10m00s-10m10s"
                : "故事结束",
          estimatedDurationMs,
          exactDuration: true,
        },
        blockers: [],
        warnings: [],
      };
    },
  );
  vi.mocked(createGalgameVideoExport).mockResolvedValue({
    id: "export-one",
    projectId: "project-one",
    requestId: "request-one",
    storyRevision: 3,
    status: "queued",
    phase: "queued",
    progress: 0,
    renderedMs: 0,
    totalMs: 2000,
    preset: "1080p30",
    endingLabel: "2 个片段",
    revision: 0,
    createdAt: "2026-08-22T00:00:00Z",
    updatedAt: "2026-08-22T00:00:00Z",
  });
});

test("edits and persists a strict 16:9 capture frame in preview requests", async () => {
  const user = userEvent.setup();
  renderDialog();

  await user.click(screen.getByRole("button", { name: /自定义取景/ }));
  expect(screen.getByLabelText("宽度")).toHaveValue(1600);
  expect(screen.getByLabelText("高度")).toHaveValue(900);
  fireEvent.change(screen.getByLabelText("X"), { target: { value: "322" } });

  await waitFor(() =>
    expect(previewGalgameVideoExport).toHaveBeenLastCalledWith(
      "project-one",
      expect.objectContaining({
        captureFrame: { x: 320, y: 90, width: 1600, height: 900 },
      }),
    ),
  );
  expect(
    JSON.parse(
      localStorage.getItem("fpl:galgame-video-capture:v1:project-one") ??
        "null",
    ),
  ).toEqual({ x: 320, y: 90, width: 1600, height: 900 });
});

test("mounts a full-height canonical stage inside the capture surface", () => {
  const { container } = renderDialog();

  const player = container.querySelector(
    ".galgame-capture-source .galgame-player-stage-only",
  );
  const stageHost = container.querySelector(
    ".galgame-capture-source .galgame-stage-host",
  );

  expect(player).toHaveStyle({
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
  });
  expect(stageHost).toHaveAttribute("data-aspect-mode", "auto");
  expect(stageHost).toHaveStyle({ width: "100%", height: "100%" });
  expect(stageHost).not.toHaveAttribute("hidden");
});

test("generates the expensive deterministic frame only when requested", async () => {
  const user = userEvent.setup();
  renderDialog();

  const generate = await screen.findByRole("button", {
    name: "生成精确首帧",
  });
  expect(previewGalgameVideoExportFrame).not.toHaveBeenCalled();

  await user.click(generate);
  await waitFor(() =>
    expect(previewGalgameVideoExportFrame).toHaveBeenCalledTimes(1),
  );
});

test("selects one or multiple fragments and submits them in story order", async () => {
  const user = userEvent.setup();
  renderDialog();

  await user.click(screen.getByRole("button", { name: /选择片段/ }));
  expect(screen.getByRole("checkbox", { name: /片段一/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await user.click(screen.getByRole("checkbox", { name: /片段二/ }));

  await waitFor(() =>
    expect(previewGalgameVideoExport).toHaveBeenLastCalledWith(
      "project-one",
      expect.objectContaining({
        scope: "fragments",
        fragmentIds: ["fragment-one", "fragment-two"],
        branchSelections: [],
      }),
    ),
  );
  await user.click(screen.getByRole("button", { name: "直接导出 MP4" }));
  await waitFor(() =>
    expect(createGalgameVideoExport).toHaveBeenCalledWith(
      "project-one",
      expect.objectContaining({
        scope: "fragments",
        fragmentIds: ["fragment-one", "fragment-two"],
      }),
    ),
  );
  expect(await screen.findByText("视频正在后台导出")).toBeInTheDocument();
  expect(screen.getByText(/可以关闭窗口，任务会继续运行/)).toBeInTheDocument();
});

test("defaults quick clip to ten seconds after the current playhead and submits exact milliseconds", async () => {
  const user = userEvent.setup();
  renderDialog();

  await user.click(screen.getByRole("button", { name: /快速试片/ }));
  expect(screen.getByLabelText("开始时间")).toHaveValue("10:00.000");
  expect(screen.getByLabelText("结束时间")).toHaveValue("10:10.000");

  await user.click(screen.getByRole("button", { name: "30 秒" }));
  expect(screen.getByLabelText("结束时间")).toHaveValue("10:30.000");

  await user.click(screen.getByRole("button", { name: "重新使用当前播放头" }));
  expect(screen.getByLabelText("开始时间")).toHaveValue("10:00.000");
  expect(screen.getByLabelText("结束时间")).toHaveValue("10:10.000");

  fireEvent.change(screen.getByLabelText("快速试片开始位置"), {
    target: { value: "601200" },
  });
  expect(screen.getByLabelText("开始时间")).toHaveValue("10:01.200");

  const endInput = screen.getByLabelText("结束时间");
  await user.clear(endInput);
  await user.type(endInput, "16:00.000");
  await user.tab();
  expect(screen.getAllByText("快速试片最长为 5 分钟")).not.toHaveLength(0);
  expect(screen.getByRole("button", { name: "直接导出 MP4" })).toBeDisabled();

  await user.clear(endInput);
  await user.type(endInput, "10:12.345");
  await user.tab();

  await waitFor(() =>
    expect(previewGalgameVideoExport).toHaveBeenLastCalledWith(
      "project-one",
      expect.objectContaining({
        scope: "clip",
        clipRange: {
          fragmentId: "fragment-one",
          startMs: 601_200,
          endMs: 612_345,
        },
        branchSelections: [],
      }),
    ),
  );
  await user.click(screen.getByRole("button", { name: "直接导出 MP4" }));
  await waitFor(() =>
    expect(createGalgameVideoExport).toHaveBeenCalledWith(
      "project-one",
      expect.objectContaining({
        scope: "clip",
        clipRange: {
          fragmentId: "fragment-one",
          startMs: 601_200,
          endMs: 612_345,
        },
      }),
    ),
  );
});

test("sends the checked settings to a new frozen video editor project", async () => {
  const user = userEvent.setup();
  vi.mocked(listGalgameVideoEditorHandoffs).mockResolvedValue({
    items: [
      {
        id: "handoff-completed",
        projectId: "project-one",
        requestId: "handoff-completed-request",
        storyRevision: 3,
        status: "completed",
        progress: 100,
        outputProjectId: "editor-project-one",
        trackCount: 8,
        assetCount: 5,
        revision: 2,
        createdAt: "2026-08-22T00:00:00Z",
        updatedAt: "2026-08-22T00:00:02Z",
      },
    ],
  });
  renderDialog();

  const open = await screen.findByRole("link", { name: /打开剪辑工程/ });
  expect(open).toHaveAttribute(
    "href",
    "/apps/video-editor/projects/editor-project-one/editor",
  );
  const handoff = screen.getByRole("button", { name: "发送到视频剪辑工坊" });
  await waitFor(() => expect(handoff).toBeEnabled());
  await user.click(handoff);
  await waitFor(() =>
    expect(createGalgameVideoEditorHandoff).toHaveBeenCalledWith(
      "project-one",
      expect.objectContaining({
        expectedStoryRevision: 3,
        preset: "1080p30",
        previewFingerprint: "a".repeat(64),
      }),
    ),
  );
});

test("disables quick clip without a timeline and reports the reason", () => {
  const story = structuredClone(document);
  const fragment = story.chapters?.[0]?.fragments?.[0];
  if (fragment) fragment.timeline = undefined;
  renderDialog({ story });

  expect(screen.getByRole("button", { name: /快速试片/ })).toBeDisabled();
  expect(
    screen.getByText("当前 Fragment 没有时间轴，无法使用快速试片。"),
  ).toBeInTheDocument();
});

test("falls back to the final ten seconds when the playhead is at the end", () => {
  expect(defaultVideoClipRange(1_780_000, 1_780_000)).toEqual({
    startMs: 1_770_000,
    endMs: 1_780_000,
  });
});
