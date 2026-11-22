import type { Card } from "./api";
import type { GenerationTask } from "../api";

export type CardImage = { assetId: string; adopted: boolean };
export type CardImageGroup = { card: Card; images: CardImage[] };

/** Preserve saved order; legacy cards may keep their adopted image separately. */
export function cardCandidateIds(
  card: Pick<Card, "adopted_asset_id" | "candidate_asset_ids">,
  generated: readonly string[] = [],
  copies: ReadonlyMap<string, string> = new Map(),
) {
  const canonical = (id: string) => copies.get(id) ?? id;
  const ids = [...new Set((card.candidate_asset_ids ?? []).map(canonical))];
  const adopted = card.adopted_asset_id && canonical(card.adopted_asset_id);
  if (adopted && !ids.includes(adopted)) ids.unshift(adopted);
  return [...new Set([...ids, ...generated.map(canonical)])];
}

/** Only explicit card references participate; parent images belong to the parent. */
export function cardImageGroups(
  cards: readonly Card[],
  tasks: ReadonlyMap<string, GenerationTask> = new Map(),
): CardImageGroup[] {
  return cards.map((card) => {
    const ids = new Set<string>();
    if (card.adopted_asset_id) ids.add(card.adopted_asset_id);
    for (const id of card.candidate_asset_ids ?? []) ids.add(id);
    for (const id of card.candidate_task_ids ?? []) {
      const task = tasks.get(id);
      if (task?.status === "completed" && task.result_asset_id)
        ids.add(task.result_asset_id);
    }
    return {
      card,
      images: [...ids].map((assetId) => ({
        assetId,
        adopted: assetId === card.adopted_asset_id,
      })),
    };
  });
}

export function uniqueCardImageCount(groups: readonly CardImageGroup[]) {
  return new Set(
    groups.flatMap(({ images }) => images.map(({ assetId }) => assetId)),
  ).size;
}
