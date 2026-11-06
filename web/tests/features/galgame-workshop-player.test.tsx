import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act, type ReactNode } from "react";
import { StoryPlayer } from "@features/galgame-workshop/editor/StoryPlayer";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { sourceFingerprint } from "@features/galgame-workshop/editor/localization";
import { beforeEach, vi } from "vitest";

vi.mock("@platform/api/client", () => ({
  fetchApiBlob: vi.fn().mockResolvedValue(new Blob(["audio"])),
}));

class MockAudio {
  static instances: MockAudio[] = [];
  static rejectNextPlay = false;
  src = "";
  volume = 1;
  loop = false;
  paused = true;
  currentTime = 0;
  duration = 1780.344;
  readyState = 1;
  listeners = new Map<string, Set<EventListener>>();
  play = vi.fn(async () => {
    if (MockAudio.rejectNextPlay) {
      MockAudio.rejectNextPlay = false;
      throw new Error("autoplay blocked");
    }
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
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
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });

  constructor(src = "") {
    this.src = src;
    MockAudio.instances.push(this);
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? [])
      listener(new Event(type));
  }
}

beforeEach(() => {
  MockAudio.instances = [];
  MockAudio.rejectNextPlay = false;
  localStorage.clear();
  vi.stubGlobal("Audio", MockAudio);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:audio-${MockAudio.instances.length}`),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

vi.mock("@features/galgame-workshop/editor/StoryAssetImage", () => ({
  StoryAssetImage: ({
    fileId,
    fallback,
    className,
  }: {
    fileId?: string;
    fallback: ReactNode;
    className?: string;
  }) =>
    fileId ? (
      <span
        data-testid={
          className?.includes("galgame-player-background")
            ? "background-file"
            : className === "galgame-player-cg-image"
              ? `cg-file-${fileId}`
              : className === "galgame-dialogue-skin-image"
                ? "dialogue-skin-file"
                : className === "galgame-player-ui-component-image"
                  ? `ui-component-${fileId}`
                  : "portrait-file"
        }
      >
        {fileId}
      </span>
    ) : (
      fallback
    ),
}));

const story: GalgameStoryProject = {
  schemaVersion: "1.0",
  synopsis: "双结局试玩",
  characters: [{ id: "hero", name: "调查员", description: "" }],
  scenes: [{ id: "lab", name: "夜间研究所", description: "" }],
  variables: [],
  assets: [],
  chapters: [
    {
      id: "chapter-1",
      title: "第一章",
      order: 1,
      entryFragmentId: "main",
      fragments: [
        {
          id: "main",
          title: "main",
          blocks: [
            { id: "scene", type: "scene", sceneId: "lab" },
            {
              id: "dialogue",
              type: "dialogue",
              characterId: "hero",
              text: "开始调查。",
            },
            {
              id: "branch",
              type: "branch",
              prompt: "检查哪里？",
              choices: [
                { id: "left", text: "设备", targetFragmentId: "left" },
                { id: "right", text: "时钟", targetFragmentId: "right" },
              ],
            },
          ],
        },
        {
          id: "left",
          title: "设备线",
          blocks: [
            { id: "left-text", type: "narration", text: "发现干扰。" },
            {
              id: "left-end",
              type: "endChapter",
              endingId: "ending-left",
              label: "设备结局",
            },
          ],
        },
        {
          id: "right",
          title: "时钟线",
          blocks: [
            { id: "right-text", type: "narration", text: "发现偏差。" },
            {
              id: "right-end",
              type: "endChapter",
              endingId: "ending-right",
              label: "时钟结局",
            },
          ],
        },
      ],
    },
  ],
};

function localizedPlayerStory(): GalgameStoryProject {
  return {
    ...structuredClone(story),
    localizations: {
      sourceLocale: "zh-CN",
      defaultLocale: "en-US",
      targets: [
        {
          locale: "en-US",
          entries: [
            {
              blockId: "dialogue",
              field: "text",
              sourceFingerprint: sourceFingerprint("开始调查。"),
              text: "Start the investigation.",
            },
            {
              blockId: "branch",
              field: "prompt",
              sourceFingerprint: sourceFingerprint("检查哪里？"),
              text: "Where should we inspect?",
            },
            {
              blockId: "branch",
              field: "choiceText",
              choiceId: "left",
              sourceFingerprint: sourceFingerprint("设备"),
              text: "Device",
            },
            {
              blockId: "left-text",
              field: "text",
              sourceFingerprint: sourceFingerprint("发现干扰。"),
              text: "Interference found.",
            },
          ],
        },
      ],
    },
  };
}

test("plays the startup locale, supports an explicit override and rejects stale text", async () => {
  const user = userEvent.setup();
  const localized = localizedPlayerStory();
  const first = render(<StoryPlayer document={localized} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  await user.click(
    screen.getByText("Start the investigation.").closest("button")!,
  );
  expect(screen.getByText("Where should we inspect?")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Device" }));
  expect(screen.getByText("Interference found.")).toBeInTheDocument();
  first.unmount();

  const second = render(<StoryPlayer document={localized} locale="zh-CN" />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(screen.getByText("开始调查。")).toBeInTheDocument();
  second.unmount();

  localized.localizations!.targets![0].entries![0].sourceFingerprint = "stale";
  render(<StoryPlayer document={localized} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(screen.getByText("开始调查。")).toBeInTheDocument();
});

test("plays both branches and restores the initial stage on restart", async () => {
  const user = userEvent.setup();
  render(<StoryPlayer document={story} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(screen.getAllByText("夜间研究所")).toHaveLength(2);
  await user.click(screen.getByText("开始调查。").closest("button")!);
  await user.click(screen.getByRole("button", { name: "设备" }));
  await user.click(screen.getByText("发现干扰。").closest("button")!);
  expect(screen.getByText("设备结局")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "重新开始" }));
  await user.click(screen.getByText("开始调查。").closest("button")!);
  await user.click(screen.getByRole("button", { name: "时钟" }));
  await user.click(screen.getByText("发现偏差。").closest("button")!);
  expect(screen.getByText("时钟结局")).toBeInTheDocument();
});

test("uses two clicks to reveal then advance a line", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  const user = userEvent.setup();
  render(<StoryPlayer document={story} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  const dialogue = screen.getByText("点击显示全文").closest("button")!;
  expect(screen.queryByText("开始调查。")).not.toBeInTheDocument();
  await user.click(dialogue);
  await waitFor(
    () => expect(screen.getByText("开始调查。")).toBeInTheDocument(),
    { timeout: 2000 },
  );
  expect(
    screen.queryByRole("button", { name: "设备" }),
  ).not.toBeInTheDocument();
  await user.click(dialogue);
  expect(screen.getByRole("button", { name: "设备" })).toBeInTheDocument();
});

test("reveals dialogue one character at a time in the edit preview", () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );

  try {
    render(
      <StoryPlayer
        document={story}
        mode="edit"
        editFragment={story.chapters![0].fragments![0]}
        editBlockIndex={1}
      />,
    );

    expect(screen.queryByText("开始调查。")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(25));
    expect(screen.getByText("开")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(25));
    expect(screen.getByText("开始")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(75));
    expect(screen.getByText("开始调查。")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("keeps missing-portrait placeholders out of export frames", async () => {
  const user = userEvent.setup();
  const playable = render(<StoryPlayer document={story} />);

  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(screen.getByText("开始调查。")).toBeInTheDocument();
  expect(
    playable.container.querySelector(".galgame-player-portrait-fallback"),
  ).toHaveTextContent("调");
  expect(
    playable.container.querySelector('[data-character-id="hero"]'),
  ).toBeInTheDocument();
  playable.unmount();

  const exported = render(
    <StoryPlayer
      document={story}
      exportMode={{
        branchSelections: { branch: "left" },
        choiceDurationMs: 2000,
        choiceHighlightMs: 500,
      }}
    />,
  );
  await act(async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  });
  expect(
    exported.container.querySelector(".galgame-player-portrait-fallback"),
  ).toBeNull();
  expect(
    exported.container.querySelector('[data-character-id="hero"]'),
  ).toBeNull();
  exported.unmount();

  const edited = render(
    <StoryPlayer
      document={story}
      mode="edit"
      editFragment={story.chapters![0].fragments![0]}
      editBlockIndex={1}
    />,
  );
  expect(
    edited.container.querySelector(".galgame-player-portrait-fallback"),
  ).toHaveTextContent("调");
});

test("automatically advances an untimed legacy fragment", () => {
  vi.useFakeTimers();
  try {
    const autoStory = structuredClone(story);
    autoStory.chapters![0].fragments = [
      {
        id: "main",
        title: "main",
        blocks: [
          { id: "line", type: "narration", text: "自动推进。" },
          {
            id: "end",
            type: "endChapter",
            endingId: "auto-ending",
            label: "自动结局",
          },
        ],
      },
    ];
    render(<StoryPlayer document={autoStory} />);
    fireEvent.click(screen.getByRole("button", { name: "开始试玩" }));
    fireEvent.click(screen.getByRole("button", { name: "自动" }));
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByText("自动结局")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("throttles workbench playback position reports during timeline playback", () => {
  vi.useFakeTimers();
  try {
    const openingStory = structuredClone(story);
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
        ],
      },
    ];
    const onPlaybackPosition = vi.fn();

    render(
      <StoryPlayer
        document={openingStory}
        onPlaybackPosition={onPlaybackPosition}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "开始试玩" }));
    act(() => vi.advanceTimersByTime(1200));

    expect(screen.getByLabelText("剧情时间轴进度")).toHaveValue("999");
    expect(onPlaybackPosition.mock.calls.length).toBeLessThan(10);
  } finally {
    vi.useRealTimers();
  }
});

test("plays a performance-only fragment through its full timeline", () => {
  vi.useFakeTimers();
  try {
    const performanceStory = structuredClone(story);
    performanceStory.chapters![0].fragments = [
      {
        id: "main",
        title: "纯演出",
        timeline: { durationMs: 1000 },
        blocks: [
          {
            id: "scene",
            type: "scene",
            sceneId: "lab",
            atMs: 0,
          },
          {
            id: "end",
            type: "endChapter",
            endingId: "performance-ending",
            label: "演出结局",
          },
        ],
      },
    ];

    render(<StoryPlayer document={performanceStory} />);
    fireEvent.click(screen.getByRole("button", { name: "开始试玩" }));
    act(() => vi.advanceTimersByTime(1200));

    expect(screen.getByLabelText("剧情时间轴进度")).toHaveValue("999");
    expect(screen.getByRole("button", { name: "点击继续" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "点击继续" }));
    expect(screen.getByText("演出结局")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("treats a naturally finished Fragment as a valid story stop", async () => {
  const user = userEvent.setup();
  const openStory = structuredClone(story);
  openStory.chapters![0].fragments![0].blocks = [
    { id: "only-text", type: "narration", text: "尚未完成" },
  ];
  render(<StoryPlayer document={openStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  await user.click(screen.getByText("尚未完成").closest("button")!);
  expect(screen.getByText("故事结束")).toBeInTheDocument();
});

test("uses the default portrait unless dialogue selects an expression", async () => {
  const user = userEvent.setup();
  const portraitStory = structuredClone(story);
  portraitStory.characters = [
    {
      id: "hero",
      name: "调查员",
      description: "",
      expressions: [
        { id: "calm", label: "平静", assetId: "asset-calm" },
        { id: "smile", label: "微笑", assetId: "asset-smile" },
      ],
      defaultExpressionId: "calm",
      portraitSkins: [
        {
          id: "winter",
          name: "冬装",
          overrides: [{ expressionId: "calm", assetId: "asset-calm-winter" }],
        },
      ],
      defaultPortraitSkinId: "winter",
    },
  ];
  portraitStory.assets = [
    {
      id: "asset-calm",
      type: "image",
      role: "characterPortrait",
      fileId: "file-calm",
      status: "ready",
    },
    {
      id: "asset-smile",
      type: "image",
      role: "characterPortrait",
      fileId: "file-smile",
      status: "ready",
    },
    {
      id: "asset-calm-winter",
      type: "image",
      role: "characterPortrait",
      fileId: "file-calm-winter",
      status: "ready",
    },
  ];

  const dialogue = portraitStory.chapters![0].fragments![0].blocks![1];
  if (dialogue.type !== "dialogue") throw new Error("expected dialogue");
  const first = render(<StoryPlayer document={portraitStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(screen.getByTestId("portrait-file")).toHaveTextContent(
    "file-calm-winter",
  );
  first.unmount();

  dialogue.expressionId = "smile";
  render(<StoryPlayer document={portraitStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(screen.getByTestId("portrait-file")).toHaveTextContent("file-smile");
});

test("keeps a voice-driven mouth sequence closed when no voice is playing", async () => {
  vi.useFakeTimers();
  try {
    const lipSyncStory = structuredClone(story);
    lipSyncStory.characters = [
      {
        id: "hero",
        name: "调查员",
        description: "",
        expressions: [
          {
            id: "calm",
            label: "平静",
            assetId: "mouth-closed",
            renderMode: "frameSequence",
            sequence: {
              playbackMode: "lipSync",
              fps: 12,
              loop: true,
              frames: [
                { id: "mouth-frame-closed", assetId: "mouth-closed" },
                { id: "mouth-frame-half", assetId: "mouth-half" },
                { id: "mouth-frame-open", assetId: "mouth-open" },
              ],
            },
          },
        ],
        defaultExpressionId: "calm",
      },
    ];
    lipSyncStory.assets = [
      ["mouth-closed", "file-mouth-closed"],
      ["mouth-half", "file-mouth-half"],
      ["mouth-open", "file-mouth-open"],
    ].map(([id, fileId]) => ({
      id,
      type: "image" as const,
      role: "characterPortrait" as const,
      fileId,
      status: "ready" as const,
    }));
    lipSyncStory.presentation = {
      stage: {
        speakerFocusEnabled: true,
        inactiveBrightness: 0.6,
        focusTransitionMs: 180,
        lipSyncEnabled: true,
      },
    };
    lipSyncStory.chapters![0].fragments![0].blocks = [
      { id: "scene", type: "scene", sceneId: "lab" },
      {
        id: "show-hero",
        type: "showCharacter",
        characterId: "hero",
        expressionId: "calm",
      },
      {
        id: "dialogue",
        type: "dialogue",
        characterId: "hero",
        expressionId: "calm",
        text: "没有配音。",
      },
    ];

    const rendered = render(<StoryPlayer document={lipSyncStory} />);
    fireEvent.click(screen.getByRole("button", { name: "开始试玩" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const portrait = rendered.container.querySelector(
      ".galgame-player-portrait-image",
    );
    expect(portrait).toHaveAttribute("data-sequence-frame", "0");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(portrait).toHaveAttribute("data-sequence-frame", "0");
    rendered.unmount();
  } finally {
    vi.useRealTimers();
  }
});

test("renders character placement from the character asset settings", async () => {
  const user = userEvent.setup();
  const anchorStory = structuredClone(story);
  anchorStory.settings = {
    canvas: { width: 1920, height: 1080 },
    characterStage: {
      anchor: "center",
      defaultPositionId: "asset-position",
      defaultHeightPercent: 100,
      positionPresets: [
        {
          id: "asset-position",
          name: "资产站位",
          x: 40,
          y: 60,
        },
      ],
    },
  };
  anchorStory.chapters![0].fragments![0].blocks = [
    { id: "scene", type: "scene", sceneId: "lab" },
    {
      id: "show-hero",
      type: "showCharacter",
      characterId: "hero",
      expressionId: null,
      transform: {
        x: 40,
        y: 60,
        anchor: "center",
        scale: 1,
        brightness: 1,
        opacity: 1,
        flipX: false,
        layer: 10,
      },
      transition: { durationMs: 0, fade: false },
    },
    {
      id: "line",
      type: "dialogue",
      characterId: "hero",
      text: "锚点测试",
      portrait: { mode: "dialogueAvatar", visible: true, keepAfter: false },
    },
  ];

  const first = render(<StoryPlayer document={anchorStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(first.container.querySelector(".galgame-stage-actor")).toHaveStyle({
    left: "40%",
    top: "60%",
    transform: "translate(-50%, -50%) scale(1) scaleX(1)",
    transformOrigin: "center",
  });
  first.unmount();

  const showBlock = anchorStory.chapters![0].fragments![0].blocks![1];
  if (showBlock.type !== "showCharacter")
    throw new Error("expected showCharacter");
  showBlock.transform!.x = 95;
  showBlock.transform!.y = 90;
  showBlock.transform!.anchor = "bottomCenter";
  anchorStory.settings!.characterStage!.anchor = "bottomCenter";
  anchorStory.settings!.characterStage!.positionPresets![0].y = 100;
  const second = render(<StoryPlayer document={anchorStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(second.container.querySelector(".galgame-stage-actor")).toHaveStyle({
    left: "40%",
    top: "100%",
    transform: "translate(-50%, -100%) scale(1) scaleX(1)",
    transformOrigin: "bottom center",
  });
});

test("keeps characters non-interactive in the script edit preview", () => {
  const previewStory = structuredClone(story);
  previewStory.chapters![0].fragments![0].blocks = [
    { id: "scene", type: "scene", sceneId: "lab" },
    {
      id: "show-hero",
      type: "showCharacter",
      characterId: "hero",
      expressionId: null,
      transform: {
        x: 40,
        y: 60,
        anchor: "center",
        scale: 1,
        brightness: 1,
        opacity: 1,
        flipX: false,
        layer: 10,
      },
      transition: { durationMs: 0, fade: false },
    },
    {
      id: "line",
      type: "dialogue",
      characterId: "hero",
      text: "只读舞台预览",
    },
  ];

  const rendered = render(
    <StoryPlayer
      document={previewStory}
      mode="edit"
      editFragment={previewStory.chapters![0].fragments![0]}
      editBlockIndex={2}
    />,
  );
  const actor = rendered.container.querySelector('[data-character-id="hero"]');

  expect(actor).toBeInTheDocument();
  expect(actor).not.toHaveClass("is-editable");
  expect(actor).not.toHaveAttribute("tabindex");
  expect(actor).not.toHaveAttribute("aria-label");
});

test.each([
  [false, false, 1],
  [true, false, -1],
  [false, true, -1],
  [true, true, 1],
] as const)(
  "composes expression flip %s with block flip %s",
  async (expressionFlip, blockFlip, expectedScale) => {
    const user = userEvent.setup();
    const flipStory = structuredClone(story);
    flipStory.characters = [
      {
        id: "hero",
        name: "调查员",
        description: "",
        expressions: [
          {
            id: "calm",
            label: "平静",
            assetId: "asset-calm",
            flipX: expressionFlip,
            dialogueAvatar: {
              source: "portrait",
              crop: { x: 50, y: 25, scale: 1.8 },
            },
          },
        ],
        defaultExpressionId: "calm",
        dialogueAvatar: { enabled: false },
      },
    ];
    flipStory.assets = [
      {
        id: "asset-calm",
        type: "image",
        role: "characterPortrait",
        fileId: "file-calm",
        status: "ready",
      },
    ];
    flipStory.chapters![0].fragments![0].blocks = [
      { id: "scene", type: "scene", sceneId: "lab" },
      {
        id: "show-hero",
        type: "showCharacter",
        characterId: "hero",
        expressionId: null,
        transform: {
          x: 40,
          y: 60,
          anchor: "center",
          scale: 1,
          brightness: 1,
          opacity: 1,
          flipX: blockFlip,
          layer: 10,
        },
        transition: { durationMs: 0, fade: false },
      },
      {
        id: "line",
        type: "dialogue",
        characterId: "hero",
        text: "翻转测试",
        portrait: {
          mode: "dialogueAvatar",
          visible: true,
          keepAfter: false,
        },
      },
    ];

    const rendered = render(<StoryPlayer document={flipStory} />);
    await user.click(screen.getByRole("button", { name: "开始试玩" }));
    expect(
      rendered.container.querySelector(".galgame-stage-actor"),
    ).toHaveStyle({
      transform: `translate(-50%, -50%) scale(1) scaleX(${expectedScale})`,
    });
  },
);

test("does not apply expression flipping to dialogue avatars", async () => {
  const user = userEvent.setup();
  const avatarStory = structuredClone(story);
  avatarStory.characters = [
    {
      id: "hero",
      name: "调查员",
      description: "",
      expressions: [
        {
          id: "calm",
          label: "平静",
          assetId: "asset-calm",
          flipX: true,
          dialogueAvatar: {
            source: "portrait",
            crop: { x: 50, y: 25, scale: 1.8 },
          },
        },
      ],
      defaultExpressionId: "calm",
      dialogueAvatar: { enabled: true },
    },
  ];
  avatarStory.assets = [
    {
      id: "asset-calm",
      type: "image",
      role: "characterPortrait",
      fileId: "file-calm",
      status: "ready",
    },
  ];
  const dialogue = avatarStory.chapters![0].fragments![0].blocks![1];
  if (dialogue.type !== "dialogue") throw new Error("expected dialogue");
  dialogue.expressionId = "calm";
  dialogue.portrait = {
    mode: "dialogueAvatar",
    visible: true,
    keepAfter: false,
  };

  const rendered = render(<StoryPlayer document={avatarStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  const avatar = rendered.container.querySelector(
    ".galgame-dialogue-runtime-avatar",
  );
  expect(avatar).toBeInTheDocument();
  expect(avatar).not.toHaveStyle({ transform: "scaleX(-1)" });
});

test("keeps multiple staged characters, applies speaker focus, and removes actors", async () => {
  const user = userEvent.setup();
  const stageStory = structuredClone(story);
  stageStory.characters = [
    {
      id: "hero",
      name: "调查员",
      description: "",
      expressions: [{ id: "calm", label: "平静", assetId: "hero-portrait" }],
      defaultExpressionId: "calm",
    },
    {
      id: "partner",
      name: "助手",
      description: "",
      expressions: [
        { id: "neutral", label: "普通", assetId: "partner-portrait" },
      ],
      defaultExpressionId: "neutral",
    },
  ];
  stageStory.assets = [
    {
      id: "hero-portrait",
      type: "image",
      role: "characterPortrait",
      fileId: "file-hero",
      status: "ready",
    },
    {
      id: "partner-portrait",
      type: "image",
      role: "characterPortrait",
      fileId: "file-partner",
      status: "ready",
    },
  ];
  stageStory.presentation = {
    stage: {
      speakerFocusEnabled: true,
      inactiveBrightness: 0.6,
      focusTransitionMs: 180,
      lipSyncEnabled: false,
    },
  };
  stageStory.settings = {
    canvas: { width: 1920, height: 1080 },
    characterStage: {
      anchor: "center",
      defaultPositionId: "position-left",
      defaultHeightPercent: 100,
      positionPresets: [
        { id: "position-left", name: "左", x: 25, y: 50 },
        { id: "position-right", name: "右", x: 75, y: 50 },
      ],
    },
  };
  stageStory.chapters![0].fragments = [
    {
      id: "main",
      title: "main",
      blocks: [
        { id: "scene", type: "scene", sceneId: "lab", clearCharacters: true },
        {
          id: "show-hero",
          type: "showCharacter",
          characterId: "hero",
          expressionId: "calm",
          positionId: "position-left",
          transform: {
            x: 25,
            y: 100,
            anchor: "bottomCenter",
            scale: 1,
            brightness: 1,
            opacity: 1,
            flipX: false,
            layer: 10,
          },
          transition: { durationMs: 240, fade: true },
        },
        {
          id: "show-partner",
          type: "showCharacter",
          characterId: "partner",
          expressionId: "neutral",
          positionId: "position-right",
          transform: {
            x: 75,
            y: 100,
            anchor: "bottomCenter",
            scale: 0.9,
            brightness: 0.8,
            opacity: 1,
            flipX: true,
            layer: 11,
          },
          transition: { durationMs: 300, fade: true },
        },
        {
          id: "hero-line",
          type: "dialogue",
          characterId: "hero",
          expressionId: "calm",
          text: "两个人都在画面里。",
          voiceVolume: 100,
          portrait: {
            mode: "stage",
            positionId: "position-left",
            keepAfter: true,
            transform: null,
            transition: { durationMs: 180, fade: true },
          },
        },
        { id: "narration", type: "narration", text: "灯光恢复平衡。" },
        {
          id: "remove-partner",
          type: "removeCharacter",
          characterId: "partner",
          all: false,
          transition: { durationMs: 240, fade: true },
        },
        { id: "after-remove", type: "narration", text: "助手退场了。" },
        {
          id: "end",
          type: "endChapter",
          endingId: "stage-ending",
          label: "舞台结局",
        },
      ],
    },
  ];

  const { container } = render(<StoryPlayer document={stageStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  const hero = container.querySelector<HTMLElement>(
    '[data-character-id="hero"]',
  )!;
  const partner = container.querySelector<HTMLElement>(
    '[data-character-id="partner"]',
  )!;
  expect(hero).toHaveStyle({ left: "25%", opacity: "1" });
  expect(partner).toHaveStyle({ left: "75%" });
  expect(Number(hero.style.zIndex)).toBeGreaterThan(
    Number(partner.style.zIndex),
  );
  expect(hero.style.filter).toContain("brightness(1)");
  expect(partner.style.filter).toContain("brightness(0.48)");
  expect(hero.style.filter).not.toContain("drop-shadow");
  expect(partner.style.filter).not.toContain("drop-shadow");

  await user.click(screen.getByText("两个人都在画面里。").closest("button")!);
  expect(partner.style.filter).toContain("brightness(0.8)");
  await user.click(screen.getByText("灯光恢复平衡。").closest("button")!);
  expect(partner).toHaveStyle({ opacity: "0" });
  expect(screen.getByText("助手退场了。")).toBeInTheDocument();
});
