import { LoadingScene } from "@shared/ui/LoadingScene";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Layers3 } from "lucide-react";
import {
  cancelGalgameVideoEditorHandoff,
  createGalgameVideoEditorHandoff,
  listGalgameVideoEditorHandoffs,
  type GalgameVideoExportPreviewRequest,
} from "@features/galgame-workshop/api";

export function VideoEditorHandoffPanel({
  projectId,
  request,
  fingerprint,
  disabled,
}: {
  projectId: string;
  request: GalgameVideoExportPreviewRequest;
  fingerprint?: string;
  disabled: boolean;
}) {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const tasks = useQuery({
    queryKey: ["galgame-video-editor-handoffs", projectId],
    queryFn: () => listGalgameVideoEditorHandoffs(projectId),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ["queued", "running"].includes(item.status),
      )
        ? 1500
        : false,
  });
  const create = useMutation({
    mutationFn: () => {
      if (!fingerprint) throw new Error("请先完成导出检查");
      return createGalgameVideoEditorHandoff(projectId, {
        ...request,
        requestId: `handoff-${crypto.randomUUID()}`,
        previewFingerprint: fingerprint,
      });
    },
    onSuccess: () => {
      setError("");
      return client.invalidateQueries({
        queryKey: ["galgame-video-editor-handoffs", projectId],
      });
    },
    onError: (reason) =>
      setError(reason instanceof Error ? reason.message : "无法创建剪辑工程"),
  });
  const cancel = useMutation({
    mutationFn: (taskId: string) =>
      cancelGalgameVideoEditorHandoff(projectId, taskId),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["galgame-video-editor-handoffs", projectId],
      }),
  });
  const latest = tasks.data?.items[0];
  return (
    <section className="galgame-video-handoff">
      <button
        type="button"
        disabled={disabled || create.isPending}
        onClick={() => create.mutate()}
      >
        {create.isPending ? <LoadingScene /> : <Layers3 aria-hidden />}
        发送到视频剪辑工坊
      </button>
      <small>创建新的冻结分层工程，不会覆盖之前的剪辑。</small>
      {latest ? (
        <div>
          <span>
            {latest.status === "completed"
              ? `${latest.trackCount} 条轨道 · ${latest.assetCount} 个素材`
              : latest.status === "failed"
                ? latest.error || "创建失败"
                : `正在复制素材并构建轨道 · ${latest.progress}%`}
          </span>
          {latest.status === "completed" && latest.outputProjectId ? (
            <a
              href={`/apps/video-editor/projects/${encodeURIComponent(latest.outputProjectId)}/editor`}
            >
              打开剪辑工程 <ExternalLink aria-hidden />
            </a>
          ) : ["queued", "running"].includes(latest.status) ? (
            <button type="button" onClick={() => cancel.mutate(latest.id)}>
              取消
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <p>{error}</p> : null}
    </section>
  );
}
