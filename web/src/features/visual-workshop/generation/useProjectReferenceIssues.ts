import { useQuery } from "@tanstack/react-query";
import {
  cardsKey,
  projectCardsKey,
  listCards,
  listProjectCards,
} from "../creative/api";
import type { CanvasReferenceContext } from "./generationDrawerTypes";

export function useProjectReferenceIssues(
  projectId: string,
  nodeId: string | undefined,
  designReferences: { card_id: string }[],
  context?: CanvasReferenceContext,
) {
  const referenced = new Set(designReferences.map((ref) => ref.card_id));
  const target = context?.nodes.find((node) => node.id === nodeId);
  if (target?.kind === "image" && target.design_card_id)
    referenced.add(target.design_card_id);
  for (const edge of context?.edges ?? []) {
    if (edge.target_node_id !== nodeId) continue;
    const source = context?.nodes.find(
      (node) => node.id === edge.source_node_id,
    );
    if (source?.kind === "image" && source.design_card_id)
      referenced.add(source.design_card_id);
  }
  const cards = useQuery({
    queryKey: cardsKey,
    queryFn: ({ signal }) => listCards(signal),
    enabled: referenced.size > 0,
  });
  const project = useQuery({
    queryKey: projectCardsKey(projectId),
    queryFn: ({ signal }) => listProjectCards(projectId, signal),
    enabled: referenced.size > 0 && context?.projectCardIds === undefined,
  });
  const allowed = new Set(
    context?.projectCardIds ?? project.data?.map((card) => card.id) ?? [],
  );
  const invalid = [...referenced].filter(
    (id) =>
      !allowed.has(id) ||
      !cards.data?.some((card) => card.id === id && !card.archived),
  );
  const problem =
    referenced.size > 0 &&
    (cards.isError ||
      (context?.projectCardIds === undefined && project.isError));
  const checking =
    referenced.size > 0 &&
    (cards.isPending ||
      (context?.projectCardIds === undefined && project.isPending));
  return {
    blocking: problem || checking || invalid.length > 0,
    checking,
    problem,
    entries: invalid.map((id) => ({
      id,
      card: cards.data?.find((card) => card.id === id),
    })),
    collect: context?.collectCard,
    retry: () => {
      void cards.refetch();
      if (context?.projectCardIds === undefined) void project.refetch();
    },
  };
}
