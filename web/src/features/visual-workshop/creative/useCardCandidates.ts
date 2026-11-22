import { useQueries, useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@platform/api/client";
import { getGenerationTask, type GenerationTask } from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import type { Card } from "./api";
import { cardCandidateIds } from "./cardImages";

export function useCardCandidates(
  card: Card,
  copies: ReadonlyMap<string, string>,
) {
  const tasks = useQueries({
    queries: (card.candidate_task_ids ?? []).map((id) => ({
      queryKey: visualWorkshopQueryKeys.generationTask(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getGenerationTask(id, signal),
      refetchInterval: (query: { state: { data?: GenerationTask } }) =>
        query.state.data &&
        !["completed", "failed", "cancelled"].includes(query.state.data.status)
          ? 2300
          : false,
    })),
  });
  const generated = tasks.flatMap(({ data }) =>
    data?.status === "completed" && data.result_asset_id
      ? [data.result_asset_id]
      : [],
  );
  const saved = cardCandidateIds(card, [], copies);
  const unresolved = [
    ...new Set(
      generated.filter((id) => !saved.includes(id) && !copies.has(id)),
    ),
  ];
  // A completed task still points at its project original after the adopted
  // image is copied to the library. Resolve only verified byte-identical copies.
  const equivalents = useQuery({
    queryKey: ["card-candidate-equivalents", card.id, unresolved, saved],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.POST("/v1/files/content-identities", {
          body: { asset_ids: unresolved },
          signal,
        }),
      ),
    enabled: unresolved.length > 0 && saved.length > 0,
    staleTime: 30_000,
    retry: false,
  });
  const aliases = new Map(copies);
  for (const item of equivalents.data?.items ?? []) {
    const match = saved.find((id) => item.equivalent_ids.includes(id));
    if (match) aliases.set(item.asset_id, match);
  }
  const resolving = equivalents.isFetching && !equivalents.data;
  const ready = resolving
    ? generated.filter((id) => !unresolved.includes(id))
    : generated;
  return {
    tasks,
    ids: cardCandidateIds(card, ready, aliases),
    aliases,
    resolving,
  };
}
