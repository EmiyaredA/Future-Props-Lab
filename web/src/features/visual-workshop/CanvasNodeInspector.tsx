import { useEffect, useMemo, useRef, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Image, LoaderCircle, Music, Upload, Video, X } from "lucide-react";
import {
  getFiles,
  getFolders,
  uploadManagedFile,
  type ManagedFile,
  type MediaKind,
} from "@features/files/api";
import { GenerationDrawer } from "@features/visual-workshop/GenerationDrawer";
import {
  getGenerationTask,
  type VisualCanvasNode,
} from "@features/visual-workshop/api";

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
    queryKey: ["canvas-media-folders", projectId],
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
      queryKey: ["canvas-media", projectId, folderId ?? "root", kind],
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
}: {
  projectId: string;
  node: MediaNode;
  onClose: () => void;
  onPatch: (patch: Partial<MediaNode>, immediate?: boolean) => void;
}) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"content" | "generate">("content");
  const { files, loading } = useProjectMedia(projectId, node.kind);
  const selected = files.find((file) => file.id === node.asset_id);
  const upload = useMutation({
    mutationFn: (file: File) => uploadManagedFile(file, projectId),
    onSuccess: (file) => {
      void client.invalidateQueries({ queryKey: ["canvas-media"] });
      onPatch({ asset_id: file.id }, true);
    },
  });
  const taskId =
    node.kind === "image" || node.kind === "video"
      ? node.generation_task_id
      : undefined;
  const task = useQuery({
    queryKey: ["visual-generation-task", taskId],
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

  useEffect(() => {
    if (
      task.data?.status === "completed" &&
      task.data.result_asset_id &&
      task.data.result_asset_id !== node.asset_id
    ) {
      onPatch({ asset_id: task.data.result_asset_id }, true);
    }
  }, [node.asset_id, onPatch, task.data]);

  const Icon = mediaIcon(node.kind);
  return (
    <aside className="canvas-node-inspector" aria-label="节点检查器">
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
      {node.kind !== "audio" ? (
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
      {tab === "generate" && node.kind !== "audio" ? (
        <GenerationDrawer
          compact
          projectId={projectId}
          lockedKind={node.kind}
          onClose={() => setTab("content")}
          onTaskCreated={(created) =>
            onPatch({ generation_task_id: created.id, asset_id: null }, true)
          }
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
              <strong>生成任务 · {task.data.status}</strong>
              <span>{task.data.progress}%</span>
              {task.data.error_message ? (
                <small>{task.data.error_message}</small>
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
