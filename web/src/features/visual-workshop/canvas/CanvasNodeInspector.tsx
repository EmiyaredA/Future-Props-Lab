import { executionDetails } from "@shared/ui/taskExecutionPresentation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Image, LoaderCircle, Music, Upload, Video, X } from "lucide-react";
import {
  fileQueryKeys,
  getFiles,
  getFolders,
  invalidateFileScope,
  uploadManagedFile,
  type ManagedFile,
  type MediaKind,
} from "@features/files";
import { GenerationDrawer } from "@features/visual-workshop/generation/GenerationDrawer";
import {
  getGenerationTask,
  getGenerationBatch,
  retryImageComposition,
  type GenerationBatch,
  type VisualCanvasNode,
} from "@features/visual-workshop/api";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import {
  taskActivity,
  batchActivity,
} from "../generation/generationActivityModel";
import { GenerationSpinner } from "../generation/GenerationActivity";

type MediaNode = Exclude<VisualCanvasNode, { kind: "text" }>;

const ACCEPT: Record<MediaNode["kind"], string> = {
  image: "image/jpeg,image/png,image/webp,image/gif,image/avif",
  video: "video/mp4,video/webm,video/quicktime",
  audio: "audio/mpeg,audio/wav,audio/mp4,audio/ogg",
};

function mediaIcon(kind: MediaNode["kind"]) {
  return kind === "image" ? Image : kind === "video" ? Video : Music;
}

function useProjectMedia(projectId: string, kind: MediaKind) {
  const folders = useQuery({
    queryKey: fileQueryKeys.folders(projectId),
    queryFn: () => getFolders(projectId),
  });
  const folderIds = useMemo(
    () => [
      undefined,
      ...(folders.data?.items.map((folder) => folder.id) ?? []),
    ],
    [folders.data?.items],
  );
  const queries = useQueries({
    queries: folderIds.map((folderId) => ({
      queryKey: fileQueryKeys.list({
        projectId,
        folderId,
        mediaKind: kind,
        includeReferences: true,
      }),
      queryFn: () =>
        getFiles({
          projectId,
          folderId,
          mediaKind: kind,
          includeReferences: true,
        }),
      enabled: !folders.isLoading,
    })),
  });
  const files = useMemo(() => {
    const unique = new Map<string, ManagedFile>();
    queries.forEach((query) =>
      query.data?.items.forEach((file) => unique.set(file.id, file)),
    );
    return [...unique.values()].sort((left, right) =>
      left.display_name.localeCompare(right.display_name, "zh-CN"),
    );
  }, [queries]);
  return {
    files,
    loading: folders.isLoading || queries.some((query) => query.isLoading),
  };
}

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
  initialTab,
  upstreamNodes = [],
}: {
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
  initialTab?: "content" | "generate";
  upstreamNodes?: MediaNode[];
}) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const preferredTab = initialTab ?? (embedded ? "generate" : "content");
  const [tab, setTab] = useState<"content" | "generate">(preferredTab);
  const { files, loading } = useProjectMedia(projectId, node.kind);
  const selected = files.find((file) => file.id === node.asset_id);
  const upload = useMutation({
    mutationFn: (file: File) => uploadManagedFile(file, projectId),
    onSuccess: (file) => {
      void invalidateFileScope(client, projectId);
      onPatch({ asset_id: file.id }, true);
    },
  });
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
    upstreamNodes.forEach((upstream) => {
      const assetId = upstream.asset_id;
      if (!assetId || seen[upstream.kind].has(assetId)) return;
      seen[upstream.kind].add(assetId);
      grouped[upstream.kind].push(assetId);
      names[assetId] = upstream.title;
    });
    return { assetIds: grouped, names };
  }, [upstreamNodes]);
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
    setTab(preferredTab);
  }, [node.id, preferredTab]);

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

  const Icon = mediaIcon(node.kind);
  const isAttachedComposer = embedded && tab === "generate";
  return (
    <aside
      className={`canvas-node-inspector${embedded ? ` is-embedded is-${node.kind}` : ""}`}
      aria-label="节点检查器"
      data-canvas-wheel="content"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {!isAttachedComposer ? (
        <header>
          <div>
            <Icon aria-hidden />
            <span>
              <strong>{node.title}</strong>
              <small>
                {node.kind === "image"
                  ? "图片节点"
                  : node.kind === "video"
                    ? "视频节点"
                    : "音频节点"}
              </small>
            </span>
          </div>
          <button aria-label="关闭节点检查器" onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
      ) : null}
      {!isAttachedComposer ? (
        <nav className="canvas-inspector-tabs" role="tablist">
          <button
            className={tab === "content" ? "active" : ""}
            role="tab"
            aria-selected={tab === "content"}
            onClick={() => setTab("content")}
          >
            素材
          </button>
          <button
            className={tab === "generate" ? "active" : ""}
            role="tab"
            aria-selected={tab === "generate"}
            onClick={() => setTab("generate")}
          >
            AI 生成
          </button>
        </nav>
      ) : null}
      {tab === "generate" ? (
        <GenerationDrawer
          compact
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
          onClose={isAttachedComposer ? onClose : () => setTab("content")}
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
      ) : (
        <div className="canvas-inspector-content">
          <input
            ref={input}
            hidden
            type="file"
            accept={ACCEPT[node.kind]}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
              event.currentTarget.value = "";
            }}
          />
          <button
            className="canvas-inspector-upload"
            disabled={upload.isPending}
            onClick={() => input.current?.click()}
          >
            {upload.isPending ? (
              <LoaderCircle className="spinning" aria-hidden />
            ) : (
              <Upload aria-hidden />
            )}
            {upload.isPending ? "正在上传…" : "上传并绑定素材"}
          </button>
          {node.asset_id && !selected && !loading ? (
            <p className="canvas-inspector-warning">
              素材已删除或不再属于当前项目，请重新绑定。
            </p>
          ) : null}
          {task.data ? (
            <div
              className={`canvas-node-task ${task.data.status}`}
              role="status"
            >
              <strong>
                {taskActivity(task.data) && <GenerationSpinner size={12} />}
                生成任务 · {taskActivity(task.data)?.label ?? task.data.status}
              </strong>
              {taskActivity(task.data)?.progress !== undefined && (
                <span>{taskActivity(task.data)?.progress}%</span>
              )}
              {taskActivity(task.data) && task.data.execution_info && (
                <small>{executionDetails(task.data.execution_info)}</small>
              )}
              {task.data.error_message ? (
                <small>{task.data.error_message}</small>
              ) : null}
            </div>
          ) : null}
          {batch.data ? (
            <div
              className={`canvas-node-task ${batch.data.status}`}
              role="status"
            >
              <strong>
                {batchActivity(batch.data) && <GenerationSpinner size={12} />}
                {batch.data.grid_size === 4 ? "4" : "9"} 宫格 ·{" "}
                {batch.data.batch_kind === "composition"
                  ? "节点合成"
                  : "新图生成"}{" "}
                · {batch.data.status}
              </strong>
              <span>
                {batch.data.completed_count}/{batch.data.grid_size}
              </span>
              {batch.data.error_message ? (
                <small>{batch.data.error_message}</small>
              ) : null}
              {batch.data.batch_kind === "composition" &&
              batch.data.status === "failed" ? (
                <button
                  type="button"
                  onClick={() => {
                    void retryImageComposition(batch.data!.id).then(() => {
                      void client.invalidateQueries({
                        queryKey: visualWorkshopQueryKeys.generationBatch(
                          batch.data!.id,
                        ),
                      });
                    });
                  }}
                >
                  重新合成
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="canvas-inspector-assets">
            {loading ? (
              <span className="canvas-inspector-state">
                <LoaderCircle className="spinning" aria-hidden />{" "}
                正在读取项目素材…
              </span>
            ) : files.length ? (
              files.map((file) => (
                <button
                  className={file.id === node.asset_id ? "selected" : ""}
                  aria-pressed={file.id === node.asset_id}
                  key={file.id}
                  onClick={() => onPatch({ asset_id: file.id }, true)}
                >
                  <Icon aria-hidden />
                  <span>{file.display_name}</span>
                </button>
              ))
            ) : (
              <span className="canvas-inspector-state">
                项目素材库中暂无可用素材
              </span>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
