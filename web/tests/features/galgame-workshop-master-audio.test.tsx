import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { StoryPlayer } from "@features/galgame-workshop/editor/StoryPlayer";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";

vi.mock("@platform/api/client", () => ({
  fetchApiBlob: vi.fn().mockResolvedValue(new Blob(["audio"])),
}));

class MockAudio {
  static instances: MockAudio[] = [];
  volume = 1;
  loop = false;
  paused = true;
  currentTime = 0;
  duration = 10;
  readyState = 1;
  listeners = new Map<string, Set<EventListener>>();
  play = vi.fn(async () => {
    this.paused = false;
    this.dispatch("play");
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatch("pause");
  });
  load = vi.fn();
  removeAttribute = vi.fn();

  constructor(public src = "") {
    MockAudio.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback =
      typeof listener === "function"
        ? listener
        : (event: Event) => listener.handleEvent(event);
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) {
    if (typeof listener === "function")
      this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? [])
      listener(new Event(type));
  }
}

const masterStory: GalgameStoryProject = {
  schemaVersion: "1.4",
  synopsis: "主音轨同步",
  entryChapterId: "chapter-1",
  characters: [{ id: "hero", name: "调查员", description: "" }],
  scenes: [{ id: "lab", name: "研究所", description: "" }],
  variables: [],
  assets: [
    {
      id: "master",
      type: "audio",
      role: "timelineMaster",
      label: "完整广播剧",
      fileId: "file-master",
      status: "ready",
    },
    ...["one", "two"].map(
      (suffix) =>
        ({
          id: `line-${suffix}-voice`,
          type: "audio",
          role: "voiceLine",
          label: `${suffix} 切片`,
          fileId: `file-line-${suffix}`,
          status: "ready",
        }) as const,
    ),
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
          title: "主音轨时间轴",
          timeline: {
            durationMs: 10_000,
            masterAudio: { assetId: "master", volume: 100 },
          },
          blocks: [
            { id: "scene", type: "scene", sceneId: "lab" },
            {
              id: "line-one",
              type: "dialogue",
              characterId: "hero",
              text: "第一句。",
              voiceAssetId: "line-one-voice",
              startMs: 1_000,
              endMs: 4_000,
            },
            {
              id: "line-two",
              type: "dialogue",
              characterId: "hero",
              text: "第二句。",
              voiceAssetId: "line-two-voice",
              startMs: 6_000,
              endMs: 9_000,
            },
            {
              id: "end",
              type: "endChapter",
              endingId: "master-ending",
              label: "主音轨结局",
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  MockAudio.instances = [];
  vi.stubGlobal("Audio", MockAudio);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:master"),
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

test("uses one timeline master as the clock and never replays bound line audio", async () => {
  const user = userEvent.setup();
  render(<StoryPlayer document={masterStory} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  await waitFor(() => expect(MockAudio.instances).toHaveLength(1));
  const master = MockAudio.instances[0]!;
  expect(master.play).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "自动" }));
  await waitFor(() => expect(master.play).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText("剧情时间轴进度"), {
    target: { value: "1200" },
  });
  await waitFor(() => expect(screen.getByText("第一句。")).toBeInTheDocument());
  expect(master.currentTime).toBeCloseTo(1.2, 3);
  expect(MockAudio.instances).toHaveLength(1);

  fireEvent.change(screen.getByLabelText("剧情时间轴进度"), {
    target: { value: "6400" },
  });
  await waitFor(() => expect(screen.getByText("第二句。")).toBeInTheDocument());
  expect(master.currentTime).toBeCloseTo(6.4, 3);
  expect(MockAudio.instances).toHaveLength(1);

  await user.click(screen.getByRole("button", { name: "暂停时间轴" }));
  expect(master.pause).toHaveBeenCalled();
});

test("reveals long timed dialogue quickly during automatic master playback", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const automaticStory = structuredClone(masterStory);
  const firstDialogue = automaticStory.chapters![0].fragments![0].blocks!.find(
    (block) => block.id === "line-one",
  );
  if (!firstDialogue || firstDialogue.type !== "dialogue")
    throw new Error("test dialogue missing");
  firstDialogue.text =
    "这是一句用于验证主音轨自动播放时可以快速完整显示的较长中文对白。";

  render(<StoryPlayer document={automaticStory} />);
  fireEvent.click(screen.getByRole("button", { name: "开始试玩" }));
  await waitFor(() => expect(MockAudio.instances).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "自动" }));
  fireEvent.change(screen.getByLabelText("剧情时间轴进度"), {
    target: { value: "1200" },
  });

  await waitFor(
    () => expect(screen.getByText(firstDialogue.text)).toBeInTheDocument(),
    {
      timeout: 600,
    },
  );
});
