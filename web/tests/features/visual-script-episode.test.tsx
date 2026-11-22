import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ScriptEpisodeOverview } from "@features/visual-workshop/creative/ScriptEpisodeOverview";
import { emptyShot } from "@features/visual-workshop/storyboard/shotPlans";
import type { VisualCanvasNode } from "@features/visual-workshop/api";

vi.mock("@features/visual-workshop/board/OutputPreview", () => ({
  OutputPreview: ({ kind, assetId }: { kind: string; assetId: string }) => (
    <span>
      {kind}:{assetId}
    </span>
  ),
}));

test("episode blocks use linked current outputs, fall back to images and exclude other episodes", () => {
  const nodes: VisualCanvasNode[] = [
    {
      id: "image",
      kind: "image",
      title: "画面",
      position: { x: 0, y: 0 },
      asset_id: "image-asset",
    },
    {
      id: "video",
      kind: "video",
      title: "视频",
      position: { x: 0, y: 0 },
      asset_id: "video-asset",
    },
  ];
  const source = (scene_id: string) => ({ scene_id, revision: 1, excerpt: "" });
  render(
    <ScriptEpisodeOverview
      episode={{
        id: "episode",
        title: "第一集",
        scenes: [
          { id: "s1", title: "欢迎", heading: "草原", text: "第一镜" },
          { id: "s2", title: "木屋", heading: "木屋", text: "第二镜" },
        ],
      }}
      nodes={nodes}
      shots={[
        {
          ...emptyShot("第一镜制作"),
          source: source("s1"),
          video_node_id: "video",
          image_node_id: "image",
        },
        {
          ...emptyShot("第二镜制作"),
          source: source("s2"),
          video_node_id: "deleted",
          image_node_id: "image",
        },
        {
          ...emptyShot("另一集制作"),
          source: source("other"),
          video_node_id: "video",
        },
      ]}
      busy={false}
      readOnly={false}
      onOrder={vi.fn()}
      onEdit={vi.fn()}
      onProduction={vi.fn()}
    />,
  );
  expect(screen.getByText("video:video-asset")).toBeVisible();
  expect(screen.getByText("image:image-asset")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "查看制作 第二镜制作" }),
  ).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "查看制作 另一集制作" }),
  ).toBeNull();
});
