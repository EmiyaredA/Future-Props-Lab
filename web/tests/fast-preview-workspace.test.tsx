import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import {
  previewGalgameVideoExportFrame,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { FastPreviewWorkspace } from "@features/galgame-workshop/editor/FastPreviewWorkspace";
import type {
  StoryPlayerHandle,
  StoryPlayerRuntimeSnapshot,
} from "@features/galgame-workshop/editor/storyPlayerModel";

const togglePlayback = vi.fn();
const nextDialogue = vi.fn();
const previousDialogue = vi.fn();
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
      onRuntimeSnapshot?: (value: StoryPlayerRuntimeSnapshot) => void;
    }
  >(function MockStoryPlayer(
    {
      document: playerDocument,
      showAuthoringOverlays,
      onRuntimeSnapshot,
    }: {
      document: GalgameStoryProject;
      showAuthoringOverlays?: boolean;
      onRuntimeSnapshot?: (value: StoryPlayerRuntimeSnapshot) => void;
    },
    ref,
  ) {
    const sentRef = useRef(false);
    useImperativeHandle(
      ref,
      () =>
        ({
          restart: vi.fn(),
          advance: vi.fn(),
          togglePlayback,
          seekTimeline: vi.fn(),
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
    return (
      <div
        data-testid="mock-story-player"
        data-authoring-overlays={showAuthoringOverlays ? "true" : "false"}
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

  expect(screen.getByText(/动态预演/)).toBeInTheDocument();
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

  const current = (await screen.findByText("当前句")).closest("article");
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
    },
    {
      id: "line-two",
      type: "dialogue",
      characterId: "friend",
      expressionId: "smile",
      text: "下一句对白",
      startMs: 1_000,
      endMs: 2_000,
    },
  ];
  playerSnapshot = {
    ...snapshot,
    playing: true,
    frame: {
      mode: "content",
      fragmentId: "fragment-one",
      blockIndex: 0,
      block: dialogueDocument.chapters![0]!.fragments![0]!.blocks![0]!,
      stage: { actors: {} },
    },
  };
  const onApplyDialogueEdit = vi.fn(async (edit) => {
    const savedDocument = structuredClone(dialogueDocument);
    const savedBlock = savedDocument.chapters![0]!.fragments![0]!.blocks!.find(
      (block) => block.id === edit.blockId,
    );
    if (savedBlock?.type === "dialogue") {
      savedBlock.text = edit.text;
      savedBlock.expressionId = edit.expressionId;
      savedBlock.portrait = edit.portrait;
    }
    return { document: savedDocument, storyRevision: 618 };
  });

  render(
    <FastPreviewWorkspace
      projectId="project-one"
      storyRevision={617}
      document={dialogueDocument}
      startCursor={{ chapterId: "chapter-one", fragmentId: "fragment-one" }}
      onExit={vi.fn()}
      onApplyDialogueEdit={onApplyDialogueEdit}
    />,
  );

  await user.click(await screen.findByRole("button", { name: "快速修改" }));
  const textarea = screen.getByLabelText("对白文本");
  await user.clear(textarea);
  await user.type(textarea, "修正后的对白");

  expect(togglePlayback).toHaveBeenCalledTimes(1);

  await waitFor(() =>
    expect(screen.getByTestId("mock-story-player")).toHaveTextContent(
      "修正后的对白|calm|legacy|",
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
      frame: {
        mode: "content",
        fragmentId: "fragment-one",
        blockIndex: 1,
        block: dialogueDocument.chapters![0]!.fragments![0]!.blocks![1]!,
        stage: { actors: {} },
      },
    });
  });
  await waitFor(() => expect(textarea).toHaveValue("下一句对白"));
  expect(
    within(textarea.closest("section")!).getByText("搭档"),
  ).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("已保留 1 个未保存草稿");

  await user.click(screen.getByRole("combobox", { name: "快速修改立绘演出" }));
  await user.click(screen.getByRole("option", { name: "舞台立绘" }));
  await user.click(screen.getByRole("combobox", { name: "快速修改立绘景别" }));
  await user.click(screen.getByRole("option", { name: "近景" }));

  await waitFor(() =>
    expect(screen.getByTestId("mock-story-player")).toHaveTextContent(
      "下一句对白|smile|stage|near",
    ),
  );
  await user.click(screen.getByRole("button", { name: "保存这些修改" }));

  await waitFor(() =>
    expect(onApplyDialogueEdit).toHaveBeenCalledWith({
      fragmentId: "fragment-one",
      blockId: "line-two",
      text: "下一句对白",
      expressionId: "smile",
      portrait: expect.objectContaining({ mode: "stage", distance: "near" }),
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "另有 1 个未保存草稿",
  );
  expect(screen.getByTestId("mock-story-player")).toHaveTextContent(
    "修正后的对白|calm|legacy|",
  );

  await user.click(screen.getByRole("button", { name: "上一对白" }));
  expect(previousDialogue).toHaveBeenCalledTimes(1);
  act(() => {
    emitPlayerSnapshot?.({ ...playerSnapshot, playing: false });
  });
  await waitFor(() => expect(textarea).toHaveValue("修正后的对白"));
  expect(
    within(textarea.closest("section")!).getByText("主角"),
  ).toBeInTheDocument();
});
