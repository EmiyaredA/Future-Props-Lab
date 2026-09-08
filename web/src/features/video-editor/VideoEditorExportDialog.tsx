import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Film, X } from "lucide-react";
import { createVideoEditorRender, renderPreflight } from "./api";
import type { VideoEditorPreset } from "./types";
import { videoEditorQueryKeys } from "./queryKeys";

const presets: VideoEditorPreset[] = ["720p30", "1080p30", "720p60", "1080p60"];

export function VideoEditorExportDialog({
  projectId,
  revision,
  onClose,
}: {
  projectId: string;
  revision: number;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [preset, setPreset] = useState<VideoEditorPreset>("1080p30");
  const [preview, setPreview] =
    useState<Awaited<ReturnType<typeof renderPreflight>>>();
  const preflight = useMutation({
    mutationFn: () => renderPreflight(projectId, revision, preset),
    onSuccess: setPreview,
  });
  const render = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("请先执行预检");
      return createVideoEditorRender(
        projectId,
        revision,
        preset,
        preview.fingerprint,
      );
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: videoEditorQueryKeys.renders(projectId),
      });
      onClose();
    },
  });
  return (
    <div className="ve-dialog-backdrop ve-export-backdrop">
      <section
        className="ve-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ve-export-title"
      >
        <header>
          <div>
            <span className="ve-export-icon" aria-hidden="true">
              <Film />
            </span>
            <div>
              <div className="ve-export-heading">
                <h2 id="ve-export-title">导出视频</h2>
                <span className="ve-export-status">确定性渲染</span>
              </div>
              <p>FFmpeg 确定性合成 · 不启动浏览器录屏</p>
            </div>
          </div>
          <button
            className="ve-export-close"
            type="button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </header>
        <div className="ve-export-preview">
          <span>16:9</span>
          <strong>输出画面预检</strong>
          <small>项目底色会承接所有画面空档</small>
        </div>
        <div className="ve-export-section-heading">
          <h3>输出规格</h3>
          <span>选择预设</span>
        </div>
        <div className="ve-preset-grid">
          {presets.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={preset === item}
              className={preset === item ? "selected" : ""}
              onClick={() => {
                setPreset(item);
                setPreview(undefined);
              }}
            >
              <strong>
                {item.startsWith("1080") ? "1920 × 1080" : "1280 × 720"}
              </strong>
              <small>{item.endsWith("60") ? "60 FPS" : "30 FPS"}</small>
            </button>
          ))}
        </div>
        {preview ? (
          <div
            className={
              preview.ready ? "ve-preflight ready" : "ve-preflight blocked"
            }
          >
            <strong>
              {preview.ready ? "预检通过" : "预检未通过"} · {preview.frameCount}{" "}
              帧
            </strong>
            {(preview.warnings ?? []).map((issue, index) => (
              <p key={`${issue.code}-${index}`}>
                <AlertTriangle aria-hidden /> {issue.message}
              </p>
            ))}
            {(preview.blockers ?? []).map((issue, index) => (
              <p key={`${issue.code}-${index}`}>{issue.message}</p>
            ))}
          </div>
        ) : null}
        <footer>
          <button type="button" onClick={onClose}>
            取消
          </button>
          {!preview ? (
            <button
              type="button"
              className="primary"
              disabled={preflight.isPending}
              onClick={() => preflight.mutate()}
            >
              {preflight.isPending ? "正在预检…" : "运行预检"}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={!preview.ready || render.isPending}
              onClick={() => render.mutate()}
            >
              {render.isPending ? "正在创建任务…" : "开始确定性渲染"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
