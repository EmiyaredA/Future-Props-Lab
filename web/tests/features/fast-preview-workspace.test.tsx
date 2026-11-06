import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import {
  previewGalgameVideoExportFrame,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { FastPreviewWorkspace } from "@features/galgame-workshop/editor/FastPreviewWorkspace";
import { applyFastPreviewStageExpressionEdit } from "@features/galgame-workshop/editor/fastPreviewStageExpressionEdit";
import { applyFastPreviewStoryEdits } from "@features/galgame-workshop/editor/fastPreviewEdits";
import type {
  StoryPlayerHandle,
  StoryPlayerRuntimeSnapshot,
} from "@features/galgame-workshop/editor/storyPlayerModel";

const togglePlayback = vi.fn();
const nextDialogue = vi.fn();
const previousDialogue = vi.fn();
const restart = vi.fn();
const seekTimeline = vi.fn();
const snapshot: StoryPlayerRuntimeSnapshot = {
  frame: {
    mode: "stageOnly",
    fragmentId: "fragment-one",
    stage: { actors: {} },
  },
  stage: { actors: {} },
  variables: {},
  chapterId: "chapter-one",
  fragmentId: "fragment-one",
  blockIndex: 0,
  positionMs: 490,
  durationMs: 1_000,
  playing: true,
  advanceMode: "manual",
};
let playerSnapshot = snapshot;
let emitPlayerSnapshot:
  ((value: StoryPlayerRuntimeSnapshot) => void) | undefined;

vi.mock("@features/galgame-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/galgame-workshop/api")
  >("@features/galgame-workshop/api");
  return { ...actual, previewGalgameVideoExportFrame: vi.fn() };
});

vi.mock("@features/galgame-workshop/editor/StoryPlayer", () => ({
  StoryPlayer: forwardRef<
    StoryPlayerHandle,
    {
      document: GalgameStoryProject;
      showAuthoringOverlays?: boolean;
      previewExpressionIds?: Record<string, string>;
      onRuntimeSnapshot?: (value: StoryPlayerRuntimeSnapshot) => void;
    }
  >(function MockStoryPlayer(
    {
      document: playerDocument,
      showAuthoringOverlays,
      previewExpressionIds,
      onRuntimeSnapshot,
    }: {
      document: GalgameStoryProject;
      showAuthoringOverlays?: boolean;
      previewExpressionIds?: Record<string, string>;
      onRuntimeSnapshot?: (value: StoryPlayerRuntimeSnapshot) => void;
    },
    ref,
  ) {
    const sentRef = useRef(false);
    useImperativeHandle(
      ref,
      () =>
        ({
          restart,
          advance: vi.fn(),
          togglePlayback,
          seekTimeline,
          previousDialogue,
          nextDialogue,
        }) satisfies StoryPlayerHandle,
    );
    useEffect(() => {
      emitPlayerSnapshot = onRuntimeSnapshot;
      if (sentRef.current) return;
      sentRef.current = true;
      onRuntimeSnapshot?.(playerSnapshot);
    }, [onRuntimeSnapshot]);
    const playerBlocks =
      playerDocument.chapters?.[0]?.fragments?.[0]?.blocks ?? [];
    const firstDialogue = playerBlocks.find(
      (block) => block.type === "dialogue",
    );
    return (
      <div
        data-testid="mock-story-player"
        data-authoring-overlays={showAuthoringOverlays ? "true" : "false"}
        data-preview-expression-ids={JSON.stringify(previewExpressionIds ?? {})}
        data-first-dialogue-visible={
          firstDialogue?.type === "dialogue"
            ? String(firstDialogue.portrait?.visible)
            : undefined
        }
        data-first-dialogue-keep-after={
          firstDialogue?.type === "dialogue"
            ? String(firstDialogue.portrait?.keepAfter)
            : undefined
        }
      >
        {playerBlocks
          .flatMap((block) =>
            block.type === "dialogue"
              ? [
                  `${block.text}|${block.expressionId ?? ""}|${block.portrait?.mode ?? "legacy"}|${block.portrait?.distance ?? ""}`,
                ]
              : [],
          )
          .join("||")}
      </div>
    );
  }),
}));

const document = {
  schemaVersion: "1.4",
  synopsis: "",
  assets: [],
  cgs: [],
  characters: [],
  scenes: [],
  variables: [],
  chapters: [
    {
      id: "chapter-one",
      title: "第一章",
      order: 1,
      entryFragmentId: "fragment-one",
      fragments: [
        {
          id: "fragment-one",
          title: "主线",
          timeline: { durationMs: 1_000 },
          blocks: [],
        },
      ],
    },
  ],
} as GalgameStoryProject;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  playerSnapshot = snapshot;
  emitPlayerSnapshot = undefined;
  vi.mocked(previewGalgameVideoExportFrame).mockResolvedValue(
    new Blob(["png"], { type: "image/png" }),
  );
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:exact-frame"),
    revokeObjectURL: vi.fn(),
  });
});

test("hides authoring overlays by default and persists the toolbar preference", async () => {
  const user = userEvent.setup();
  const first = render(
    <FastPreviewWorkspace
      document={document}
      startCursor={{ chapterId: "chapter-one", fragmentId: "fragment-one" }}
      onExit={vi.fn()}
    />,
  );

  expect(
    screen.getByText(/暂停时固定闭口，口型请以精确导出帧为准/),
  ).toBeInTheDocument();
  expect(
    first.container.querySelector(".galgame-fast-preview"),
  ).toHaveAttribute("data-authoring-overlays", "false");
  expect(screen.getByTestId("mock-story-player")).toHaveAttribute(
    "data-authoring-overlays",
    "false",
  );
  await user.click(screen.getByRole("button", { name: "显示辅助信息" }));
  expect(
    first.container.querySelector(".galgame-fast-preview"),
  ).toHaveAttribute("data-authoring-overlays", "true");
  expect(screen.getByTestId("mock-story-player")).toHaveAttribute(
    "data-authoring-overlays",
    "true",
  );
  first.unmount();

  const second = render(
    <FastPreviewWorkspace
      document={document}
      startCursor={{ chapterId: "chapter-one", fragmentId: "fragment-one" }}
      onExit={vi.fn()}
    />,
  );
  expect(
    second.container.querySelector(".galgame-fast-preview"),
  ).toHaveAttribute("data-authoring-overlays", "true");
  expect(screen.getByRole("button", { name: "隐藏辅助信息" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("matches exported hidden portraits by default and persists the opt-in reveal helper", async () => {
  const user = userEvent.setup();
  const hiddenPortraitDocument = structuredClone(document);
  hiddenPortraitDocument.characters = [
    { id: "hero", name: "主角", description: "", expressions: [] },
  ];
  const hiddenLine = {
    id: "hidden-line",
    type: "dialogue" as const,
    characterId: "hero",
    text: "现在能看见我了",
    portrait: {
      mode: "stage" as const,
      visible: false,
      distance: "medium" as const,
      keepAfter: true,
      transition: { durationMs: 240, fade: true },
    },
  };
  hiddenPortraitDocument.chapters![0]!.fragments![0]!.blocks = [hiddenLine];
  playerSnapshot = {
    ...snapshot,
    playing: false,
    frame: {
      mode: "content",
      fragmentId: "fragment-one",
      blockIndex: 0,
      block: hiddenLine,
      stage: { actors: {} },
    },
  };

  const first = render(
    <FastPreviewWorkspace
      document={hiddenPortraitDocument}
      startCursor={{ chapterId: "chapter-one", fragmentId: "fragment-one" }}
      onExit={vi.fn()}
    />,
  );

  expect(screen.getByTestId("mock-story-player")).toHaveAttribute(
    "data-first-dialogue-visible",
    "false",
  );
  expect(screen.getByTestId("mock-story-player")).toHaveAttribute(
    "data-first-dialogue-keep-after",
    "true",
  );
  await user.click(await screen.findByRole("button", { name: "快速修改" }));
  expect(
    screen.getByLabelText("辅助显示隐藏角色（不改导出）"),
  ).not.toBeChecked();
  expect(screen.getByLabelText("成片中显示立绘")).not.toBeChecked();

  await user.click(screen.getByLabelText("辅助显示隐藏角色（不改导出）"));
  expect(screen.getByTestId("mock-story-player")).toHaveAttribute(
    "data-first-dialogue-visible",
    "true",
  );
  expect(screen.getByTestId("mock-story-player")).toHaveAttribute(
    "data-first-dialogue-keep-after",
    "false",
  );
  first.unmount();

  render(
    <FastPreviewWorkspace
      document={hiddenPortraitDocument}
      startCursor={{ chapterId: "chapter-one", fragmentId: "fragment-one" }}
      onExit={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "快速修改" }));
  expect(screen.getByLabelText("辅助显示隐藏角色（不改导出）")).toBeChecked();
});

test("keeps the 1:52 dialogue queue aligned with the rendered frame", async () => {
  const timelineDocument = structuredClone(document);
  timelineDocument.characters = [
    { id: "okabe", name: "冈部伦太郎", description: "", expressions: [] },
    { id: "kurisu", name: "牧濑红莉栖", description: "", expressions: [] },
  ];
  const blocks = [
    {
      id: "okabe-line",
      type: "dialogue" as const,
      characterId: "okabe",
      text: "呼——哈哈哈！",
    },
    {
      id: "kurisu-line",
      type: "dialogue" as const,
      characterId: "kurisu",
      text: "是是，凤凰院凶真，凤凰院凶真。",
    },
    {
      id: "mayuri-line",
      type: "narration" as const,
      text: "没、没事吧，冈伦？",
    },
  ];
  timelineDocument.chapters![0]!.fragments![0]!.blocks = blocks;
  playerSnapshot = {
    ...snapshot,
    blockIndex: 0,
    positionMs: 112_000,
    frame: {
      mode: "content",
      fragmentId: "fragment-one",
      blockIndex: 1,
      block: blocks[1],
      stage: { actors: {} },
    },
  };

  render(
    <FastPreviewWorkspace
      document={timelineDocument}
      startCursor={{ chapterId: "chapter-one", fragmentId: "fragment-one" }}
      onExit={vi.fn()}
    />,
  );

  const current = (await screen.findByText("当前对白")).closest("article");
  expect(current).not.toBeNull();
  expect(within(current!).getByText("牧濑红莉栖")).toBeInTheDocument();
  expect(
    within(current!).getByText("是是，凤凰院凶真，凤凰院凶真。"),
  ).toBeInTheDocument();
});

test("uses a short source-time clip for exact frames late in a long timeline", async () => {
  const user = userEvent.setup();
  playerSnapshot = {
    ...snapshot,
    positionMs: 600_000,
    durationMs: 1_780_000,
    playing: false,
  };
  const longDocument = structuredClone(document);
  longDocument.chapters![0]!.fragments![0]!.timeline!.durationMs = 1_780_000;

  render(
    <FastPreviewWorkspace
      projectId="project-one"
      storyRevision={617}
      document={longDocument}
      startCursor={{
        chapterId: "chapter-one",
        fragmentId: "fragment-one",
      }}
      onExit={vi.fn()}
    />,
  );

  await user.click(
    await screen.findByRole("button", { name: "生成当前精确帧" }),
  );

  await waitFor(() =>
    expect(previewGalgameVideoExportFrame).toHaveBeenCalledWith(
      "project-one",
      expect.objectContaining({
        clipRange: {
          fragmentId: "fragment-one",
          startMs: 599_000,
          endMs: 601_001,
        },
        timeMs: 1_000,
      }),
    ),
  );
});

test("generates the current exact export frame only when requested", async () => {
  const user = userEvent.setup();
  render(
    <FastPreviewWorkspace
      projectId="project-one"
      storyRevision={617}
      document={document}
      startCursor={{
        chapterId: "chapter-one",
        fragmentId: "fragment-one",
      }}
      onExit={vi.fn()}
    />,
  );

  expect(previewGalgameVideoExportFrame).not.toHaveBeenCalled();
  await user.click(
    await screen.findByRole("button", { name: "生成当前精确帧" }),
  );

  await waitFor(() =>
    expect(previewGalgameVideoExportFrame).toHaveBeenCalledWith(
      "project-one",
      expect.objectContaining({
        expectedStoryRevision: 617,
        scope: "clip",
        clipRange: {
          fragmentId: "fragment-one",
          startMs: 0,
          endMs: 1_000,
        },
        timeMs: 490,
        width: 960,
      }),
    ),
  );
  expect(togglePlayback).toHaveBeenCalledTimes(1);
  expect(
    await screen.findByRole("region", { name: "当前时间点精确导出帧" }),
  ).toBeInTheDocument();
  expect(screen.getByAltText("正式导出引擎生成的当前帧")).toHaveAttribute(
    "src",
    "blob:exact-frame",
  );
});

test("disables exact frames for an unsaved snapshot", async () => {
  render(
    <FastPreviewWorkspace
      projectId="project-one"
      storyRevision={617}
      exactFrameDisabledReason="当前故事尚未成功保存"
      document={document}
      startCursor={{
        chapterId: "chapter-one",
        fragmentId: "fragment-one",
      }}
      onExit={vi.fn()}
    />,
  );

  const button = await screen.findByRole("button", {
    name: "生成当前精确帧",
  });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("title", "当前故事尚未成功保存");
  expect(previewGalgameVideoExportFrame).not.toHaveBeenCalled();
});

test("previews dialogue and presentation drafts before the explicit save action", async () => {
  const user = userEvent.setup();
  const dialogueDocument = structuredClone(document);
  dialogueDocument.characters = [
    {
      id: "hero",
      name: "主角",
      description: "",
      defaultExpressionId: "calm",
      expressions: [
        {
          id: "calm",
          label: "平静",
          assetId: "portrait",
          renderMode: "staticImage",
        },
        {
          id: "focused",
          label: "专注",
          assetId: "portrait-focused",
          renderMode: "staticImage",
        },
      ],
    },
    {
      id: "friend",
      name: "搭档",
      description: "",
      defaultExpressionId: "smile",
      expressions: [
        {
          id: "smile",
          label: "微笑",
          assetId: "friend-portrait",
          renderMode: "staticImage",
        },
      ],
    },
  ];
  dialogueDocument.chapters![0]!.fragments![0]!.blocks = [
    {
      id: "line-one",
      type: "dialogue",
      characterId: "hero",
      expressionId: "calm",
      text: "原对白",
      startMs: 0,
      endMs: 1_000,
      portrait: {
        mode: "stage",
        visible: true,
        keepAfter: true,
        distance: "medium",
        positionId: "left",
        skinId: null,
        transform: null,
        transition: { durationMs: 240, fade: true },
      },
    },
    {
      id: "line-two",
      type: "dialogue",
      characterId: "friend",
      expressionId: "smile",
      text: "下一句对白",
      startMs: 1_000,
      endMs: 2_000,
      portrait: {
        mode: "stage",
        visible: true,
        keepAfter: true,
        distance: "medium",
        positionId: "right",
        skinId: null,
        transform: null,
        transition: { durationMs: 240, fade: true },
      },
    },
  ];
  const stage = {
    actors: {
      hero: {
        characterId: "hero",
        expressionId: "calm",
        distance: "medium" as const,
        positionId: "left",
        transform: {
          x: 25,
          y: 100,
          anchor: "bottomCenter" as const,
          scale: 1,
          brightness: 1,
          opacity: 1,
          flipX: false,
          layer: 10,
        },
        transition: { durationMs: 240, fade: true },
        entering: false,
        exiting: false,
      },
      friend: {
        characterId: "friend",
        expressionId: "smile",
        distance: "medium" as const,
        positionId: "right",
        transform: {
          x: 75,
          y: 100,
          anchor: "bottomCenter" as const,
          scale: 1,
          brightness: 1,
          opacity: 1,
          flipX: false,
          layer: 11,
        },
        transition: { durationMs: 240, fade: true },
        entering: false,
        exiting: false,
      },
    },
  };
  playerSnapshot = {
    ...snapshot,
    playing: true,
    stage,
    frame: {
      mode: "content",
      fragmentId: "fragment-one",
      blockIndex: 0,
      block: dialogueDocument.chapters![0]!.fragments![0]!.blocks![0]!,
      stage,
    },
  };
  let savedDocument = structuredClone(dialogueDocument);
  let savedRevision = 617;
  let failFirstBatchSave = true;
  const onApplyDialogueEdit = vi.fn();
  const onApplyEdits = vi.fn(async (edits) => {
    if (failFirstBatchSave) {
      failFirstBatchSave = false;
      throw new Error("故事版本已发生冲突");
    }
    const nextDocument = applyFastPreviewStoryEdits(
      structuredClone(savedDocument),
      edits,
    );
    savedDocument = nextDocument;
    savedRevision += 1;
    return { document: nextDocument, storyRevision: savedRevision };
  });

  const view = render(
    <FastPreviewWorkspace
      projectId="project-one"
      storyRevision={617}
      document={dialogueDocument}
      startCursor={{ chapterId: "chapter-one", fragmentId: "fragment-one" }}
      onExit={vi.fn()}
      onApplyDialogueEdit={onApplyDialogueEdit}
      onApplyEdits={onApplyEdits}
    />,
  );

  await user.click(await screen.findByRole("button", { name: "快速修改" }));
  const textarea = screen.getByLabelText("对白文本");
  await user.clear(textarea);
  await user.type(textarea, "修正后的对白");

  expect(togglePlayback).toHaveBeenCalledTimes(1);

  await waitFor(() =>
    expect(screen.getByTestId("mock-story-player")).toHaveTextContent(
      "修正后的对白|calm|stage|medium",
    ),
  );
  expect(screen.getByRole("status")).toHaveTextContent("未保存草稿已实时显示");
  expect(
    screen.getByRole("button", { name: "生成当前精确帧" }),
  ).toHaveAttribute("title", "请先保存全部实时草稿，再生成精确导出帧");

  await user.click(screen.getByRole("button", { name: "下一对白" }));
  expect(nextDialogue).toHaveBeenCalledTimes(1);

  act(() => {
    emitPlayerSnapshot?.({
      ...playerSnapshot,
      blockIndex: 1,
      positionMs: 1_100,
      playing: false,
      stage,
      frame: {
        mode: "content",
        fragmentId: "fragment-one",
        blockIndex: 1,
        block: dialogueDocument.chapters![0]!.fragments![0]!.blocks![1]!,
        stage,
      },
    });
  });
  const nextTextarea = await screen.findByLabelText("对白文本");
  await waitFor(() => expect(nextTextarea).toHaveValue("下一句对白"));
  expect(screen.getByText("正在编辑：搭档")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("已保留 1 个未保存草稿");

  await user.click(screen.getByTitle("编辑 主角 的舞台表现"));
  expect(screen.queryByLabelText("对白文本")).not.toBeInTheDocument();
  restart.mockClear();
  seekTimeline.mockClear();
  await user.click(screen.getByRole("combobox", { name: "快速修改对白表情" }));
  await user.click(screen.getByRole("option", { name: "专注" }));
  await waitFor(() =>
    expect(screen.getByTestId("mock-story-player")).toHaveTextContent(
      "修正后的对白|focused|stage|medium",
    ),
  );
  expect(restart).not.toHaveBeenCalled();
  expect(seekTimeline).not.toHaveBeenCalled();

  await user.click(screen.getByTitle("编辑 搭档 的舞台表现"));
  expect(await screen.findByLabelText("对白文本")).toHaveValue("下一句对白");
  await user.click(screen.getByRole("button", { name: "近景" }));

  await waitFor(() =>
    expect(screen.getByTestId("mock-story-player")).toHaveTextContent(
      "下一句对白|smile|stage|near",
    ),
  );
  restart.mockClear();
  seekTimeline.mockClear();
  await user.click(screen.getByRole("button", { name: "全部保存（2）" }));

  await waitFor(() =>
    expect(onApplyEdits).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          type: "dialogue",
          fragmentId: "fragment-one",
          blockId: "line-two",
          portrait: expect.objectContaining({
            mode: "stage",
            distance: "near",
          }),
        }),
      ]),
    ),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "未写入任何修改，全部 2 个草稿已保留",
  );
  expect(screen.getByRole("button", { name: "全部保存（2）" })).toBeEnabled();
  expect(screen.getByTestId("mock-story-player")).toHaveTextContent(
    "修正后的对白|focused|stage|medium",
  );
  await user.click(screen.getByRole("button", { name: "全部保存（2）" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "已保存全部 2 项修改",
  );
  expect(onApplyDialogueEdit).not.toHaveBeenCalled();
  expect(onApplyEdits).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("mock-story-player")).toHaveTextContent(
    "下一句对白|smile|stage|near",
  );
  view.rerender(
    <FastPreviewWorkspace
      projectId="project-one"
      storyRevision={618}
      document={dialogueDocument}
      startCursor={{ chapterId: "chapter-one", fragmentId: "fragment-one" }}
      onExit={vi.fn()}
      onApplyDialogueEdit={onApplyDialogueEdit}
      onApplyEdits={onApplyEdits}
    />,
  );
  await waitFor(() => expect(seekTimeline).toHaveBeenCalledWith(1_100));
  expect(restart).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("mock-story-player")).toHaveTextContent(
    "下一句对白|smile|stage|near",
  );

  await user.click(screen.getByRole("button", { name: "上一对白" }));
  expect(previousDialogue).toHaveBeenCalledTimes(1);
  act(() => {
    emitPlayerSnapshot?.({
      ...playerSnapshot,
      positionMs: 85_000,
      durationMs: 120_000,
      playing: false,
    });
  });
  const previousTextarea = await screen.findByLabelText("对白文本");
  await waitFor(() => expect(previousTextarea).toHaveValue("修正后的对白"));
  expect(screen.getByText("正在编辑：主角")).toBeInTheDocument();
  await user.type(previousTextarea, "（再次修改）");

  onApplyDialogueEdit.mockRejectedValueOnce(new Error("故事版本已发生冲突"));
  restart.mockClear();
  seekTimeline.mockClear();
  await user.click(screen.getByRole("button", { name: "保存当前" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "保存失败：故事版本已发生冲突。草稿和当前位置已保留，可重试。",
  );
  view.rerender(
    <FastPreviewWorkspace
      projectId="project-one"
      storyRevision={619}
      document={dialogueDocument}
      startCursor={{ chapterId: "chapter-one", fragmentId: "fragment-one" }}
      onExit={vi.fn()}
      onApplyDialogueEdit={onApplyDialogueEdit}
    />,
  );
  expect(screen.getByText("1:25")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存当前" })).toBeEnabled();
  expect(restart).not.toHaveBeenCalled();
  expect(seekTimeline).not.toHaveBeenCalled();
});

test("edits a stage-command portrait expression without requiring dialogue", async () => {
  const user = userEvent.setup();
  const stageDocument = structuredClone(document);
  stageDocument.characters = [
    { id: "hero", name: "主角", description: "", expressions: [] },
    {
      id: "guest",
      name: "菲",
      description: "",
      defaultExpressionId: "calm",
      expressions: [
        { id: "calm", label: "平静", assetId: "calm-asset" },
        { id: "smile", label: "微笑", assetId: "smile-asset" },
      ],
    },
  ];
  const stageCast = {
    id: "stage-cast",
    type: "setStageCast" as const,
    members: [
      {
        characterId: "guest",
        expressionId: "calm",
        distance: "medium" as const,
        positionId: "right",
      },
    ],
  };
  const dialogue = {
    id: "hero-line",
    type: "dialogue" as const,
    characterId: "hero",
    text: "真的，真的！",
  };
  stageDocument.chapters![0]!.fragments![0]!.blocks = [stageCast, dialogue];
  const actor = {
    characterId: "guest",
    expressionId: "calm",
    distance: "medium" as const,
    positionId: "right",
    transform: {
      x: 75,
      y: 100,
      anchor: "bottomCenter" as const,
      scale: 1,
      brightness: 1,
      opacity: 1,
      flipX: false,
      layer: 10,
    },
    transition: { durationMs: 240, fade: true },
    entering: false,
    exiting: false,
  };
  playerSnapshot = {
    ...snapshot,
    playing: false,
    stage: { actors: { guest: actor } },
    frame: {
      mode: "content",
      fragmentId: "fragment-one",
      blockIndex: 1,
      block: dialogue,
      stage: { actors: { guest: actor } },
    },
  };
  const onApplyStageExpressionEdit = vi.fn(async (edit) => ({
    document: applyFastPreviewStageExpressionEdit(stageDocument, edit),
    storyRevision: 2,
  }));

  render(
    <FastPreviewWorkspace
      document={stageDocument}
      storyRevision={1}
      startCursor={{ chapterId: "chapter-one", fragmentId: "fragment-one" }}
      onExit={vi.fn()}
      onApplyStageExpressionEdit={onApplyStageExpressionEdit}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "快速修改" }));
  const guest = screen.getByTitle("编辑 菲 的立绘表情");
  expect(guest).toBeEnabled();
  expect(guest).toHaveTextContent("表情");
  await user.click(guest);
  expect(screen.queryByLabelText("对白文本")).not.toBeInTheDocument();
  restart.mockClear();
  seekTimeline.mockClear();
  await user.click(
    screen.getByRole("combobox", { name: "快速修改舞台角色表情" }),
  );
  await user.click(screen.getByRole("option", { name: "微笑" }));
  expect(screen.getByTestId("mock-story-player")).toHaveAttribute(
    "data-preview-expression-ids",
    JSON.stringify({ guest: "smile" }),
  );
  expect(restart).not.toHaveBeenCalled();
  expect(seekTimeline).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保存当前" }));
  await waitFor(() =>
    expect(onApplyStageExpressionEdit).toHaveBeenCalledWith({
      fragmentId: "fragment-one",
      blockId: "stage-cast",
      characterId: "guest",
      expressionId: "smile",
    }),
  );
});

test("keeps current dialogue editable when its speaker reuses a stage-command actor", async () => {
  const user = userEvent.setup();
  const stageDocument = structuredClone(document);
  stageDocument.characters = [
    {
      id: "maho",
      name: "比屋定真帆",
      description: "",
      defaultExpressionId: "confident",
      expressions: [
        {
          id: "confident",
          label: "双手交握·自信",
          assetId: "maho-confident-asset",
        },
      ],
    },
  ];
  const stageCast = {
    id: "stage-cast",
    type: "setStageCast" as const,
    members: [
      {
        characterId: "maho",
        expressionId: "confident",
        distance: "medium" as const,
        positionId: "right",
      },
    ],
  };
  const dialogue = {
    id: "maho-line",
    type: "dialogue" as const,
    characterId: "maho",
    expressionId: "confident",
    text: "冈部先生。",
  };
  stageDocument.chapters![0]!.fragments![0]!.blocks = [stageCast, dialogue];
  const actor = {
    characterId: "maho",
    expressionId: "confident",
    distance: "medium" as const,
    positionId: "right",
    transform: {
      x: 75,
      y: 100,
      anchor: "bottomCenter" as const,
      scale: 1,
      brightness: 1,
      opacity: 1,
      flipX: false,
      layer: 10,
    },
    transition: { durationMs: 240, fade: true },
    entering: false,
    exiting: false,
  };
  playerSnapshot = {
    ...snapshot,
    playing: false,
    stage: { actors: { maho: actor } },
    frame: {
      mode: "content",
      fragmentId: "fragment-one",
      blockIndex: 1,
      block: dialogue,
      stage: { actors: { maho: actor } },
    },
  };

  render(
    <FastPreviewWorkspace
      document={stageDocument}
      startCursor={{ chapterId: "chapter-one", fragmentId: "fragment-one" }}
      onExit={vi.fn()}
    />,
  );

  await user.click(await screen.findByRole("button", { name: "快速修改" }));
  expect(await screen.findByLabelText("对白文本")).toHaveValue("冈部先生。");
  expect(screen.getByText("正在编辑：比屋定真帆")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /比屋定真帆/ }));
  expect(screen.getByLabelText("对白文本")).toHaveValue("冈部先生。");
  expect(
    screen.queryByRole("combobox", { name: "快速修改舞台角色表情" }),
  ).not.toBeInTheDocument();
});
