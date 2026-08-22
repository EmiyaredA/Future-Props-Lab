import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act, type ReactNode } from "react";
import { StoryPlayer } from "@features/galgame-workshop/editor/StoryPlayer";
import {
  dialogueBoxPresetStyle,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
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

test("exports a preselected route without player controls", async () => {
  vi.useFakeTimers();
  const onComplete = vi.fn();
  try {
    const rendered = render(
      <StoryPlayer
        document={story}
        exportMode={{
          branchSelections: { branch: "left" },
          choiceDurationMs: 2000,
          choiceHighlightMs: 500,
          onComplete,
        }}
      />,
    );
    await act(async () => {
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });

    expect(
      screen.queryByRole("button", { name: "开始试玩" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "自动" }),
    ).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1600));
    const chosen = screen.getByRole("button", { name: "设备" });
    expect(chosen).not.toHaveClass("is-export-selected");
    act(() => vi.advanceTimersByTime(1500));
    expect(chosen).toHaveClass("is-export-selected");
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText("发现干扰。")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1600));
    expect(onComplete).toHaveBeenCalledWith({ ok: true, label: "设备结局" });
    expect(rendered.container.querySelector(".galgame-ending")).toBeNull();
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
      await Promise.resolve();
      await Promise.resolve();
    });
    const portrait = rendered.container.querySelector(
      ".galgame-player-portrait-image",
    );
    expect(portrait).toHaveAttribute("data-sequence-frame", "0");
    act(() => vi.advanceTimersByTime(1000));
    expect(portrait).toHaveAttribute("data-sequence-frame", "0");
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

test("shows multiple speaker names and keeps every speaking stage actor focused", async () => {
  const user = userEvent.setup();
  const multiSpeakerStory = structuredClone(story);
  multiSpeakerStory.characters = [
    { id: "hero", name: "调查员", description: "" },
    { id: "partner", name: "助手", description: "" },
  ];
  multiSpeakerStory.chapters![0].fragments![0].blocks = [
    { id: "scene", type: "scene", sceneId: "lab" },
    {
      id: "show-hero",
      type: "showCharacter",
      characterId: "hero",
      expressionId: null,
      transform: {
        x: 30,
        y: 100,
        anchor: "bottomCenter",
        scale: 1,
        brightness: 1,
        opacity: 1,
        flipX: false,
        layer: 10,
      },
      transition: { durationMs: 0, fade: false },
    },
    {
      id: "show-partner",
      type: "showCharacter",
      characterId: "partner",
      expressionId: null,
      transform: {
        x: 70,
        y: 100,
        anchor: "bottomCenter",
        scale: 1,
        brightness: 1,
        opacity: 1,
        flipX: false,
        layer: 10,
      },
      transition: { durationMs: 0, fade: false },
    },
    {
      id: "dialogue",
      type: "dialogue",
      characterId: "hero",
      speakerIds: ["hero", "partner"],
      text: "就是现在！",
      portrait: {
        mode: "stage",
        keepAfter: true,
        transform: null,
        transition: { durationMs: 0, fade: false },
      },
    },
    {
      id: "end",
      type: "endChapter",
      endingId: "together",
      label: "共同结局",
    },
  ];

  render(<StoryPlayer document={multiSpeakerStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));

  expect(screen.getByText("调查员、助手")).toBeInTheDocument();
  expect(screen.getByText("就是现在！")).toBeInTheDocument();
  const hero = document.querySelector<HTMLElement>(
    '[data-character-id="hero"]',
  );
  const partner = document.querySelector<HTMLElement>(
    '[data-character-id="partner"]',
  );
  expect(hero).toBeInTheDocument();
  expect(partner).toBeInTheDocument();
  expect(hero?.style.filter).toContain("brightness(1)");
  expect(partner?.style.filter).toContain("brightness(1)");
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
  expect(hero.style.filter).toContain("brightness(1)");
  expect(partner.style.filter).toContain("brightness(0.48)");

  await user.click(screen.getByText("两个人都在画面里。").closest("button")!);
  expect(partner.style.filter).toContain("brightness(0.8)");
  await user.click(screen.getByText("灯光恢复平衡。").closest("button")!);
  expect(partner).toHaveStyle({ opacity: "0" });
  expect(screen.getByText("助手退场了。")).toBeInTheDocument();
});

test("renders every scene layer in its saved order", async () => {
  const user = userEvent.setup();
  const backgroundStory = structuredClone(story);
  backgroundStory.scenes = [
    {
      id: "lab",
      name: "夜间研究所",
      description: "",
      layers: [
        {
          id: "night",
          name: "夜间",
          assetId: "asset-night",
          distance: 1,
          offsetX: 0,
          offsetY: 0,
        },
        {
          id: "rain",
          name: "雨夜",
          assetId: "asset-rain",
          distance: 2,
          offsetX: 3,
          offsetY: 0,
        },
      ],
    },
  ];
  backgroundStory.assets = [
    {
      id: "asset-night",
      type: "image",
      role: "sceneLayer",
      fileId: "file-night",
      status: "ready",
    },
    {
      id: "asset-rain",
      type: "image",
      role: "sceneLayer",
      fileId: "file-rain",
      status: "ready",
    },
  ];

  const first = render(<StoryPlayer document={backgroundStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  const backgrounds = screen.getAllByTestId("background-file");
  expect(backgrounds[0]).toHaveTextContent("file-night");
  expect(backgrounds[1]).toHaveTextContent("file-rain");
  first.unmount();
});

test("shows and hides CGs without discarding the underlying stage or custom UI", async () => {
  const user = userEvent.setup();
  const cgStory = structuredClone(story);
  cgStory.cgs = [
    {
      id: "confession",
      name: "雨中告白",
      description: "",
      variants: [{ id: "normal", label: "标准", assetId: "asset-confession" }],
      defaultVariantId: "normal",
    },
  ];
  cgStory.assets = [
    {
      id: "asset-confession",
      type: "image",
      role: "storyCg",
      fileId: "file-confession",
      status: "ready",
    },
    {
      id: "asset-hud",
      type: "image",
      role: "uiComponent",
      fileId: "file-hud",
      status: "ready",
    },
  ];
  cgStory.presentation = {
    ui: {
      components: [
        {
          id: "hud",
          name: "日期 HUD",
          assetId: "asset-hud",
          x: 4,
          y: 4,
          width: 20,
          visibility: "always",
          layer: 3,
        },
      ],
    },
  };
  cgStory.chapters![0].fragments![0].blocks = [
    { id: "scene", type: "scene", sceneId: "lab" },
    {
      id: "show-cg",
      type: "showCg",
      cgId: "confession",
      variantId: null,
      displayMode: "fullscreen",
      fit: "contain",
      transition: { durationMs: 400, fade: true },
    },
    {
      id: "line-one",
      type: "dialogue",
      characterId: "hero",
      text: "CG 上仍然显示对白。",
    },
    { id: "scene-again", type: "scene", sceneId: "lab" },
    { id: "line-two", type: "narration", text: "切换场景没有关闭 CG。" },
    {
      id: "hide-cg",
      type: "hideCg",
      transition: { durationMs: 250, fade: true },
    },
    { id: "after-cg", type: "narration", text: "底层舞台恢复。" },
    {
      id: "end",
      type: "endChapter",
      endingId: "cg-ending",
      label: "CG 结局",
    },
  ];

  const { container, unmount } = render(<StoryPlayer document={cgStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(screen.getByTestId("cg-file-file-confession")).toBeInTheDocument();
  expect(container.querySelector('[data-cg-id="confession"]')).toHaveAttribute(
    "data-fit",
    "contain",
  );
  expect(screen.getByTestId("ui-component-file-hud")).toBeInTheDocument();
  expect(screen.getByText("CG 上仍然显示对白。").closest("button")).toHaveClass(
    "galgame-dialogue-box",
  );

  await user.click(screen.getByText("CG 上仍然显示对白。").closest("button")!);
  expect(screen.getByText("切换场景没有关闭 CG。")).toBeInTheDocument();
  expect(container.querySelector('[data-cg-id="confession"]')).toHaveAttribute(
    "data-fit",
    "contain",
  );

  await user.click(
    screen.getByText("切换场景没有关闭 CG。").closest("button")!,
  );
  expect(screen.getByText("底层舞台恢复。")).toBeInTheDocument();
  expect(
    container.querySelector('[data-cg-id="confession"][data-exiting="true"]'),
  ).toBeInTheDocument();
  expect(
    container.querySelector('[data-cg-id="confession"]:not([data-exiting])'),
  ).not.toBeInTheDocument();

  unmount();
  const showCg = cgStory.chapters![0].fragments![0].blocks![1];
  if (showCg.type !== "showCg") throw new Error("expected show CG block");
  showCg.displayMode = "overlay";
  showCg.overlay = {
    x: 25,
    y: 40,
    width: 70,
    opacity: 0.65,
    placement: "behindCharacters",
  };
  const onCgOverlayChange = vi.fn();
  const edited = render(
    <StoryPlayer
      document={cgStory}
      mode="edit"
      editFragment={cgStory.chapters![0].fragments![0]}
      editBlockIndex={1}
      editableCgBlockId="show-cg"
      onCgOverlayChange={onCgOverlayChange}
    />,
  );
  const editableCg = screen.getByLabelText(/调整 雨中告白/);
  expect(editableCg).toHaveAttribute("data-display-mode", "overlay");
  expect(editableCg).toHaveStyle({ left: "25%", top: "40%", width: "70%" });
  expect(editableCg).toHaveStyle({ zIndex: "5" });
  fireEvent.keyDown(editableCg, { key: "ArrowRight" });
  expect(onCgOverlayChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ x: 26, y: 40, width: 70 }),
  );
  fireEvent.keyDown(
    screen.getByRole("separator", { name: "调整 CG 画面宽度" }),
    { key: "ArrowRight", shiftKey: true },
  );
  expect(onCgOverlayChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ width: 75 }),
  );
  edited.unmount();
});

test("applies saved dialogue and custom Gal components in the preview", async () => {
  const user = userEvent.setup();
  const styledStory = structuredClone(story);
  styledStory.assets = [
    {
      id: "asset-dialogue-frame",
      type: "image",
      role: "dialogueBox",
      fileId: "file-dialogue-frame",
      status: "ready",
    },
    {
      id: "asset-status-panel",
      type: "image",
      role: "uiComponent",
      fileId: "file-status-panel",
      status: "ready",
    },
    {
      id: "asset-choice-decoration",
      type: "image",
      role: "uiComponent",
      fileId: "file-choice-decoration",
      status: "ready",
    },
  ];
  styledStory.presentation = {
    dialogueBox: {
      preset: "custom",
      assetId: "asset-dialogue-frame",
      backgroundColor: "#172033",
      textColor: "#F8FAFC",
      nameColor: "#FB7185",
      backgroundOpacity: 0.7,
      borderRadius: 18,
      fontScale: 1.1,
    },
    ui: {
      components: [
        {
          id: "status-panel",
          name: "实验状态条",
          assetId: "asset-status-panel",
          x: 7,
          y: 9,
          width: 28,
          visibility: "dialogue",
          layer: 4,
        },
        {
          id: "choice-decoration",
          name: "选择装饰",
          assetId: "asset-choice-decoration",
          x: 18,
          y: 30,
          width: 64,
          visibility: "choices",
          layer: 2,
        },
      ],
    },
  };
  render(<StoryPlayer document={styledStory} />);

  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  const dialogue = screen.getByText("开始调查。").closest("button")!;
  expect(screen.getByTestId("dialogue-skin-file")).toHaveTextContent(
    "file-dialogue-frame",
  );
  expect(
    screen.getByTestId("ui-component-file-status-panel"),
  ).toHaveTextContent("file-status-panel");
  const statusPanel = document.querySelector<HTMLElement>(
    '[data-component-id="status-panel"]',
  )!;
  expect(statusPanel).toHaveStyle({
    left: "7%",
    top: "9%",
    width: "28%",
    zIndex: "44",
  });
  expect(dialogue.style.background).toContain("rgba(23, 32, 51, 0.7)");
  expect(dialogue).toHaveStyle({
    borderRadius: "18px",
    color: "#F8FAFC",
  });
  expect(dialogue.style.getPropertyValue("--dialogue-body-font-size")).toBe(
    "clamp(14px, 1.375cqw, 28px)",
  );
  expect(dialogue.style.getPropertyValue("--dialogue-name-color")).toBe(
    "#FB7185",
  );
  await user.click(dialogue);
  expect(
    screen.getByTestId("ui-component-file-choice-decoration"),
  ).toHaveTextContent("file-choice-decoration");
  expect(
    screen.queryByTestId("ui-component-file-status-panel"),
  ).not.toBeInTheDocument();
});

test("renders the classic gradient dialogue preset with export-safe AUTO status", async () => {
  const classicStory = structuredClone(story);
  classicStory.presentation = {
    ...classicStory.presentation,
    dialogueBox: dialogueBoxPresetStyle("classicGradient"),
  };

  render(<StoryPlayer document={classicStory} />);
  fireEvent.click(screen.getByRole("button", { name: "开始试玩" }));
  fireEvent.click(screen.getByRole("button", { name: "自动" }));

  const dialogue = screen.getByText("开始调查。").closest("button")!;
  expect(dialogue).toHaveClass(
    "layout-bottomOverlay",
    "background-verticalGradient",
    "body-left",
    "name-bottomCenter",
    "name-decoration-sideLines",
    "indicator-bottomLeft",
    "indicator-style-compact",
    "top-rule-double",
  );
  expect(dialogue.querySelector(".galgame-dialogue-body")).toHaveTextContent(
    "开始调查。",
  );
  expect(
    dialogue.querySelector(".galgame-dialogue-advance-indicator"),
  ).toHaveTextContent("AUTO");
  expect(dialogue.style.getPropertyValue("--dialogue-body-font-size")).toBe(
    "clamp(12px, 1.5625cqw, 30px)",
  );
});

test("runs voice, persistent music, ambient and sound-effect channels and cleans them up", async () => {
  const user = userEvent.setup();
  const audioStory = structuredClone(story);
  audioStory.assets = [
    {
      id: "bgm",
      type: "audio",
      role: "backgroundMusic",
      label: "雨夜咖啡馆",
      fileId: "file-bgm",
      status: "ready",
    },
    {
      id: "ambient",
      type: "audio",
      role: "ambientSound",
      label: "窗外细雨",
      fileId: "file-ambient",
      status: "ready",
    },
    {
      id: "voice",
      type: "audio",
      role: "voiceLine",
      label: "开始调查",
      fileId: "file-voice",
      status: "ready",
    },
    {
      id: "sfx",
      type: "audio",
      role: "soundEffect",
      label: "门铃",
      fileId: "file-sfx",
      status: "ready",
    },
  ];
  audioStory.chapters![0].fragments = [
    {
      id: "main",
      title: "main",
      blocks: [
        { id: "scene", type: "scene", sceneId: "lab" },
        {
          id: "play-bgm",
          type: "audio",
          action: "play",
          channel: "bgm",
          assetId: "bgm",
          volume: 70,
          loop: true,
          fadeMs: 0,
        },
        {
          id: "play-ambient",
          type: "audio",
          action: "play",
          channel: "ambient",
          assetId: "ambient",
          volume: 55,
          loop: true,
          fadeMs: 0,
        },
        {
          id: "dialogue",
          type: "dialogue",
          characterId: "hero",
          text: "开始调查。",
          voiceAssetId: "voice",
          voiceVolume: 80,
        },
        {
          id: "play-sfx",
          type: "audio",
          action: "play",
          channel: "sfx",
          assetId: "sfx",
          volume: 100,
          loop: false,
          fadeMs: 0,
        },
        { id: "narration", type: "narration", text: "门铃响了。" },
        {
          id: "stop-bgm",
          type: "audio",
          action: "stop",
          channel: "bgm",
          assetId: null,
          volume: 70,
          loop: true,
          fadeMs: 0,
        },
        {
          id: "end",
          type: "endChapter",
          endingId: "audio-ending",
          label: "声音结局",
        },
      ],
    },
  ];

  render(<StoryPlayer document={audioStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  await waitFor(() => expect(MockAudio.instances).toHaveLength(3));
  expect(MockAudio.instances[0].loop).toBe(true);
  expect(MockAudio.instances[1].loop).toBe(true);
  expect(MockAudio.instances[2].volume).toBe(0.8);

  await user.click(screen.getByText("开始调查。").closest("button")!);
  await waitFor(() => expect(MockAudio.instances).toHaveLength(4));
  await waitFor(() => expect(MockAudio.instances[2].pause).toHaveBeenCalled());
  expect(screen.getByText("门铃响了。")).toBeInTheDocument();

  await user.click(screen.getByText("门铃响了。").closest("button")!);
  expect(screen.getByText("声音结局")).toBeInTheDocument();
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled());
  expect(
    MockAudio.instances.map((audio) => audio.pause.mock.calls.length),
  ).toEqual([1, 1, 1, 1]);
});

test("synchronizes formal BGM with timeline playback, pause, and seek", async () => {
  const user = userEvent.setup();
  const timelineStory = structuredClone(story);
  timelineStory.characters = [
    { id: "hero", name: "调查员", description: "" },
    { id: "partner", name: "助手", description: "" },
  ];
  timelineStory.assets = [
    {
      id: "timeline-bgm",
      type: "audio",
      role: "backgroundMusic",
      label: "完整广播剧",
      fileId: "file-timeline",
      status: "ready",
    },
  ];
  timelineStory.chapters![0].fragments = [
    {
      id: "main",
      title: "完整时间轴",
      timeline: { durationMs: 10_000 },
      blocks: [
        { id: "scene", type: "scene", sceneId: "lab" },
        {
          id: "play-timeline-bgm",
          type: "audio",
          atMs: 0,
          action: "play",
          channel: "bgm",
          assetId: "timeline-bgm",
          volume: 100,
          loop: false,
          fadeMs: 0,
        },
        {
          id: "timeline-show-hero",
          type: "showCharacter",
          characterId: "hero",
          expressionId: null,
          transform: {
            x: 30,
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
          id: "line-one",
          type: "dialogue",
          characterId: "hero",
          text: "第一句。",
          startMs: 1_000,
          endMs: 4_000,
        },
        {
          id: "narration",
          type: "narration",
          text: "短暂的停顿。",
          startMs: 4_000,
          endMs: 5_500,
        },
        {
          id: "line-two",
          type: "dialogue",
          characterId: "partner",
          text: "第二句。",
          startMs: 6_000,
          endMs: 10_000,
        },
        {
          id: "end",
          type: "endChapter",
          endingId: "timeline-ending",
          label: "时间轴结局",
        },
      ],
    },
  ];

  render(<StoryPlayer document={timelineStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  await waitFor(() => expect(MockAudio.instances).toHaveLength(1));
  const bgm = MockAudio.instances[0]!;
  expect(bgm.volume).toBe(1);
  expect(bgm.loop).toBe(false);
  await user.click(screen.getByRole("button", { name: "点击继续" }));
  expect(screen.getByText("第一句。")).toBeInTheDocument();
  expect(
    document.querySelector('[data-character-id="hero"]'),
  ).toBeInTheDocument();
  expect(
    Number((screen.getByLabelText("剧情时间轴进度") as HTMLInputElement).value),
  ).toBeGreaterThanOrEqual(1000);
  expect(
    document
      .querySelector(".galgame-stage")
      ?.contains(screen.getByLabelText("试玩控制")),
  ).toBe(false);

  fireEvent.change(screen.getByLabelText("剧情时间轴进度"), {
    target: { value: "1200" },
  });
  expect(screen.getByText("第一句。")).toBeInTheDocument();
  expect(bgm.currentTime).toBeCloseTo(1.2, 3);

  fireEvent.change(screen.getByLabelText("剧情时间轴进度"), {
    target: { value: "6400" },
  });
  await waitFor(() => expect(screen.getByText("第二句。")).toBeInTheDocument());
  expect(screen.getByText("助手")).toBeInTheDocument();
  expect(bgm.currentTime).toBeCloseTo(6.4, 3);

  bgm.duration = 8;
  fireEvent.change(screen.getByLabelText("剧情时间轴进度"), {
    target: { value: "9000" },
  });
  expect(bgm.currentTime).toBe(8);
  expect(bgm.paused).toBe(true);

  fireEvent.change(screen.getByLabelText("剧情时间轴进度"), {
    target: { value: "5700" },
  });
  expect(screen.queryByText("短暂的停顿。")).not.toBeInTheDocument();
  expect(screen.queryByText("第二句。")).not.toBeInTheDocument();
  expect(
    document.querySelector('[data-character-id="hero"]'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("试玩控制")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "上一步" }));
  expect(screen.getByText("第一句。")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByText("短暂的停顿。")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByText("第二句。")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "暂停时间轴" }));
  expect(bgm.pause).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "播放时间轴" }));
  expect(bgm.play).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "自动" })).toHaveClass("active");

  fireEvent.change(screen.getByLabelText("剧情时间轴进度"), {
    target: { value: "1000" },
  });
  expect(screen.getByText("第一句。")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("剧情时间轴进度"), {
    target: { value: "10000" },
  });
  expect(await screen.findByText("时间轴结局")).toBeInTheDocument();
  expect(screen.getByText("时间轴结局")).toBeInTheDocument();
  expect(screen.queryByText("第一句。")).not.toBeInTheDocument();
  expect(MockAudio.instances).toHaveLength(1);
});

test("offers a user gesture retry when browser autoplay is blocked", async () => {
  const user = userEvent.setup();
  const blockedStory = structuredClone(story);
  blockedStory.assets = [
    {
      id: "bgm",
      type: "audio",
      role: "backgroundMusic",
      label: "主题曲",
      fileId: "file-bgm",
      status: "ready",
    },
  ];
  blockedStory.chapters![0].fragments![0].blocks!.splice(1, 0, {
    id: "play-bgm",
    type: "audio",
    action: "play",
    channel: "bgm",
    assetId: "bgm",
    volume: 70,
    loop: true,
    fadeMs: 0,
  });
  MockAudio.rejectNextPlay = true;
  render(<StoryPlayer document={blockedStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  const enable = await screen.findByRole("button", { name: "点击启用声音" });
  await user.click(enable);
  await waitFor(() =>
    expect(MockAudio.instances[0].play).toHaveBeenCalledTimes(2),
  );
});

test("keeps at most eight overlapping sound effects", async () => {
  const user = userEvent.setup();
  const sfxStory = structuredClone(story);
  sfxStory.assets = [
    {
      id: "sfx",
      type: "audio",
      role: "soundEffect",
      label: "滴答",
      fileId: "file-sfx",
      status: "ready",
    },
  ];
  sfxStory.chapters![0].fragments = [
    {
      id: "main",
      title: "main",
      blocks: [
        ...Array.from({ length: 9 }, (_, index) => ({
          id: `sfx-${index}`,
          type: "audio" as const,
          action: "play" as const,
          channel: "sfx" as const,
          assetId: "sfx",
          volume: 100,
          loop: false,
          fadeMs: 0,
        })),
        { id: "narration", type: "narration", text: "九次滴答。" },
        {
          id: "end",
          type: "endChapter",
          endingId: "sfx-ending",
          label: "音效结局",
        },
      ],
    },
  ];
  render(<StoryPlayer document={sfxStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  await waitFor(() => expect(MockAudio.instances).toHaveLength(9));
  expect(MockAudio.instances[0].pause).toHaveBeenCalled();
  expect(screen.getByText("九次滴答。")).toBeInTheDocument();
});

test("applies stage aspect presets and rejects invalid custom ratios", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <StoryPlayer
      document={story}
      mode="edit"
      editFragment={story.chapters![0].fragments![0]}
    />,
  );

  expect(screen.getByText("舞台编辑")).toBeInTheDocument();
  expect(screen.queryByLabelText("试玩控制")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("推进模式")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "试玩混音" }),
  ).not.toBeInTheDocument();

  expect(container.querySelector(".galgame-stage")).toHaveAttribute(
    "data-aspect",
    "auto",
  );
  await user.click(screen.getByRole("button", { name: "舞台比例" }));
  await user.click(screen.getByRole("option", { name: "16:9" }));
  expect(container.querySelector(".galgame-stage")).toHaveAttribute(
    "data-aspect",
    "16:9",
  );
  expect(container.querySelector(".galgame-stage-host")).toHaveAttribute(
    "data-aspect-mode",
    "16:9",
  );

  await user.click(screen.getByRole("option", { name: "自定义" }));
  const width = screen.getByLabelText("自定义比例宽度");
  const height = screen.getByLabelText("自定义比例高度");
  fireEvent.change(width, { target: { value: "21" } });
  fireEvent.change(height, { target: { value: "9" } });
  expect(container.querySelector(".galgame-stage")).toHaveAttribute(
    "data-aspect",
    "21:9",
  );

  fireEvent.change(width, { target: { value: "0" } });
  expect(container.querySelector(".galgame-stage")).toHaveAttribute(
    "data-aspect",
    "21:9",
  );
  fireEvent.blur(width);
  expect(width).toHaveValue(21);
});

test("hides the stage host when collapsed", async () => {
  const user = userEvent.setup();
  const onCollapsedChange = vi.fn();
  const { container, rerender } = render(
    <StoryPlayer
      document={story}
      mode="edit"
      editFragment={story.chapters![0].fragments![0]}
      collapsed={false}
      onCollapsedChange={onCollapsedChange}
    />,
  );

  expect(container.querySelector(".galgame-stage-host")).not.toHaveAttribute(
    "hidden",
  );
  await user.click(screen.getByRole("button", { name: "折叠舞台预览" }));
  expect(onCollapsedChange).toHaveBeenCalledWith(true);

  rerender(
    <StoryPlayer
      document={story}
      mode="edit"
      editFragment={story.chapters![0].fragments![0]}
      collapsed
      onCollapsedChange={onCollapsedChange}
    />,
  );
  expect(container.querySelector(".galgame-stage-host")).toHaveAttribute(
    "hidden",
  );
});

test("presents official alert and confirm system messages as blocking modals", async () => {
  const user = userEvent.setup();
  const document = structuredClone(story);
  document.chapters![0].fragments![0].blocks = [
    {
      id: "alert",
      type: "systemMessage",
      mode: "alert",
      tone: "info",
      title: "调查提示",
      text: "请保存证据。",
      acceptLabel: "知道了",
    },
    {
      id: "confirm",
      type: "systemMessage",
      mode: "confirm",
      tone: "warning",
      title: "离开现场",
      text: "确定离开吗？",
      acceptLabel: "离开",
      cancelLabel: "留下",
    },
    { id: "after-message", type: "narration", text: "消息处理完成。" },
  ];

  render(<StoryPlayer document={document} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  const alert = screen.getByRole("dialog", { name: "调查提示" });
  expect(alert).toHaveTextContent("请保存证据。");
  await user.click(screen.getByRole("button", { name: "知道了" }));
  const confirm = screen.getByRole("dialog", { name: "离开现场" });
  expect(confirm).toHaveTextContent("确定离开吗？");
  fireEvent.keyDown(confirm, { key: "Escape" });
  expect(screen.getByText("消息处理完成。")).toBeInTheDocument();
});

test("keeps player waits blocking until a supported continue gesture", async () => {
  const user = userEvent.setup();
  const document = structuredClone(story);
  document.chapters![0].fragments![0].blocks = [
    { id: "player-wait", type: "wait", mode: "player", durationMs: null },
    { id: "after-wait", type: "narration", text: "继续成功。" },
  ];

  render(<StoryPlayer document={document} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(screen.getByText("空格 / Enter / 向下滚轮")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Enter" });
  expect(screen.getByText("继续成功。")).toBeInTheDocument();
});

test("renders curtain geometry from the shared stage state", async () => {
  const user = userEvent.setup();
  const document = structuredClone(story);
  document.chapters![0].fragments![0].blocks = [
    {
      id: "frame-curtain",
      type: "curtain",
      mode: "frame",
      action: "show",
      color: "#123456",
      opacity: 0.8,
      durationMs: 600,
      waitForCompletion: false,
    },
    { id: "behind-curtain", type: "narration", text: "幕布之后。" },
  ];

  render(<StoryPlayer document={document} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  const curtain = screen.getByLabelText("四周黑边幕布合上");
  expect(curtain).toHaveClass("is-frame", "is-show");
  expect(curtain.querySelector(".is-top")).toBeInTheDocument();
  expect(curtain.querySelector(".is-right")).toBeInTheDocument();
  expect(curtain).toHaveStyle({ "--curtain-color": "#123456" });
});
