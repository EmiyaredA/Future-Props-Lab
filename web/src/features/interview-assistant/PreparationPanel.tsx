import { LoadingScene } from "@shared/ui/LoadingScene";
import { LoadingState } from "@shared/ui/LoadingState";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Download,
  FolderOpen,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import {
  activeTask,
  interviewApi,
  interviewDate,
  statusLabel,
  type Room,
} from "./api";
import { interviewQueryKeys } from "./queryKeys";
import { BundleView } from "./BundleView";
import { Badge, Button, Select, Modal } from "./ui";
import { sessionFromBundle } from "./bundleSession";
import type { InterviewSession } from "./types";

export function PreparationPanel({
  room,
  scope,
  busy,
  available,
  onCancel,
  onRetry,
  onEdit,
  onStart,
  onDelete,
}: {
  room: Room;
  scope: string;
  busy: boolean;
  available: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onEdit: () => void;
  onStart: (session: InterviewSession) => void;
  onDelete: () => void;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const [version, setVersion] = useState(room.active_task_id || "");
  const [showInput, setShowInput] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [exporting, setExporting] = useState(false);
  const latest = room.tasks.find((task) => task.id === room.active_task_id);
  const task = room.tasks.find((task) => task.id === version) || latest;
  const result = useQuery({
    queryKey: interviewQueryKeys.bundle(scope, room.id, task?.id || ""),
    queryFn: () => interviewApi.bundle(room.id, task!.id),
    enabled:
      !!task &&
      !task.result &&
      ["succeeded", "needs_input"].includes(task.status),
    retry: false,
  });
  const bundle = task?.result || result.data;
  const running = activeTask(latest);
  async function download(format: "markdown" | "json") {
    if (!task) return;
    setExporting(true);
    setDownloadError("");
    try {
      const file = await runTransfer((onProgress) =>
        interviewApi.export(room.id, task.id, format, { onProgress }),
      );
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        file.filename || `面试资料.${format === "json" ? "json" : "md"}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <TransferFeedback progress={activeTransferProgress} />

      <div className="page-heading">
        <div>
          <p className="eyebrow">PREPARED WITH YOUR CONTEXT.</p>
          <h1>{task ? statusLabel[task.status] : "本场材料"}</h1>
          <p>
            {room.title} · 输入版本 {task?.input_version || 0}
          </p>
        </div>
        <div className="actions">
          <Button onClick={onEdit} disabled={busy || running}>
            <FolderOpen size={16} />
            修改材料
          </Button>
          <Button
            aria-label="删除本场面试资料"
            onClick={onDelete}
            disabled={busy || running}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      </div>
      <div className="ia-preparation-toolbar panel">
        <Select
          label="资料与任务版本"
          value={task?.id || ""}
          onChange={setVersion}
          options={room.tasks.map((item) => ({
            value: item.id,
            label: `输入 v${item.input_version} · ${statusLabel[item.status]}`,
          }))}
        />
        <Button onClick={() => setShowInput(true)}>查看输入快照与目录</Button>
        {bundle && (
          <>
            <Button
              disabled={exporting}
              onClick={() => void download("markdown")}
            >
              <Download size={15} />
              导出 Markdown
            </Button>
            <Button disabled={exporting} onClick={() => void download("json")}>
              JSON
            </Button>
          </>
        )}
      </div>
      {task && (
        <section
          className="panel ia-job-events"
          aria-label="真实准备进度"
          aria-live="polite"
        >
          <div className="section-title">
            {activeTask(task) && <LoadingScene />}
            <h2>{task.message}</h2>
            <Badge tone={task.status === "succeeded" ? "success" : ""}>
              {statusLabel[task.status]}
            </Badge>
          </div>
          {task.events.length > 0 ? (
            <ol>
              {task.events.map((event) => (
                <li key={event.sequence}>
                  <time>
                    {interviewDate(event.at).toLocaleTimeString("zh-CN")}
                  </time>
                  <span>
                    {event.message}
                    {(event.urls || [])
                      .filter((url) => /^https?:\/\//i.test(url))
                      .map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {url}
                        </a>
                      ))}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>任务已保存，等待后台执行器领取。离开此页面不会取消准备。</p>
          )}
          {running ? (
            <Button onClick={onCancel} disabled={busy}>
              <Square size={14} />
              取消准备
            </Button>
          ) : (
            <Button onClick={onRetry} disabled={busy || !available}>
              <RefreshCw size={15} />
              重新准备一个版本
            </Button>
          )}
          {latest?.id !== task.id && running && (
            <LoadingState
              label="新版本正在准备，当前查看的旧版本保持可用。"
              variant="region"
              className="field-hint"
            />
          )}
        </section>
      )}
      {(downloadError || result.error) && (
        <p className="inline-message" role="alert">
          {downloadError || result.error?.message}
        </p>
      )}
      {bundle && (
        <section className="panel ia-material-library" aria-label="本场资料">
          <BundleView bundle={bundle} />
        </section>
      )}
      {task?.status === "succeeded" && bundle && (
        <div className="page-footer">
          <p>
            练习固定使用输入 v{task.input_version}{" "}
            的三道首轮问题。音视频与复盘评估仍为模拟。
          </p>
          <Button
            variant="primary"
            onClick={() => onStart(sessionFromBundle(task, bundle))}
          >
            检查设备并进入面试
            <ArrowRight size={16} />
          </Button>
        </div>
      )}
      {showInput && task && (
        <Modal
          title="输入快照与任务边界"
          onClose={() => setShowInput(false)}
          wide
        >
          <p>
            本任务固定绑定输入 v{task.input_version}
            。读取原件与草稿通过受限工具完成，正式交付由应用校验并保存。
          </p>
          <pre className="task-code">{`input/ · 只读\n  jd\n  resume（上传原件或文字）\n  supplement（可选）\n\nwork/ · 本任务草稿读写\n\ndelivery/ · 结构化交付，由应用验收\n\ninput_hash: ${task.input_hash}`}</pre>
          <h3>岗位 JD</h3>
          <pre className="task-code">{String(task.snapshot.jd || "")}</pre>
          <h3>简历补充说明</h3>
          <pre className="task-code">
            {String(task.snapshot.resume || "使用上传原件")}
          </pre>
          <h3>原件</h3>
          {room.materials
            .filter(
              (item) =>
                item.id ===
                (task.snapshot.material as { id?: string } | null)?.id,
            )
            .map((item) => (
              <p key={item.id}>
                {item.filename} · {item.size} bytes
                <br />
                <small>SHA256：{item.sha256}</small>
              </p>
            ))}
        </Modal>
      )}
    </>
  );
}
