import { useInfiniteQuery } from "@tanstack/react-query";
import { listNotes } from "./api";
import { thoughtKeys } from "./queryKeys";

export function useNoteResults(projectId: string | undefined, query: string, view: string, enabled = true) {
  const result = useInfiniteQuery({
    queryKey: thoughtKeys.notes({ knowledge_base_id: projectId, query, view }),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => listNotes({ knowledge_base_id: projectId!, query, view: view as "all", limit: 40, offset: pageParam }, signal),
    getNextPageParam: (last, pages) => {
      const count = pages.reduce((sum, page) => sum + page.items.length, 0);
      return count < last.total && last.items.length ? count : undefined;
    },
    enabled: !!projectId && enabled,
    retry: false,
  });
  const items = [...new Map(result.data?.pages.flatMap(page => page.items).map(item => [item.id, item])).values()];
  return { ...result, items, total: result.data?.pages[0]?.total };
}
