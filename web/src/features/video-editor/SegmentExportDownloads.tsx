import { useEffect, useState } from "react";
import { Archive, ChevronDown, Download } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApiDownload } from "@platform/api/client";
import { downloadProjectSnapshot } from "@shared/ui/project-library/downloadProjectSnapshot";
import { visualWorkshopQueryKeys } from "@features/visual-workshop";
import { downloadVideoEditorSegments } from "./api";
import type { VideoEditorTask } from "./types";
import "./video-editor-segments.css";

export function SegmentExportDownloads({ task }: { task: VideoEditorTask }) {
  const client = useQueryClient();
  const completedTarget =
    task.status === "completed"
      ? task.resultDetail?.targetProjectId
      : undefined;
  useEffect(() => {
    if (typeof completedTarget !== "string") return;
    void client.invalidateQueries({
      queryKey: visualWorkshopQueryKeys.projects,
    });
    void client.invalidateQueries({
      queryKey: visualWorkshopQueryKeys.project(completedTarget),
    });
    void client.invalidateQueries({
      queryKey: visualWorkshopQueryKeys.canvas(completedTarget),
    });
  }, [client, completedTarget]);
  const [expanded, setExpanded] = useState(false);
  const segments = (task.resultDetail?.segments ?? []) as Array<{
    assetId?: string;
    name?: string;
    outputFilename?: string;
    status?: string;
  }>;
  const download = useMutation({
    mutationFn: async (assetId?: string) => {
      const file = assetId
        ? await fetchApiDownload(
            `/v1/files/${encodeURIComponent(assetId)}/download`,
          )
        : await downloadVideoEditorSegments(task.projectId, task.id);
      downloadProjectSnapshot(file, assetId ? "片段.mp4" : "分段导出.zip");
    },
  });
  if (task.status !== "completed" || !segments.length) return null;
  return (
    <div className="ve-segment-downloads">
      <div>
        <button
          className="ve-segment-download-all"
          disabled={download.isPending}
          onClick={() => download.mutate(undefined)}
        >
          <Archive aria-hidden />
          {download.isPending ? "正在下载…" : "全部打包下载"}
        </button>
        <button
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          逐段下载（{segments.length}）<ChevronDown aria-hidden />
        </button>
      </div>
      {expanded ? (
        <ul>
          {segments.map((segment, index) => (
            <li key={segment.assetId ?? index}>
              <span>
                {index + 1}. {segment.outputFilename ?? segment.name}
              </span>
              <button
                disabled={
                  download.isPending ||
                  !segment.assetId ||
                  segment.status !== "completed"
                }
                aria-label={`下载片段 ${index + 1}：${segment.name ?? "未命名"}`}
                onClick={() => download.mutate(segment.assetId)}
              >
                <Download aria-hidden /> 下载
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {download.isError ? <p role="alert">{download.error.message}</p> : null}
    </div>
  );
}
