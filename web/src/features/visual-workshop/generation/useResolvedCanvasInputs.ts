import { useQueries } from "@tanstack/react-query";
import { getNodeOutput } from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import { apiErrorMessage } from "@platform/api/errors";
import type {
  CanvasReferenceContext,
  ResolvedCanvasInput,
} from "./generationDrawerTypes";

export function useResolvedCanvasInputs(
  projectId: string,
  nodeId: string,
  context?: CanvasReferenceContext,
) {
  const incoming = (context?.edges ?? []).filter(
    (edge) => edge.target_node_id === nodeId,
  );
  const sources = incoming.map((edge) =>
    context?.nodes.find((node) => node.id === edge.source_node_id),
  );
  const outputIds = incoming.map((edge, i) =>
    edge.binding === "fixed" ? edge.output_id : sources[i]?.final_output_id,
  );
  const queries = useQueries({
    queries: incoming.map((edge, i) => ({
      queryKey: visualWorkshopQueryKeys.nodeOutput(
        projectId,
        edge.source_node_id,
        outputIds[i] ?? "",
      ),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getNodeOutput(projectId, edge.source_node_id, outputIds[i]!, signal),
      enabled: Boolean(outputIds[i]),
    })),
  });
  const inputs: ResolvedCanvasInput[] = incoming.map((edge, i) => {
    const source = sources[i];
    const output = queries[i].data;
    const assetId = outputIds[i]
      ? output?.asset_id
      : source?.kind !== "text"
        ? source?.asset_id
        : undefined;
    const loading = Boolean(outputIds[i] && queries[i].isPending);
    return {
      key: `edge:${edge.id}`,
      edge,
      title: source?.title ?? "节点不存在",
      kind: source?.kind ?? "image",
      assetId,
      text: output?.text,
      version: output?.version,
      loading,
      error: queries[i].isError
        ? apiErrorMessage(queries[i].error)
        : !loading && !assetId && !output?.text
          ? "等待上游输出"
          : undefined,
    };
  });
  return { inputs, ready: !inputs.some((item) => item.loading || item.error) };
}
