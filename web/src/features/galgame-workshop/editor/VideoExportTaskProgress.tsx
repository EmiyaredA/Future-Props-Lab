import { Download, LoaderCircle } from "lucide-react";
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

export function VideoExportHistory({
  projectId,
  tasks,
  onCancel,
}: {
  projectId: string;
  tasks: GalgameVideoExportTask[];
  onCancel: (taskId: string) => void;
}) {
  return (
    <section className="galgame-video-history">
      <h3>导出记录</h3>
      {tasks.length ? (
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
      ) : (
        <p className="galgame-video-empty">还没有导出记录</p>
      )}
    </section>
  );
}
