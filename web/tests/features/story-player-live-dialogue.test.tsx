import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { StoryPlayer } from "@features/galgame-workshop/editor/StoryPlayer";

vi.mock("@platform/api/client", () => ({
  fetchApiBlob: vi.fn().mockResolvedValue(new Blob(["asset"])),
}));

vi.mock("@features/galgame-workshop/editor/StoryAssetImage", () => ({
  StoryAssetImage: ({
    fileId,
    fallback,
  }: {
    fileId?: string;
    fallback: ReactNode;
  }) => (fileId ? <span data-testid="portrait-file">{fileId}</span> : fallback),
}));

const story: GalgameStoryProject = {
  schemaVersion: "1.4",
  synopsis: "",
  assets: [
    {
      id: "calm-asset",
      type: "image",
      role: "characterPortrait",
      fileId: "calm-file",
      status: "ready",
    },
    {
      id: "smile-asset",
      type: "image",
      role: "characterPortrait",
      fileId: "smile-file",
      status: "ready",
    },
  ],
  characters: [
    {
      id: "hero",
      name: "主角",
      description: "",
      defaultExpressionId: "calm",
      expressions: [
        { id: "calm", label: "平静", assetId: "calm-asset" },
        { id: "smile", label: "微笑", assetId: "smile-asset" },
      ],
    },
  ],
  scenes: [],
  variables: [],
  chapters: [
    {
      id: "chapter",
      title: "章节",
      order: 1,
      entryFragmentId: "main",
      fragments: [
        {
          id: "main",
          title: "主线",
          blocks: [
            {
              id: "line",
              type: "dialogue",
              characterId: "hero",
              expressionId: "calm",
              text: "对白",
              portrait: {
                mode: "stage",
                visible: true,
                keepAfter: true,
                distance: "medium",
              },
            },
          ],
        },
      ],
    },
  ],
};

test("updates the visible dialogue expression without restarting playback", async () => {
  const user = userEvent.setup();
  const view = render(<StoryPlayer document={story} />);
  await user.click(screen.getByRole("button", { name: "开始试玩" }));
  expect(screen.getByTestId("portrait-file")).toHaveTextContent("calm-file");

  const updated = structuredClone(story);
  const line = updated.chapters?.[0]?.fragments?.[0]?.blocks?.[0];
  if (line?.type !== "dialogue") throw new Error("expected dialogue");
  line.expressionId = "smile";
  view.rerender(<StoryPlayer document={updated} />);

  await waitFor(() =>
    expect(screen.getByTestId("portrait-file")).toHaveTextContent("smile-file"),
  );
  expect(document.querySelector("[data-expression-id='smile']")).not.toBeNull();
});
