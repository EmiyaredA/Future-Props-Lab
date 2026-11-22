import type { GenerationDrawerProps } from "./generationDrawerTypes";

/** Match exact asset identities to explicit project card links, never content. */
export function referenceCardIdsForInputs({
  designReferences = [],
  referenceInputs = [],
  referenceContext,
}: Pick<GenerationDrawerProps, "referenceInputs" | "referenceContext"> & {
  designReferences?: { asset_id: string; card_id: string }[];
}) {
  const links: Record<string, string[]> = {};
  const add = (assetId: string, cardId: string) => {
    const ids = (links[assetId] ??= []);
    if (!ids.includes(cardId)) ids.push(cardId);
  };
  for (const reference of designReferences)
    add(reference.asset_id, reference.card_id);
  // A manually selected asset can belong to a card node without an incoming edge.
  for (const node of referenceContext?.nodes ?? []) {
    if (node.kind === "image" && node.asset_id && node.design_card_id)
      add(node.asset_id, node.design_card_id);
  }
  for (const input of referenceInputs) {
    if (!input.assetId || input.loading || input.error) continue;
    const source = referenceContext?.nodes.find(
      (node) => node.id === input.edge.source_node_id,
    );
    if (source?.kind === "image" && source.design_card_id)
      add(input.assetId, source.design_card_id);
  }
  return links;
}
