import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act, type ReactNode } from "react";
import { StoryPlayer } from "@features/galgame-workshop/editor/StoryPlayer";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
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
          className === "galgame-player-background"
            ? "background-file"
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
  expect(screen.getByText("开始调查。")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "设备" }),
  ).not.toBeInTheDocument();
  await user.click(dialogue);
  expect(screen.getByRole("button", { name: "设备" })).toBeInTheDocument();
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

test("stops safely when a fragment has no terminator", async () => {
  const user = userEvent.setup();
  const openStory = structuredClone(story);
  openStory.chapters![0].fragments![0].blocks = [
    { id: "only-text", type: "narration", text: "尚未完成" },
  ];
  render(<StoryPlayer document={openStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  await user.click(screen.getByText("尚未完成").closest("button")!);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "线路在没有结局的位置中断",
  );
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
  ];

  const dialogue = portraitStory.chapters![0].fragments![0].blocks![1];
  if (dialogue.type !== "dialogue") throw new Error("expected dialogue");
  const first = render(<StoryPlayer document={portraitStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(screen.getByTestId("portrait-file")).toHaveTextContent("file-calm");
  first.unmount();

  dialogue.expressionId = "smile";
  render(<StoryPlayer document={portraitStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(screen.getByTestId("portrait-file")).toHaveTextContent("file-smile");
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
          transform: {
            x: 25,
            y: 100,
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
          transform: {
            x: 75,
            y: 100,
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

test("uses the scene default background unless the Scene Block selects a state", async () => {
  const user = userEvent.setup();
  const backgroundStory = structuredClone(story);
  backgroundStory.scenes = [
    {
      id: "lab",
      name: "夜间研究所",
      description: "",
      backgrounds: [
        { id: "night", label: "夜间", assetId: "asset-night" },
        { id: "rain", label: "雨夜", assetId: "asset-rain" },
      ],
      defaultBackgroundId: "night",
    },
  ];
  backgroundStory.assets = [
    {
      id: "asset-night",
      type: "image",
      role: "sceneBackground",
      fileId: "file-night",
      status: "ready",
    },
    {
      id: "asset-rain",
      type: "image",
      role: "sceneBackground",
      fileId: "file-rain",
      status: "ready",
    },
  ];

  const first = render(<StoryPlayer document={backgroundStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(screen.getByTestId("background-file")).toHaveTextContent("file-night");
  first.unmount();

  const sceneBlock = backgroundStory.chapters![0].fragments![0].blocks![0];
  if (sceneBlock.type !== "scene") throw new Error("expected scene block");
  sceneBlock.backgroundId = "rain";
  render(<StoryPlayer document={backgroundStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(screen.getByTestId("background-file")).toHaveTextContent("file-rain");
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
    zIndex: "6",
  });
  expect(dialogue).toHaveStyle({
    backgroundColor: "rgb(23 32 51 / 0.7)",
    borderRadius: "18px",
    color: "#F8FAFC",
    fontSize: "1.1em",
  });
  expect(screen.getByText("调查员")).toHaveStyle({ color: "#FB7185" });
  await user.click(dialogue);
  expect(
    screen.getByTestId("ui-component-file-choice-decoration"),
  ).toHaveTextContent("file-choice-decoration");
  expect(
    screen.queryByTestId("ui-component-file-status-panel"),
  ).not.toBeInTheDocument();
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

test("keeps the reference track silent while timeline dialogue and controls stay synchronized", async () => {
  const user = userEvent.setup();
  const timelineStory = structuredClone(story);
  timelineStory.characters = [
    { id: "hero", name: "调查员", description: "" },
    { id: "partner", name: "助手", description: "" },
  ];
  timelineStory.assets = [
    {
      id: "timeline",
      type: "audio",
      role: "timelineTrack",
      label: "完整广播剧",
      fileId: "file-timeline",
      status: "ready",
    },
  ];
  timelineStory.chapters![0].fragments = [
    {
      id: "main",
      title: "完整时间轴",
      timeline: { assetId: "timeline", durationMs: 10_000 },
      blocks: [
        { id: "scene", type: "scene", sceneId: "lab" },
        {
          id: "timeline-show-hero",
          type: "showCharacter",
          characterId: "hero",
          expressionId: null,
          transform: {
            x: 30,
            y: 100,
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
  expect(MockAudio.instances).toHaveLength(0);
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
      ?.contains(screen.getByLabelText("剧情时间轴控制")),
  ).toBe(false);

  fireEvent.change(screen.getByLabelText("剧情时间轴进度"), {
    target: { value: "1200" },
  });
  expect(screen.getByText("第一句。")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("剧情时间轴进度"), {
    target: { value: "6400" },
  });
  await waitFor(() => expect(screen.getByText("第二句。")).toBeInTheDocument());
  expect(screen.getByText("助手")).toBeInTheDocument();
  expect(MockAudio.instances).toHaveLength(0);

  fireEvent.change(screen.getByLabelText("剧情时间轴进度"), {
    target: { value: "5700" },
  });
  expect(screen.queryByText("短暂的停顿。")).not.toBeInTheDocument();
  expect(screen.queryByText("第二句。")).not.toBeInTheDocument();
  expect(
    document.querySelector('[data-character-id="hero"]'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("剧情时间轴控制")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "上一句" }));
  expect(screen.getByText("短暂的停顿。")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "下一句" }));
  expect(screen.getByText("第二句。")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "暂停时间轴" }));
  await user.click(screen.getByRole("button", { name: "播放时间轴" }));
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
  expect(MockAudio.instances).toHaveLength(0);
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
