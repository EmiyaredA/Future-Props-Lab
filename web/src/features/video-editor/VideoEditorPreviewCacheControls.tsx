import type { PreviewRenderControl } from "./usePreviewRender";

export function VideoEditorPreviewCacheControls({
  control,
  canWrite,
}: {
  control: PreviewRenderControl;
  canWrite: boolean;
}) {
  const tasks = control.query.data?.items ?? [];
  const running = tasks.find((task) =>
    ["queued", "running"].includes(task.status),
  );
  const ready = tasks.some((task) => task.valid) && !control.dirty;
  const failed = tasks.find((task) => task.status === "failed");
  const error =
    control.create.error ??
    control.cancel.error ??
    control.clear.error ??
    control.query.error;
  const status =
    control.playbackError ||
    (error instanceof Error ? error.message : "") ||
    (running
      ? `${running.status === "queued" ? "预渲染排队中" : "预渲染中"} ${running.progress}%`
      : ready
        ? "预览已就绪 · 720p"
        : failed
          ? `预渲染失败：${failed.error ?? "请重试"}`
          : tasks[0]?.status === "cancelled"
            ? "预渲染已取消"
            : tasks.length
              ? "预览需要更新"
              : "");
  return (
    <div
      className="ve-preview-cache-toolbar"
      role="group"
      aria-label="预渲染预览"
    >
      <button
        disabled={
          !canWrite ||
          Boolean(running) ||
          control.create.isPending ||
          control.clear.isPending
        }
        onClick={() => control.create.mutate()}
        title="提前合成整条时间线，完成后播放自动使用 720p 缓存"
      >
        {control.create.isPending
          ? "等待保存并提交…"
          : failed
            ? "重试预渲染"
            : "预渲染"}
      </button>
      {running && (
        <button
          disabled={!canWrite || control.cancel.isPending}
          onClick={() => control.cancel.mutate(running.id)}
        >
          取消预渲染
        </button>
      )}
      {tasks.length > 0 && (
        <button
          disabled={!canWrite || control.clear.isPending}
          onClick={() => control.clear.mutate()}
        >
          清理缓存
        </button>
      )}
      {status && (
        <span className="ve-preview-cache-status" role="status">
          {status}
        </span>
      )}
    </div>
  );
}
