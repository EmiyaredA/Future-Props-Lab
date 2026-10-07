import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  createImageComposition,
  getGenerationBatch,
  type ImageCompositionInput,
  type VisualCanvasNode,
  type VisualCanvasDocument,
} from "@features/visual-workshop/api";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import { ImageGridCompositionDialog } from "@features/visual-workshop/canvas/ImageGridCompositionDialog";
import { canvasBounds, type CanvasPoint } from "./canvasPlacement";
import type { NodeKind } from "./geometry";

function resultAnchor(nodes: VisualCanvasNode[], ids: string[]) {
  const source = nodes.filter((node) => ids.includes(node.id));
  const bounds = canvasBounds(source);
  return { x: bounds.x + bounds.width + 48, y: bounds.y };
}

type ImageNode = Extract<VisualCanvasNode, { kind: "image" }>;

export function useImageGridComposition({
  projectId,
  nodes,
  selectedNodeIds,
  revisionRef,
  nodesRef,
  prepareCanvas,
  resolveNodePosition,
  revealNodes,
  client,
  setSelectedNodeIds,
  setInspectedNodeId,
  setAssetsOpen,
}: {
  projectId: string;
  nodes: VisualCanvasNode[];
  selectedNodeIds: string[];
  revisionRef: MutableRefObject<number>;
  nodesRef: RefObject<VisualCanvasNode[]>;
  prepareCanvas: () => Promise<number>;
  resolveNodePosition: (kind: NodeKind, anchor: CanvasPoint) => CanvasPoint;
  revealNodes: (nodes: VisualCanvasNode[]) => void;
  client: QueryClient;
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
  setInspectedNodeId: (id: string | undefined) => void;
  setAssetsOpen: (open: boolean) => void;
}) {
  const [compositionOpen, setCompositionOpen] = useState<string[]>();
  const [activeBatchId, setActiveBatchId] = useState<string>();
  const selectedImageNodes = selectedNodeIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter(
      (node): node is ImageNode =>
        node?.kind === "image" && Boolean(node.asset_id),
    );
  const openComposition = useCallback(
    (initialIds: string[]) => {
      setCompositionOpen(initialIds);
      setInspectedNodeId(undefined);
      setAssetsOpen(false);
    },
    [setAssetsOpen, setInspectedNodeId],
  );
  const compositionResultPosition = useMemo(() => {
    return resultAnchor(nodes, compositionOpen ?? []);
  }, [compositionOpen, nodes]);
  const activeBatch = useQuery({
    queryKey: visualWorkshopQueryKeys.generationBatch(activeBatchId),
    queryFn: () => getGenerationBatch(activeBatchId!),
    enabled: Boolean(activeBatchId),
    refetchInterval: (query) =>
      query.state.data &&
      ["queued", "processing"].includes(query.state.data.status)
        ? 2_000
        : false,
  });
  useEffect(() => {
    if (!activeBatch.data) return;
    if (["completed", "failed"].includes(activeBatch.data.status)) {
      void client.invalidateQueries({
        queryKey: visualWorkshopQueryKeys.canvas(projectId),
      });
      void client.invalidateQueries({
        queryKey: visualWorkshopQueryKeys.generationBatches,
      });
    }
  }, [activeBatch.data, client, projectId]);
  const canComposeSelection =
    selectedImageNodes.length === selectedNodeIds.length &&
    (selectedImageNodes.length === 4 || selectedImageNodes.length === 9);
  const compositionOverlay = (
    <>
      {activeBatch.data &&
      ["queued", "processing"].includes(activeBatch.data.status) ? (
        <div className="image-grid-composition-notice" role="status">
          <strong>合成任务已提交</strong>
          <span>正在后台处理，完成后会自动更新画布。</span>
          <button type="button" onClick={() => setAssetsOpen(true)}>
            查看项目素材库
          </button>
        </div>
      ) : null}
      {activeBatch.data?.status === "completed" ? (
        <div className="image-grid-composition-notice is-success" role="status">
          <strong>宫格合成完成</strong>
          <span>结果已添加到画布右侧，并保存到项目素材库。</span>
          <button type="button" onClick={() => setAssetsOpen(true)}>
            打开项目素材库
          </button>
        </div>
      ) : null}
      {activeBatch.data?.status === "failed" ? (
        <div className="image-grid-composition-notice is-error" role="alert">
          <strong>宫格合成失败</strong>
          <span>
            {activeBatch.data.error_message || "请在结果节点中重新合成。"}
          </span>
        </div>
      ) : null}
      {compositionOpen ? (
        <ImageGridCompositionDialog
          nodes={nodes.filter(
            (node): node is ImageNode => node.kind === "image",
          )}
          initialNodeIds={compositionOpen}
          canvasRevision={revisionRef.current}
          resultPosition={compositionResultPosition}
          onClose={() => setCompositionOpen(undefined)}
          onSubmit={async (body: ImageCompositionInput) => {
            const revision = await prepareCanvas();
            const position = resolveNodePosition(
              "image",
              resultAnchor(
                nodesRef.current,
                body.items.map((item) => item.node_id),
              ),
            );
            const batch = await createImageComposition(projectId, {
              ...body,
              result_position: position,
              expected_canvas_revision: revision,
            });
            setActiveBatchId(batch.id);
            setCompositionOpen(undefined);
            if (batch.generation_node_id)
              setSelectedNodeIds([batch.generation_node_id]);
            await client.invalidateQueries({
              queryKey: visualWorkshopQueryKeys.canvas(projectId),
            });
            const canvas = client.getQueryData<VisualCanvasDocument>(
              visualWorkshopQueryKeys.canvas(projectId),
            );
            revealNodes(
              canvas?.nodes.filter(
                (node) => node.id === batch.generation_node_id,
              ) ?? [],
            );
          }}
        />
      ) : null}
    </>
  );
  return {
    selectedImageNodes,
    openComposition,
    canComposeSelection,
    compositionOverlay,
  };
}
