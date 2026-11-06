import { expect, test } from "vitest";
import { playerFrameCursor } from "@features/galgame-workshop/editor/storyPlayerModel";

test("uses the rendered timeline frame instead of a lagging runtime cursor", () => {
  expect(
    playerFrameCursor(
      {
        mode: "content",
        fragmentId: "timeline-fragment",
        blockIndex: 12,
        block: {
          id: "kurisu-line",
          type: "dialogue",
          characterId: "kurisu",
          text: "是是，凤凰院凶真，凤凰院凶真。",
        },
        stage: { actors: {} },
      },
      { fragmentId: "stale-fragment", blockIndex: 11 },
    ),
  ).toEqual({ fragmentId: "timeline-fragment", blockIndex: 12 });
});
