import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { createRef } from "react";
import { beforeEach, vi } from "vitest";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { StoryPlayer } from "@features/galgame-workshop/editor/StoryPlayer";
import type { StoryPlayerHandle } from "@features/galgame-workshop/editor/StoryPlayer";
import type { StoryPlayerRuntimeSnapshot } from "@features/galgame-workshop/editor/storyPlayerModel";

vi.mock("@platform/api/client", () => ({
  fetchApiBlob: vi.fn().mockResolvedValue(new Blob(["audio"])),
}));

class ClipMockAudio {
  static instances: ClipMockAudio[] = [];
  volume = 1;
  loop = false;
  paused = true;
  currentTime = 0;
  duration = 20;
  readyState = 1;
  listeners = new Map<string, Set<EventListener>>();
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  removeAttribute = vi.fn();
  addEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      const callback =
        typeof listener === "function"
          ? listener
          : (event: Event) => listener.handleEvent(event);
      const listeners = this.listeners.get(type) ?? new Set<EventListener>();
      listeners.add(callback);
      this.listeners.set(type, listeners);
    },
  );
  removeEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function")
        this.listeners.get(type)?.delete(listener);
    },
  );

  constructor(public src = "") {
    ClipMockAudio.instances.push(this);
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? [])
      listener(new Event(type));
  }
}

const clipStory: GalgameStoryProject = {
  schemaVersion: "1.4",
  synopsis: "快速试片",
  entryChapterId: "chapter-1",
  characters: [
    {
      id: "hero",
      name: "调查员",
      description: "",
      expressions: [{ id: "calm", label: "平静", assetId: "hero-portrait" }],
      defaultExpressionId: "calm",
    },
  ],
  scenes: [{ id: "lab", name: "夜间研究所", description: "" }],
  cgs: [],
  variables: [],
  assets: [
    {
      id: "hero-portrait",
      type: "image",
      role: "characterPortrait",
      fileId: "file-hero-portrait",
      status: "ready",
    },
    {
      id: "clip-bgm",
      type: "audio",
      role: "backgroundMusic",
      label: "试片音乐",
      fileId: "file-clip-bgm",
      status: "ready",
    },
    {
      id: "clip-ambient",
      type: "audio",
      role: "ambientSound",
      label: "试片环境音",
      fileId: "file-clip-ambient",
      status: "ready",
    },
    {
      id: "clip-voice",
      type: "audio",
      role: "voiceLine",
      label: "中段对白",
      fileId: "file-clip-voice",
      status: "ready",
    },
  ],
  chapters: [
    {
      id: "chapter-1",
      title: "第一章",
      order: 1,
      entryFragmentId: "main",
      fragments: [
        {
          id: "main",
          title: "中段试片",
          timeline: { durationMs: 20_000 },
          blocks: [
            { id: "scene", type: "scene", sceneId: "lab", atMs: 0 },
            {
              id: "clip-bgm-play",
              type: "audio",
              action: "play",
              channel: "bgm",
              assetId: "clip-bgm",
              volume: 70,
              loop: true,
              fadeMs: 0,
              atMs: 0,
            },
            {
              id: "clip-ambient-play",
              type: "audio",
              action: "play",
              channel: "ambient",
              assetId: "clip-ambient",
              volume: 60,
              loop: true,
              fadeMs: 0,
              atMs: 0,
            },
            {
              id: "show-hero",
              type: "showCharacter",
              characterId: "hero",
              expressionId: null,
              transform: {
                x: 50,
                y: 100,
                anchor: "bottomCenter",
                scale: 1,
                brightness: 1,
                opacity: 1,
                flipX: false,
                layer: 10,
              },
              transition: { durationMs: 240, fade: true },
              atMs: 1000,
            },
            {
              id: "middle-line",
              type: "dialogue",
              characterId: "hero",
              text: "这是时间轴中段。",
              voiceAssetId: "clip-voice",
              voiceVolume: 80,
              startMs: 9000,
              endMs: 11_000,
            },
            {
              id: "later-line",
              type: "narration",
              text: "这句不应进入试片。",
              startMs: 12_000,
              endMs: 14_000,
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  ClipMockAudio.instances = [];
  vi.stubGlobal("Audio", ClipMockAudio);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:clip-${ClipMockAudio.instances.length}`),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

test("restores a non-zero timeline range with audio offsets and stops once", async () => {
  vi.useFakeTimers();
  const onComplete = vi.fn();
  const onAudioEvent = vi.fn();
  try {
    render(
      <StoryPlayer
        document={clipStory}
        exportMode={{
          branchSelections: {},
          choiceDurationMs: 2000,
          choiceHighlightMs: 500,
          timelineRange: {
            fragmentId: "main",
            startMs: 9500,
            endMs: 10_500,
          },
          onAudioEvent,
          onComplete,
        }}
      />,
    );
    await act(async () => Promise.resolve());

    expect(screen.getByText("这是时间轴中段。")).toBeInTheDocument();
    expect(
      document.querySelector('[data-character-id="hero"]'),
    ).toBeInTheDocument();
    expect(screen.queryByText("这句不应进入试片。")).not.toBeInTheDocument();
    expect(ClipMockAudio.instances).toHaveLength(3);
    act(() => {
      for (const audio of ClipMockAudio.instances) audio.dispatch("play");
    });
    expect(onAudioEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "voice",
        storyAssetId: "clip-voice",
        offsetMs: 500,
      }),
    );
    for (const [channel, storyAssetId] of [
      ["bgm", "clip-bgm"],
      ["ambient", "clip-ambient"],
    ])
      expect(onAudioEvent).toHaveBeenCalledWith(
        expect.objectContaining({ channel, storyAssetId, offsetMs: 9500 }),
      );

    act(() => vi.advanceTimersByTime(1100));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({
      ok: true,
      label: "快速试片完成",
    });
    act(() => vi.advanceTimersByTime(5000));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("这句不应进入试片。")).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("previews only the requested middle range and stays on its final frame", async () => {
  vi.useFakeTimers();
  const snapshots: StoryPlayerRuntimeSnapshot[] = [];
  const playerRef = createRef<StoryPlayerHandle>();
  try {
    render(
      <StoryPlayer
        ref={playerRef}
        document={clipStory}
        playbackRange={{
          fragmentId: "main",
          startMs: 9500,
          endMs: 10_500,
          autoPlay: true,
        }}
        onRuntimeSnapshot={(snapshot) => snapshots.push(snapshot)}
      />,
    );
    act(() => playerRef.current?.restart());
    await act(async () => Promise.resolve());

    expect(screen.getByText("这是时间轴中段。")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1200));
    expect(snapshots.at(-1)).toMatchObject({
      fragmentId: "main",
      positionMs: 10_500,
      playing: false,
    });
    expect(screen.queryByText("这句不应进入试片。")).not.toBeInTheDocument();

    act(() => playerRef.current?.togglePlayback());
    expect(snapshots.at(-1)?.positionMs).toBe(9500);
  } finally {
    vi.useRealTimers();
  }
});

test("loops a middle range without advancing into later content", async () => {
  vi.useFakeTimers();
  const snapshots: StoryPlayerRuntimeSnapshot[] = [];
  const playerRef = createRef<StoryPlayerHandle>();
  try {
    render(
      <StoryPlayer
        ref={playerRef}
        document={clipStory}
        playbackRange={{
          fragmentId: "main",
          startMs: 9500,
          endMs: 10_000,
          loop: true,
          autoPlay: true,
        }}
        onRuntimeSnapshot={(snapshot) => snapshots.push(snapshot)}
      />,
    );
    act(() => playerRef.current?.restart());
    await act(async () => Promise.resolve());
    act(() => vi.advanceTimersByTime(650));
    await act(async () => Promise.resolve());

    expect(snapshots.at(-1)?.positionMs).toBeGreaterThanOrEqual(9500);
    expect(snapshots.at(-1)?.positionMs).toBeLessThan(10_000);
    expect(snapshots.at(-1)?.playing).toBe(true);
    expect(screen.queryByText("这句不应进入试片。")).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("plays the opening performance before revealing the first timed line", () => {
  vi.useFakeTimers();
  try {
    const openingStory = structuredClone(clipStory);
    openingStory.assets = [];
    openingStory.chapters![0].fragments = [
      {
        id: "main",
        title: "开场演出",
        timeline: { durationMs: 3000 },
        blocks: [
          { id: "scene", type: "scene", sceneId: "lab", atMs: 0 },
          {
            id: "line",
            type: "narration",
            text: "第一句。",
            startMs: 1000,
            endMs: 2000,
          },
          {
            id: "end",
            type: "endChapter",
            endingId: "opening-ending",
            label: "开场结局",
          },
        ],
      },
    ];

    render(<StoryPlayer document={openingStory} />);
    fireEvent.click(screen.getByRole("button", { name: "开始试玩" }));
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.queryByText("第一句。")).not.toBeInTheDocument();
    expect(screen.getByLabelText("剧情时间轴进度")).toHaveValue("999");
    fireEvent.click(screen.getByRole("button", { name: "点击继续" }));
    expect(screen.getByText("第一句。")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
