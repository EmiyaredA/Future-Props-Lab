import { useQueries, useQueryClient } from "@tanstack/react-query";
import { getGenerationTask, type GenerationTask } from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import type { Card } from "./api";
import { cardImageGroups, uniqueCardImageCount } from "./cardImages";

export function useCardFamilyImages(cards: readonly Card[], open: boolean) {
  const client = useQueryClient();
  const taskIds = [
    ...new Set(cards.flatMap((card) => card.candidate_task_ids ?? [])),
  ];
  // Task requests and polling only exist while the gallery is open. Closed
  // families can still include previously loaded results in their counts.
  const queries = useQueries({
    queries: (open ? taskIds : []).map((id) => ({
      queryKey: visualWorkshopQueryKeys.generationTask(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getGenerationTask(id, signal),
      retry: false,
      refetchInterval: (query: { state: { data?: GenerationTask } }) =>
        query.state.data &&
        !["completed", "failed", "cancelled"].includes(query.state.data.status)
          ? 2300
          : false,
    })),
  });
  const tasks = new Map<string, GenerationTask>();
  for (const id of taskIds) {
    const task = client.getQueryData<GenerationTask>(
      visualWorkshopQueryKeys.generationTask(id),
    );
    if (task) tasks.set(id, task);
  }
  const groups = cardImageGroups(cards, tasks);
  const incompleteCards = new Set(
    cards
      .filter((card) => card.candidate_task_ids?.some((id) => !tasks.has(id)))
      .map((card) => card.id),
  );
  return {
    groups,
    count: uniqueCardImageCount(groups),
    incomplete: incompleteCards.size > 0,
    incompleteCards,
    loading: queries.some((query) => query.isPending),
    failed: queries.some((query) => query.isError),
    generating: [...tasks.values()].some(
      (task) => !["completed", "failed", "cancelled"].includes(task.status),
    ),
    retry: () => {
      for (const query of queries) if (query.isError) void query.refetch();
    },
  };
}
