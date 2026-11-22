import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { cardsKey, type Card } from "@features/visual-workshop/creative/api";
import { ReferenceKindTag } from "@features/visual-workshop/generation/ReferenceKindTag";
import { referenceCardIdsForInputs } from "@features/visual-workshop/generation/referenceCardLinks";
import type { GenerationDrawerProps } from "@features/visual-workshop/generation/generationDrawerTypes";

const cards: Card[] = (["character", "scene", "prop"] as const).map((kind) => ({
  id: kind,
  kind,
  title: "名字包含角色、场景、道具，不能用于判断类型",
  adopted_asset_id: `${kind}-asset`,
  archived: false,
  design: "",
  revision: 1,
}));

function setup(assetId: string, cardIds?: string[], available = cards) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(cardsKey, available);
  return render(
    <QueryClientProvider client={client}>
      <ReferenceKindTag assetId={assetId} cardIds={cardIds} />
    </QueryClientProvider>,
  );
}

test.each([
  ["character", "角色"],
  ["scene", "场景"],
  ["prop", "道具"],
])("shows %s only for its exact adopted asset ID", (kind, label) => {
  setup(`${kind}-asset`);
  expect(screen.getByText(label)).toHaveClass(`is-${kind}`);
});

test("persisted card identity follows an imported or historical image instead of another card's adopted image", () => {
  setup("scene-asset", ["character"]);
  expect(screen.getByText("角色")).toBeInTheDocument();
  expect(screen.queryByText("场景")).not.toBeInTheDocument();
});

test("unrelated filenames, IDs and descriptive card text never create a category", () => {
  const { container } = setup("角色-scene-prop.png");
  expect(container).toBeEmptyDOMElement();
});

test("a missing explicit card cannot fall back to the adopted image of another card", () => {
  const { container } = setup("scene-asset", ["deleted-card"]);
  expect(container).toBeEmptyDOMElement();
});

test.each([undefined, ["character", "scene"], ["character", "deleted-card"]])(
  "conflicting or unresolved associations show no arbitrary category (%j)",
  (ids) => {
    const { container } = setup(
      "shared-asset",
      ids,
      cards.map((card) => ({ ...card, adopted_asset_id: "shared-asset" })),
    );
    expect(container).toBeEmptyDOMElement();
  },
);

test("several explicit associations of the same kind keep one category", () => {
  setup(
    "imported",
    ["character", "variant"],
    [cards[0], { ...cards[0], id: "variant" }],
  );
  expect(screen.getAllByText("角色")).toHaveLength(1);
});

test("card links follow resolved edge assets and retain all explicit associations", () => {
  const context: NonNullable<GenerationDrawerProps["referenceContext"]> = {
    nodes: [
      {
        id: "source",
        kind: "image",
        title: "道具名不能决定归属",
        position: { x: 0, y: 0 },
        asset_id: "current-asset",
        design_card_id: "scene",
      },
    ],
    edges: [],
    removeEdge: () => {},
    replaceEdges: () => {},
  };
  const input = {
    key: "edge:source",
    title: "角色",
    kind: "image" as const,
    edge: { id: "edge", source_node_id: "source", target_node_id: "target" },
    assetId: "fixed-old-output",
    loading: false,
  };
  const links = referenceCardIdsForInputs({
    referenceContext: context,
    referenceInputs: [
      input,
      input,
      { ...input, assetId: "pending", loading: true },
      { ...input, assetId: "failed", error: "unavailable" },
    ],
    designReferences: [{ asset_id: "fixed-old-output", card_id: "character" }],
  });
  expect(links).toEqual({
    "current-asset": ["scene"],
    "fixed-old-output": ["character", "scene"],
  });
  expect(referenceCardIdsForInputs({})).toEqual({});
});

test("manually selected assets retain project node card associations without input edges", () => {
  const referenceContext: NonNullable<
    GenerationDrawerProps["referenceContext"]
  > = {
    nodes: [
      {
        id: "role",
        kind: "image",
        title: "无类型标题",
        position: { x: 0, y: 0 },
        asset_id: "manual-role",
        design_card_id: "character",
      },
      {
        id: "scene",
        kind: "image",
        title: "角色图片.png",
        position: { x: 0, y: 0 },
        asset_id: "manual-scene",
        design_card_id: "scene",
      },
      {
        id: "unknown",
        kind: "image",
        title: "道具",
        position: { x: 0, y: 0 },
        asset_id: "plain-file",
      },
      {
        id: "empty",
        kind: "image",
        title: "空卡",
        position: { x: 0, y: 0 },
        design_card_id: "prop",
      },
      {
        id: "shared",
        kind: "image",
        title: "重复归属",
        position: { x: 0, y: 0 },
        asset_id: "manual-role",
        design_card_id: "prop",
      },
    ],
    edges: [],
    removeEdge: () => {},
    replaceEdges: () => {},
  };
  expect(referenceCardIdsForInputs({ referenceContext })).toEqual({
    "manual-role": ["character", "prop"],
    "manual-scene": ["scene"],
  });
});
