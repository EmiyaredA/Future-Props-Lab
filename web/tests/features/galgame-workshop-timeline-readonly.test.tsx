import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { StoryTimelineEditor } from "@features/galgame-workshop/editor/StoryTimelineEditor";

class ReadOnlyAudio {
  static instances = 0;

  constructor() {
    ReadOnlyAudio.instances += 1;
  }
}

const document: GalgameStoryProject = {
  schemaVersion: "1.0",
  synopsis: "",
  characters: [],
  scenes: [],
  variables: [],
  assets: [
    {
      id: "bgm",
      type: "audio",
      role: "backgroundMusic",
      label: "测试 BGM",
      fileId: "file-bgm",
      status: "ready",
    },
  ],
  chapters: [],
};

const fragment = {
  id: "main",
  title: "只读跟随",
  timeline: { durationMs: 3000 },
  blocks: [
    {
      id: "play-bgm",
      type: "audio" as const,
      action: "play" as const,
      channel: "bgm" as const,
      assetId: "bgm",
      volume: 100,
      loop: true,
      fadeMs: 0,
      atMs: 0,
    },
    {
      id: "line",
      type: "narration" as const,
      text: "跟随中的对白",
      startMs: 1000,
      endMs: 2000,
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

test("keeps the followed timeline passive while updating its playhead", () => {
  ReadOnlyAudio.instances = 0;
  vi.stubGlobal("Audio", ReadOnlyAudio);
  const onPreviewPosition = vi.fn();
  const props = {
    document,
    fragment,
    selectedBlockId: undefined,
    selectedGapId: undefined,
    onSelectBlock: vi.fn(),
    onSelectGap: vi.fn(),
    onFragment: vi.fn(),
    onPreviewPosition,
    preferences: {
      zoom: 300,
      ripple: false,
      loop: false,
      characterTracksExpanded: false,
    },
    onPreferencesChange: vi.fn(),
    readOnly: true,
  };
  const rendered = render(
    <StoryTimelineEditor {...props} followPositionMs={250} />,
  );

  expect(screen.getByLabelText("时间轴播放头")).toHaveAttribute(
    "aria-valuenow",
    "250",
  );
  expect(ReadOnlyAudio.instances).toBe(0);
  expect(onPreviewPosition).not.toHaveBeenCalled();

  rendered.rerender(<StoryTimelineEditor {...props} followPositionMs={1750} />);

  expect(screen.getByLabelText("时间轴播放头")).toHaveAttribute(
    "aria-valuenow",
    "1750",
  );
  expect(ReadOnlyAudio.instances).toBe(0);
  expect(onPreviewPosition).not.toHaveBeenCalled();
});
