import type { QueryClient } from "@tanstack/react-query";
import { getVisualCanvas, type VisualCanvasNode } from "../api";
import type { Card } from "./api";
import { importManagedFiles } from "@features/files";
import { ApiError } from "@platform/api/errors";

export async function placeCardImage(
  projectId: string,
  assetId: string,
  source: string | null | undefined,
) {
  if (source === projectId) return assetId;
  if (source) {
    try {
      const result = await importManagedFiles(projectId, {
        sourceScope: "project",
        sourceProjectId: source,
        assetIds: [assetId],
      });
      const placed = result.items[0];
      if (placed) return placed.id;
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.problem.code !== "scope_mismatch"
      )
        throw error;
    }
  }
  const placed = (
    await importManagedFiles(projectId, {
      sourceScope: "library",
      assetIds: [assetId],
    })
  ).items[0];
  if (!placed) throw new Error("参考图未能添加到项目");
  return placed.id;
}

export async function resolveDesignImage(
  client: QueryClient,
  projectId: string,
  card: Card,
  currentNodes?: VisualCanvasNode[],
) {
  const source = card.adopted_asset_id;
  if (!source || card.archived) throw new Error("请先为设定卡选定可用的采用图");
  return client.fetchQuery({
    queryKey: [
      "visual-design-image",
      projectId,
      card.id,
      source,
      card.revision,
    ],
    staleTime: Infinity,
    queryFn: async () => {
      const nodes = currentNodes ?? (await getVisualCanvas(projectId)).nodes;
      for (const node of nodes) {
        if (
          node.kind === "image" &&
          node.design_card_id === card.id &&
          node.design_card_revision === card.revision &&
          node.asset_id
        )
          return node.asset_id;
        if (node.kind === "video") {
          const existing = node.generation_draft?.design_references?.find(
            (value) =>
              value.card_id === card.id &&
              value.card_revision === card.revision,
          );
          if (existing) return existing.asset_id;
        }
      }
      return placeCardImage(projectId, source, card.media_projects?.[source]);
    },
  });
}
