import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@features/galgame-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/galgame-workshop/api")
  >("@features/galgame-workshop/api");
  return { ...actual, previewGalgameVideoExportFrame: vi.fn() };
});

vi.mock("@features/galgame-workshop/editor/StoryPlayer", () => ({
  StoryPlayer: forwardRef<
    StoryPlayerHandle,
    { onRuntimeSnapshot?: (value: StoryPlayerRuntimeSnapshot) => void }
  >(function MockStoryPlayer(
    {
      onRuntimeSnapshot,
    }: {
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
          previousDialogue: vi.fn(),
          nextDialogue: vi.fn(),
        }) satisfies StoryPlayerHandle,
    );
    useEffect(() => {
      if (sentRef.current) return;
      sentRef.current = true;
      onRuntimeSnapshot?.(playerSnapshot);
    }, [onRuntimeSnapshot]);
    return <div data-testid="mock-story-player" />;
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
  playerSnapshot = snapshot;
  vi.mocked(previewGalgameVideoExportFrame).mockResolvedValue(
    new Blob(["png"], { type: "image/png" }),
  );
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:exact-frame"),
    revokeObjectURL: vi.fn(),
  });
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
