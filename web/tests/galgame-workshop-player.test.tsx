import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { StoryPlayer } from "@features/galgame-workshop/editor/StoryPlayer";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { vi } from "vitest";

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
