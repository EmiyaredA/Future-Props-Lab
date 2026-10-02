import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  createImageComposition,
  getGenerationBatch,
  type ImageCompositionInput,
  type VisualCanvasNode,
} from "@features/visual-workshop/api";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import { ImageGridCompositionDialog } from "@features/visual-workshop/canvas/ImageGridCompositionDialog";

type ImageNode = Extract<VisualCanvasNode, { kind: "image" }>;

export function useImageGridComposition({
  projectId,
  nodes,
  selectedNodeIds,
  revisionRef,
  client,
  setSelectedNodeIds,
  setInspectedNodeId,
  setAssetsOpen,
}: {
  projectId: string;
  nodes: VisualCanvasNode[];
  selectedNodeIds: string[];
  revisionRef: MutableRefObject<number>;
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
    const source = compositionOpen
      ?.map((id) => nodes.find((node) => node.id === id))
      .filter((node): node is VisualCanvasNode => Boolean(node));
    const right = Math.max(
      ...(source ?? []).map((node) => node.position.x + 320),
      0,
    );
    return {
      x: right + 48,
      y: Math.min(...(source ?? []).map((node) => node.position.y), 0),
    };
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
            const source = body.items
              .map((item) => nodes.find((node) => node.id === item.node_id))
              .filter((node): node is VisualCanvasNode => Boolean(node));
            const right = Math.max(
              ...source.map((node) => node.position.x + 320),
              0,
            );
            const batch = await createImageComposition(projectId, {
              ...body,
              result_position: {
                x: right + 48,
                y: Math.min(...source.map((node) => node.position.y), 0),
              },
              expected_canvas_revision: revisionRef.current,
            });
            setActiveBatchId(batch.id);
            setCompositionOpen(undefined);
            if (batch.generation_node_id)
              setSelectedNodeIds([batch.generation_node_id]);
            await client.invalidateQueries({
              queryKey: visualWorkshopQueryKeys.canvas(projectId),
            });
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
