import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, vi } from "vitest";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { StoryPlayer } from "@features/galgame-workshop/editor/StoryPlayer";

vi.mock("@platform/api/client", () => ({
  fetchApiBlob: vi.fn().mockResolvedValue(new Blob(["audio"])),
}));

vi.mock("@features/galgame-workshop/editor/StoryAssetImage", () => ({
  StoryAssetImage: ({ fallback }: { fallback: ReactNode }) => fallback,
}));

beforeEach(() => {
  localStorage.clear();
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

const stageTransform = (x: number, layer: number) => ({
  x,
  y: 100,
  anchor: "bottomCenter" as const,
  scale: 1,
  brightness: 1,
  opacity: 1,
  flipX: false,
  layer,
});

const story: GalgameStoryProject = {
  schemaVersion: "1.0",
  synopsis: "多说话者层级回归",
  characters: [
    { id: "hero", name: "调查员", description: "" },
    { id: "partner", name: "助手", description: "" },
    { id: "observer", name: "观察员", description: "" },
  ],
  scenes: [{ id: "lab", name: "夜间研究所", description: "" }],
  variables: [],
  assets: [],
  presentation: {
    stage: {
      speakerFocusEnabled: true,
      inactiveBrightness: 0.6,
      focusTransitionMs: 0,
      lipSyncEnabled: false,
    },
  },
  chapters: [
    {
      id: "chapter",
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
              id: "show-hero",
              type: "showCharacter",
              characterId: "hero",
              expressionId: null,
              transform: stageTransform(30, 20),
              transition: { durationMs: 0, fade: false },
            },
            {
              id: "show-partner",
              type: "showCharacter",
              characterId: "partner",
              expressionId: null,
              transform: stageTransform(70, 20),
              transition: { durationMs: 0, fade: false },
            },
            {
              id: "show-observer",
              type: "showCharacter",
              characterId: "observer",
              expressionId: null,
              transform: stageTransform(50, 99),
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
          ],
        },
      ],
    },
  ],
};

test("keeps every active speaker above every non-speaker", async () => {
  const user = userEvent.setup();
  render(<StoryPlayer document={story} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));

  expect(screen.getByText("调查员、助手")).toBeInTheDocument();
  expect(screen.getByText("就是现在！")).toBeInTheDocument();
  const hero = document.querySelector<HTMLElement>(
    '[data-character-id="hero"]',
  );
  const partner = document.querySelector<HTMLElement>(
    '[data-character-id="partner"]',
  );
  const observer = document.querySelector<HTMLElement>(
    '[data-character-id="observer"]',
  );
  expect(hero?.style.filter).toContain("brightness(1)");
  expect(partner?.style.filter).toContain("brightness(1)");
  expect(observer?.style.filter).toContain("brightness(0.6)");
  expect(Number(hero?.style.zIndex)).toBeGreaterThan(
    Number(observer?.style.zIndex),
  );
  expect(Number(partner?.style.zIndex)).toBeGreaterThan(
    Number(observer?.style.zIndex),
  );
  expect(Number(partner?.style.zIndex)).toBeGreaterThan(
    Number(hero?.style.zIndex),
  );
});
