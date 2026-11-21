import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { GenerationDrawer } from "../generation/GenerationDrawer";
import {
  CancelQueuedTasks,
  CancelQueuedBatch,
} from "../generation/CancelQueuedTasks";
import {
  getGenerationTask,
  getGenerationBatch,
  type GenerationBatch,
  type VisualCanvasNode,
} from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import {
  taskActivity,
  batchActivity,
} from "../generation/generationActivityModel";
import { useResolvedCanvasInputs } from "../generation/useResolvedCanvasInputs";
import type {
  CanvasReferenceContext,
  DesignReferenceRequest,
} from "../generation/generationDrawerTypes";

type MediaNode = Exclude<VisualCanvasNode, { kind: "text" }>;

export function CanvasNodeInspector({
  projectId,
  node,
  onClose,
  onPatch,
  onPrepareCanvas,
  onTaskLinked,
  onBatchCreated,
  embedded = false,
  generationLayout = "canvas",
  generating = false,
  upstreamNodes = [],
  designReferenceRequest,
  referenceContext,
  portalHost,
}: {
  portalHost?: HTMLElement | null;
  projectId: string;
  node: MediaNode;
  onClose: () => void;
  onPatch: (
    patch: Partial<MediaNode>,
    immediate?: boolean,
  ) => void | Promise<void>;
  onPrepareCanvas?: () => Promise<number>;
  onTaskLinked?: (taskId: string) => void;
  onBatchCreated?: (batch: GenerationBatch) => void | Promise<void>;
  embedded?: boolean;
  generationLayout?: "canvas" | "workbench";
  generating?: boolean;
  upstreamNodes?: MediaNode[];
  referenceContext?: CanvasReferenceContext;
  designReferenceRequest?: DesignReferenceRequest;
}) {
  const client = useQueryClient();
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const change = () => setNarrow(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const mobilePortal =
    embedded && generationLayout === "canvas" && narrow && portalHost;

  const resolvedInputs = useResolvedCanvasInputs(
    projectId,
    node.id,
    referenceContext,
  );
  const taskId = node.generation_task_id;
  const batchId = node.kind === "image" ? node.generation_batch_id : null;
  const linkedReferences = useMemo(() => {
    const grouped = {
      image: [] as string[],
      video: [] as string[],
      audio: [] as string[],
    };
    const seen = {
      image: new Set<string>(),
      video: new Set<string>(),
      audio: new Set<string>(),
    };
    const names: Record<string, string> = {};
    if (referenceContext) {
      for (const input of resolvedInputs.inputs) {
        if (
          input.kind === "text" ||
          !input.assetId ||
          seen[input.kind].has(input.assetId)
        )
          continue;
        seen[input.kind].add(input.assetId);
        grouped[input.kind].push(input.assetId);
        names[input.assetId] = input.title;
      }
      return { assetIds: grouped, names };
    }
    upstreamNodes.forEach((upstream) => {
      const assetId = upstream.asset_id;
      if (!assetId || seen[upstream.kind].has(assetId)) return;
      seen[upstream.kind].add(assetId);
      grouped[upstream.kind].push(assetId);
      names[assetId] = upstream.title;
    });
    return { assetIds: grouped, names };
  }, [upstreamNodes, referenceContext, resolvedInputs.inputs]);
  const task = useQuery({
    queryKey: visualWorkshopQueryKeys.generationTask(taskId),
    queryFn: () => getGenerationTask(taskId!),
    enabled: Boolean(taskId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status &&
        ["queued", "submitting", "pending", "processing"].includes(status)
        ? 1500
        : false;
    },
  });
  const batch = useQuery({
    queryKey: visualWorkshopQueryKeys.generationBatch(batchId),
    queryFn: () => getGenerationBatch(batchId!),
    enabled: Boolean(batchId),
    refetchInterval: (query) =>
      query.state.data?.status &&
      ["queued", "processing"].includes(query.state.data.status)
        ? 1500
        : false,
  });

  useEffect(() => {
    if (
      task.data?.status === "completed" &&
      task.data.result_asset_id &&
      task.data.result_asset_id !== node.asset_id
    ) {
      void client.invalidateQueries({
        queryKey: visualWorkshopQueryKeys.canvas(projectId),
      });
    }
  }, [client, projectId, task.data, node.asset_id]);
  useEffect(() => {
    if (
      batch.data?.status === "completed" &&
      batch.data.result_asset_id &&
      batch.data.result_asset_id !== node.asset_id
    ) {
      void client.invalidateQueries({
        queryKey: visualWorkshopQueryKeys.canvas(projectId),
      });
    }
  }, [batch.data, client, projectId, node.asset_id]);

  const inspector = (
    <aside
      className={`canvas-node-inspector${embedded ? ` is-embedded is-${node.kind}` : ""}`}
      aria-label="节点检查器"
      data-canvas-wheel="content"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {(!embedded || mobilePortal) && (
        <header>
          <strong>{node.title}</strong>
          <button aria-label="关闭节点检查器" onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
      )}
      {generationLayout !== "workbench" && (
        <>
          <CancelQueuedTasks tasks={task.data ? [task.data] : []} />
          <CancelQueuedBatch
            batch={batch.data?.grid_output === "composite" ? batch.data : null}
          />
        </>
      )}
      <GenerationDrawer
        compact
        referenceContext={referenceContext}
        referenceInputs={resolvedInputs.inputs}
        referencesReady={resolvedInputs.ready}
        designReferenceRequest={designReferenceRequest}
        layout={generationLayout}
        projectId={projectId}
        canvasNodeId={node.id}
        generating={Boolean(
          generating || taskActivity(task.data) || batchActivity(batch.data),
        )}
        excludedAssetIds={node.asset_id ? [node.asset_id] : []}
        lockedKind={node.kind}
        draft={node.generation_draft}
        linkedAssetIds={linkedReferences.assetIds}
        linkedReferenceNames={linkedReferences.names}
        onClose={onClose}
        onDraftChange={(generationDraft, immediate) =>
          onPatch(
            { generation_draft: generationDraft } as Partial<MediaNode>,
            immediate,
          )
        }
        onBeforeSubmit={async () => {
          return onPrepareCanvas?.();
        }}
        onTaskCreated={(created) => {
          if (onTaskLinked) {
            onTaskLinked(created.id);
            return;
          }
          return onPatch({ generation_task_id: created.id }, true);
        }}
        onBatchCreated={onBatchCreated}
      />
    </aside>
  );
  return mobilePortal ? createPortal(inspector, mobilePortal) : inspector;
}
