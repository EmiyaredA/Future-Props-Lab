import { Download, Film, LoaderCircle } from "lucide-react";
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
      <progress max="100" value={task.progress} />
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
          <LoaderCircle className="spinning" aria-hidden />
          <span>
            <strong>正在创建导出任务</strong>
            <small>正在冻结当前 Story 与导出设置…</small>
          </span>
        </>
      ) : task ? (
        <>
          {["queued", "running"].includes(task.status) ? (
            <LoaderCircle className="spinning" aria-hidden />
          ) : null}
          <span>
            <strong>
              {task.status === "completed"
                ? "视频导出完成"
                : task.status === "failed"
                  ? "视频导出失败"
                  : task.status === "cancelled"
                    ? "视频导出已取消"
                    : "视频正在后台导出"}
            </strong>
            <small>
              {phaseLabel[task.phase]} · {task.progress}%
              {["queued", "running"].includes(task.status)
                ? " · 可以关闭窗口，任务会继续运行"
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
      {submitting || checking ? (
        <LoaderCircle className="spinning" aria-hidden />
      ) : (
        <Film aria-hidden />
      )}
      {submitting
        ? "正在创建导出任务…"
        : checking
          ? "正在检查导出设置…"
          : ready
            ? "直接导出 MP4"
            : "请先完成导出检查"}
    </button>
  );
}

export function VideoExportHistory({
  projectId,
  tasks,
  loading,
  refreshing,
  error,
  onRetry,
  onCancel,
}: {
  projectId: string;
  tasks: GalgameVideoExportTask[];
  loading: boolean;
  refreshing: boolean;
  error?: string;
  onRetry: () => void;
  onCancel: (taskId: string) => void;
}) {
  return (
    <section className="galgame-video-history">
      <header>
        <h3>导出记录</h3>
        {refreshing ? (
          <small role="status" aria-live="polite">
            <LoaderCircle className="spinning" aria-hidden />
            正在刷新…
          </small>
        ) : null}
      </header>
      {loading ? (
        <div
          className="galgame-video-history-state"
          role="status"
          aria-live="polite"
        >
          <LoaderCircle className="spinning" aria-hidden />
          <span>
            <strong>正在加载导出记录</strong>
            <small>任务较多或正在导出时可能需要稍等片刻…</small>
          </span>
        </div>
      ) : (
        tasks.map((task) => (
          <article key={task.id}>
            <TaskProgress task={task} />
            {task.status === "completed" ? (
              <button
                type="button"
                onClick={() =>
                  void downloadGalgameVideoExport(
                    projectId,
                    task.id,
                    task.outputFilename || "galgame-export.mp4",
                  )
                }
              >
                <Download aria-hidden /> 下载
              </button>
            ) : ["queued", "running"].includes(task.status) ? (
              <button type="button" onClick={() => onCancel(task.id)}>
                取消
              </button>
            ) : null}
            {task.error ? <p>{task.error}</p> : null}
          </article>
        ))
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
