import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, Download, Film, RefreshCcw, X } from "lucide-react";
import { downloadProjectSnapshot } from "@shared/ui/project-library";
import {
  cancelExport,
  createExport,
  downloadExport,
  listExports,
  listVideoTargets,
  sendToEditor,
} from "./api";
import type { MotionExport, MotionFormat, ResolvedDocument } from "./types";

const FORMAT_LABEL: Record<MotionFormat, string> = {
  mp4: "完整镜头 MP4",
  mov4444: "透明视频 MOV",
  "png-sequence": "透明 PNG 序列",
};

export function ExportDialog({
  open,
  onOpenChange,
  projectId,
  document,
  onBeforeExport,
  onHandoff,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  document: ResolvedDocument;
  onBeforeExport: () => Promise<number>;
  onHandoff: (projectId: string) => void;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const [formats, setFormats] = useState<MotionFormat[]>(["mp4", "mov4444"]);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(document.settings.durationFrames);
  const [tasks, setTasks] = useState<MotionExport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [handoff, setHandoff] = useState<{
    task: MotionExport;
    format: "mp4" | "mov4444";
  } | null>(null);
  const [targets, setTargets] = useState<{ id: string; title: string }[]>([]);
  const [target, setTarget] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const refresh = useCallback(
    () => listExports(projectId).then((result) => setTasks(result.items)),
    [projectId],
  );
  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1800);
    return () => window.clearInterval(timer);
  }, [open, refresh]);
  const submit = async () => {
    if (!formats.length) {
      setError("至少选择一种导出格式");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const savedRevision = await onBeforeExport();
      await createExport(projectId, savedRevision, formats, start, end);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };
  const beginHandoff = (task: MotionExport, format: "mp4" | "mov4444") => {
    setHandoff({ task, format });
    setTarget("");
    setNewTitle("");
    setError("");
    void listVideoTargets()
      .then((result) => setTargets(result.items))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : "剪辑项目读取失败"),
      );
  };
  const finishHandoff = async () => {
    if (!handoff || (!target && !newTitle.trim())) return;
    setBusy(true);
    setError("");
    try {
      const result = await sendToEditor(projectId, handoff.task.id, {
        format: handoff.format,
        targetProjectId: target || null,
        newProjectTitle: target ? null : newTitle.trim(),
      });
      setHandoff(null);
      onOpenChange(false);
      onHandoff(result.projectId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "交接失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="mc-dialog-overlay" />
        <Dialog.Content className="mc-dialog mc-export-dialog">
          <TransferFeedback progress={activeTransferProgress} />

          <Dialog.Title>
            {handoff ? "交给视频剪辑工坊" : "导出镜头"}
          </Dialog.Title>
          <Dialog.Description>
            {handoff
              ? "选择已有剪辑项目，或创建一个新的剪辑项目。导出的视频会自动加入最上层画面轨道。"
              : "按需同时生成普通成片、透明视频和透明帧序列。画面没有声音。"}
          </Dialog.Description>
          {handoff ? (
            <>
              <div className="mc-target-list">
                <button aria-pressed={!target} onClick={() => setTarget("")}>
                  ＋ 新建剪辑项目
                </button>
                {targets.map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={target === item.id}
                    onClick={() => setTarget(item.id)}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
              {!target && (
                <label className="mc-field">
                  新项目名称
                  <input
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                    placeholder="例如：怪盗风格成片"
                  />
                </label>
              )}
            </>
          ) : (
            <>
              <div className="mc-export-formats">
                {(["mp4", "mov4444", "png-sequence"] as const).map((format) => (
                  <button
                    key={format}
                    aria-pressed={formats.includes(format)}
                    onClick={() =>
                      setFormats((current) =>
                        current.includes(format)
                          ? current.filter((item) => item !== format)
                          : [...current, format],
                      )
                    }
                  >
                    <span>{formats.includes(format) ? "✓" : ""}</span>
                    {FORMAT_LABEL[format]}
                  </button>
                ))}
              </div>
              <div className="mc-form-row">
                <label className="mc-field">
                  起始帧
                  <input
                    type="number"
                    min={0}
                    max={end - 1}
                    value={start}
                    onChange={(event) => setStart(Number(event.target.value))}
                  />
                </label>
                <label className="mc-field">
                  结束帧
                  <input
                    type="number"
                    min={start + 1}
                    max={document.settings.durationFrames}
                    value={end}
                    onChange={(event) => setEnd(Number(event.target.value))}
                  />
                </label>
              </div>
              <p className="mc-export-hint">
                MP4 使用画布底色 {document.settings.backgroundColor}
                ；透明格式保留实际图层的透明区域。
              </p>
              <div className="mc-task-list">
                <h3>最近导出</h3>
                {tasks.map((task) => (
                  <div className="mc-task" key={task.id}>
                    <div>
                      <strong>
                        {task.formats
                          .map(
                            (format) =>
                              FORMAT_LABEL[format as MotionFormat] ?? format,
                          )
                          .join(" · ")}
                      </strong>
                      <small>
                        {
                          {
                            queued: "排队中",
                            running: `渲染中 ${task.progress}%`,
                            completed: "已完成",
                            failed: "失败",
                            cancelled: "已取消",
                          }[task.status]
                        }
                      </small>
                    </div>
                    {task.error && <span role="alert">{task.error}</span>}
                    {task.status === "completed" && (
                      <div className="mc-task-actions">
                        {Object.keys(task.outputs).map((format) => (
                          <button
                            key={format}
                            onClick={() =>
                              void runTransfer((onProgress) =>
                                downloadExport(
                                  projectId,
                                  task.id,
                                  format as MotionFormat,
                                  { onProgress },
                                ),
                              )
                                .then((file) =>
                                  downloadProjectSnapshot(
                                    file,
                                    format === "png-sequence"
                                      ? "透明帧序列.zip"
                                      : format === "mov4444"
                                        ? "透明镜头.mov"
                                        : "完整镜头.mp4",
                                  ),
                                )
                                .catch((caught: unknown) =>
                                  setError(
                                    caught instanceof Error
                                      ? caught.message
                                      : "下载失败",
                                  ),
                                )
                            }
                          >
                            <Download size={14} />
                            {FORMAT_LABEL[format as MotionFormat]}
                          </button>
                        ))}
                        {(["mov4444", "mp4"] as const)
                          .filter((format) => task.outputs[format])
                          .map((format) => (
                            <button
                              key={`handoff-${format}`}
                              onClick={() => beginHandoff(task, format)}
                            >
                              <Film size={14} />
                              发送{format === "mov4444" ? "透明" : "普通"}镜头
                            </button>
                          ))}
                      </div>
                    )}
                    {["queued", "running"].includes(task.status) && (
                      <button
                        onClick={() =>
                          void cancelExport(projectId, task.id).then(refresh)
                        }
                      >
                        取消
                      </button>
                    )}
                  </div>
                ))}
                {!tasks.length && <p>还没有导出任务。</p>}
              </div>
            </>
          )}
          {error && (
            <div className="mc-error" role="alert">
              {error}
              <button aria-label="关闭错误提示" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          <div className="mc-dialog-actions">
            {handoff && (
              <button className="mc-secondary" onClick={() => setHandoff(null)}>
                返回导出
              </button>
            )}
            <Dialog.Close asChild>
              <button className="mc-secondary">关闭</button>
            </Dialog.Close>
            <button
              className="workshop-primary"
              disabled={
                busy ||
                (handoff
                  ? !target && !newTitle.trim()
                  : formats.length === 0 || end <= start)
              }
              onClick={() => void (handoff ? finishHandoff() : submit())}
            >
              {busy ? (
                <>
                  <RefreshCcw size={16} />
                  正在处理…
                </>
              ) : handoff ? (
                <>
                  发送到剪辑 <ArrowRight size={16} />
                </>
              ) : (
                <>
                  开始导出 <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
