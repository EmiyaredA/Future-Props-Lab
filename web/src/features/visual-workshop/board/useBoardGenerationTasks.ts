import { useEffect, useRef } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { getGenerationTasks, getGenerationBatches } from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";

export function useBoardGenerationTasks(
  projectId: string,
  client: QueryClient,
) {
  const seenTaskStates = useRef("");
  const tasks = useQuery({
    queryKey: visualWorkshopQueryKeys.generationTaskList(
      projectId,
      "board",
      "all",
    ),
    queryFn: async () => {
      const first = await getGenerationTasks({
        projectId: projectId,
        pageSize: 100,
        currentNodes: true,
      });
      const items = [...first.items];
      for (let page = 2; items.length < first.total; page++) {
        const next = await getGenerationTasks({
          projectId: projectId,
          pageSize: 100,
          currentNodes: true,
          page,
        });
        if (!next.items.length) break;
        items.push(...next.items);
      }
      return items;
    },
    refetchInterval: (query) =>
      query.state.data?.some((task) =>
        ["queued", "submitting", "pending", "processing"].includes(task.status),
      )
        ? 1500
        : false,
  });
  const batches = useQuery({
    queryKey: visualWorkshopQueryKeys.generationBatchList(projectId),
    queryFn: async () => {
      const first = await getGenerationBatches(projectId, 1, true);
      const items = [...first.items];
      for (let page = 2; items.length < first.total; page++) {
        const next = await getGenerationBatches(projectId, page, true);
        if (!next.items.length) break;
        items.push(...next.items);
      }
      return items;
    },
    refetchInterval: (query) =>
      query.state.data?.some((batch) =>
        ["queued", "processing"].includes(batch.status),
      )
        ? 1500
        : false,
  });
  const taskStates =
    (tasks.data ?? [])
      .map((task) => `${task.id}:${task.status}:${task.result_asset_id ?? ""}`)
      .join(",") +
    (batches.data ?? [])
      .map(
        (batch) => `${batch.id}:${batch.status}:${batch.result_asset_id ?? ""}`,
      )
      .join(",");
  useEffect(() => {
    if (seenTaskStates.current === taskStates) return;
    seenTaskStates.current = taskStates;
    void client.invalidateQueries({
      queryKey: visualWorkshopQueryKeys.canvas(projectId),
    });
    void client.invalidateQueries({
      queryKey: visualWorkshopQueryKeys.nodeOutputsProject(projectId),
    });
  }, [taskStates, client, projectId]);
  return { tasks, batches };
}
