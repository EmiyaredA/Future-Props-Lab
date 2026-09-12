import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { getFiles, getFolders } from "@features/files/api";
import {
  createGenerationTask,
  getGenerationOptions,
  type VisualCanvasVideoGenerationDraft,
} from "@features/visual-workshop/api";
import { GenerationDrawer } from "@features/visual-workshop/generation/GenerationDrawer";
import {
  orderedReferenceIds,
  reorderPictureReferences,
} from "@features/visual-workshop/generation/referenceOrder";

vi.mock("@features/files/api", async (original) => ({
  ...(await original<typeof import("@features/files/api")>()),
  getFiles: vi.fn(),
  getFolders: vi.fn(),
}));
vi.mock("@features/visual-workshop/api", async (original) => ({
  ...(await original<typeof import("@features/visual-workshop/api")>()),
  getGenerationOptions: vi.fn(),
  createGenerationTask: vi.fn(),
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({ url: undefined }),
}));

const files = ["reaction", "roof", "okabe"].map((id) => ({
  id,
  project_id: "project",
  folder_id: null,
  reference_id: null,
  original_filename: `${id}.png`,
  display_name: `${id}.png`,
  media_kind: "image" as const,
  mime_type: "image/png",
  byte_size: 100,
  source: "project" as const,
  is_reference: false,
  revision: 0,
  created_at: "2026-09-12T00:00:00Z",
  updated_at: "2026-09-12T00:00:00Z",
}));
const initial: VisualCanvasVideoGenerationDraft = {
  model_id: "model",
  mode: "reference",
  duration: 15,
  resolution: "720p",
  ratio: "16:9",
  generate_audio: true,
  watermark: false,
  first_frame_asset_id: null,
  last_frame_asset_id: null,
  prompt:
    "<Picture 1> reaction; <Picture 2> roof; <Picture 3> Okabe; <Picture 2> again. <Audio 1> voice.",
  reference_asset_ids: ["reaction", "roof", "okabe"],
  audio_asset_ids: [],
  video_asset_ids: [],
};
beforeEach(() => {
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
  vi.mocked(getFiles).mockImplementation(async ({ mediaKind }) => ({
    items: mediaKind === "image" ? files : [],
  }));
  vi.mocked(getGenerationOptions).mockResolvedValue({
    models: [
      {
        id: "model",
        provider_id: "provider",
        provider_name: "test",
        kind: "video",
        slug: "doubao-seedance-2-0-260128",
        label: "Test video",
        description: "",
        sizes: [],
      },
    ],
  });
});

function mount() {
  const saved = vi.fn();
  function Harness() {
    const [draft, setDraft] = useState(initial);
    return (
      <GenerationDrawer
        compact
        lockedKind="video"
        projectId="project"
        canvasNodeId="video"
        draft={draft}
        linkedAssetIds={{
          image: ["reaction", "okabe", "roof"],
          video: [],
          audio: [],
        }}
        onDraftChange={(next, immediate) => {
          saved(next, immediate);
          setDraft(next as VisualCanvasVideoGenerationDraft);
        }}
        onBeforeSubmit={async () => 3}
        onClose={() => {}}
      />
    );
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  const order = () =>
    [...view.container.querySelectorAll("[data-reference-position]")].map(
      (card) =>
        within(card as HTMLElement)
          .getByRole("button", { pressed: true })
          .getAttribute("aria-label"),
    );
  return { ...view, saved, order };
}

test("keeps saved order over edge order and renumbers swaps without touching audio or unknown tokens", () => {
  expect(
    orderedReferenceIds(["roof", "reaction"], ["reaction", "okabe", "roof"]),
  ).toEqual(["roof", "reaction", "okabe"]);
  expect(
    reorderPictureReferences(
      "<Picture 1> <Picture 2> <Picture 1> <Picture 9> <Audio 1> [Shot 2]",
      ["a", "b"],
      ["b", "a"],
    ),
  ).toBe("<Picture 2> <Picture 1> <Picture 2> <Picture 9> <Audio 1> [Shot 2]");
});

test("moves connected images with keyboard, saves prompt and order together, and submits the same order", async () => {
  const user = userEvent.setup();
  const { order, saved } = mount();
  await screen.findByRole("button", { name: "roof.png" });
  expect(order()).toEqual(["reaction.png", "roof.png", "okabe.png"]);
  expect(
    screen.queryByRole("button", { name: "移除参考文件 roof.png" }),
  ).not.toBeInTheDocument();
  const back = screen.getByRole("button", { name: "后移 roof.png" });
  back.focus();
  await user.keyboard("{Enter}");
  expect(order()).toEqual(["reaction.png", "okabe.png", "roof.png"]);
  expect(saved).toHaveBeenLastCalledWith(
    expect.objectContaining({
      reference_asset_ids: ["reaction", "okabe", "roof"],
      prompt:
        "<Picture 1> reaction; <Picture 3> roof; <Picture 2> Okabe; <Picture 3> again. <Audio 1> voice.",
    }),
    true,
  );
  expect(screen.getByRole("button", { name: "后移 roof.png" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "生成视频" }));
  await waitFor(() =>
    expect(createGenerationTask).toHaveBeenCalledWith(
      "project",
      expect.objectContaining({
        reference_asset_ids: ["reaction", "okabe", "roof"],
        prompt:
          "<Picture 1> reaction; <Picture 3> roof; <Picture 2> Okabe; <Picture 3> again. <Audio 1> voice.",
        expected_canvas_revision: 3,
      }),
    ),
  );
});

test("drags a connected image to the first position without changing links or opening preview", async () => {
  const { order, saved } = mount();
  const roof = (
    await screen.findByRole("button", { name: "roof.png" })
  ).closest(".generation-media-card")!;
  const reaction = screen
    .getByRole("button", { name: "reaction.png" })
    .closest(".generation-media-card")!;
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(roof, { dataTransfer });
  fireEvent.dragOver(reaction, { dataTransfer });
  fireEvent.drop(reaction, { dataTransfer });
  expect(order()).toEqual(["roof.png", "reaction.png", "okabe.png"]);
  expect(saved).toHaveBeenLastCalledWith(
    expect.objectContaining({
      reference_asset_ids: ["roof", "reaction", "okabe"],
      prompt:
        "<Picture 2> reaction; <Picture 1> roof; <Picture 3> Okabe; <Picture 1> again. <Audio 1> voice.",
    }),
    true,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
