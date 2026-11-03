import { LoadingScene } from "@shared/ui/LoadingScene";
import { useRef, useState } from "react";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { LoadingState } from "@shared/ui/LoadingState";
import { ProgressBar } from "@shared/ui/LoadingState";
import { Download, Film } from "lucide-react";
import {
  downloadGalgameVideoExport,
  type GalgameVideoExportTask,
} from "@features/galgame-workshop/api";

const phaseLabel: Record<GalgameVideoExportTask["phase"], string> = {
  queued: "排队中",
  preparing: "准备素材",
  analyzing: "分析口型与动画",
  rendering: "确定性逐帧合成",
  encoding: "编码 MP4",
  verifying: "校验成片",
  registering: "保存到资产库",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const EMPTY_TASK_IDS: ReadonlySet<string> = new Set();

function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest]
    .map((value, index) =>
      index === 0 ? String(value) : String(value).padStart(2, "0"),
    )
    .join(":");
}

function TaskProgress({ task }: { task: GalgameVideoExportTask }) {
  return (
    <>
      <div>
        <strong>{task.outputFilename || task.endingLabel || "视频导出"}</strong>
        <small>
          {phaseLabel[task.phase]} · {task.preset}
          {task.totalMs
            ? ` · ${formatDuration(task.renderedMs)} / ${formatDuration(task.totalMs)}`
            : ""}
        </small>
      </div>
      <ProgressBar max={100} value={task.progress} />
      <span>{task.progress}%</span>
    </>
  );
}

export function ActiveVideoExportStatus({
  task,
  submitting,
}: {
  task?: GalgameVideoExportTask;
  submitting: boolean;
}) {
  if (!submitting && !task) return null;
  return (
    <section
      className="galgame-video-active-export"
      role="status"
      aria-live="polite"
    >
      {submitting ? (
        <>
          <LoadingScene />
          <span>
            <strong>正在创建导出任务</strong>
            <small>正在冻结当前 Story 与导出设置…</small>
          </span>
        </>
      ) : task ? (
        <>
          {["queued", "running"].includes(task.status) ? (
            <LoadingScene />
          ) : null}
          <span>
            <strong>
              {task.cancelRequested &&
              ["queued", "running"].includes(task.status)
                ? "正在取消视频导出"
                : task.status === "completed"
                  ? "视频导出完成"
                  : task.status === "failed"
                    ? "视频导出失败"
                    : task.status === "cancelled"
                      ? "视频导出已取消"
                      : "视频正在后台导出"}
            </strong>
            <small>
              {task.cancelRequested &&
              ["queued", "running"].includes(task.status)
                ? "正在等待渲染器安全停止"
                : `${phaseLabel[task.phase]} · ${task.progress}%`}
              {["queued", "running"].includes(task.status)
                ? task.cancelRequested
                  ? " · 可以关闭窗口，取消会在后台完成"
                  : " · 可以关闭窗口，任务会继续运行"
                : ""}
            </small>
            {task.error ? <em>{task.error}</em> : null}
          </span>
        </>
      ) : null}
    </section>
  );
}

export function VideoExportStartButton({
  checking,
  ready,
  submitting,
  onClick,
}: {
  checking: boolean;
  ready: boolean;
  submitting: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="galgame-video-export-start"
      disabled={submitting}
      aria-disabled={!ready || submitting}
      onClick={onClick}
    >
      {submitting ? <LoadingScene /> : checking ? null : <Film aria-hidden />}
      {submitting ? (
        "正在创建导出任务…"
      ) : checking ? (
        <LoadingState variant="inline" label="正在检查导出设置…" />
      ) : ready ? (
        "直接导出 MP4"
      ) : (
        "请先完成导出检查"
      )}
    </button>
  );
}

export function VideoExportHistory({
  projectId,
  tasks,
  loading,
  refreshing,
  error,
  cancellingTaskIds = EMPTY_TASK_IDS,
  onRetry,
  onCancel,
}: {
  projectId: string;
  tasks: GalgameVideoExportTask[];
  loading: boolean;
  refreshing: boolean;
  error?: string;
  cancellingTaskIds?: ReadonlySet<string>;
  onRetry: () => void;
  onCancel: (taskId: string) => void;
}) {
  const transfer = useTransferProgress();
  const downloadInFlight = useRef(false);
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const download = async (task: GalgameVideoExportTask) => {
    if (downloadInFlight.current) return;
    downloadInFlight.current = true;
    setDownloadPending(true);
    setDownloadError("");
    try {
      await transfer.run((onProgress) =>
        downloadGalgameVideoExport(
          projectId,
          task.id,
          task.outputFilename || "galgame-export.mp4",
          { onProgress },
        ),
      );
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "下载失败，请重试",
      );
    } finally {
      downloadInFlight.current = false;
      setDownloadPending(false);
    }
  };

  return (
    <section className="galgame-video-history">
      <TransferFeedback progress={transfer.progress} />
      {downloadError ? <p role="alert">{downloadError}</p> : null}
      <header>
        <h3>导出记录</h3>
        {refreshing ? (
          <small>
            <LoadingState label="正在刷新…" variant="inline" />
          </small>
        ) : null}
      </header>
      {loading ? (
        <div
          className="galgame-video-history-state"
          role="status"
          aria-live="polite"
        >
          <span>
            <LoadingState label="正在加载导出记录" variant="inline" />
            <small>任务较多或正在导出时可能需要稍等片刻…</small>
          </span>
        </div>
      ) : (
        tasks.map((task) => {
          const cancelling =
            cancellingTaskIds.has(task.id) ||
            (Boolean(task.cancelRequested) &&
              ["queued", "running"].includes(task.status));
          return (
            <article key={task.id}>
              <TaskProgress task={task} />
              {task.status === "completed" ? (
                <button
                  type="button"
                  disabled={downloadPending}
                  onClick={() => void download(task)}
                >
                  <Download aria-hidden /> 下载
                </button>
              ) : ["queued", "running"].includes(task.status) ? (
                <button
                  type="button"
                  disabled={cancelling}
                  onClick={() => onCancel(task.id)}
                >
                  {cancelling ? (
                    <>
                      <LoadingScene />
                      取消中…
                    </>
                  ) : (
                    "取消"
                  )}
                </button>
              ) : null}
              {task.error ? <p>{task.error}</p> : null}
            </article>
          );
        })
      )}
      {!loading && !tasks.length && !error ? (
        <p className="galgame-video-empty">还没有导出记录</p>
      ) : null}
      {!loading && error ? (
        <div className="galgame-video-history-error" role="alert">
          <span>
            <strong>导出记录暂时无法读取</strong>
            <small>{error}</small>
          </span>
          <button type="button" onClick={onRetry}>
            重新加载
          </button>
        </div>
      ) : null}
    </section>
  );
}
