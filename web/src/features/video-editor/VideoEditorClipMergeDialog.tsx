import { ProgressBar } from "@shared/ui/LoadingState";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { apiErrorMessage } from "@platform/api/errors";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import {
  cancelVideoEditorClipMerge,
  createVideoEditorClipMerge,
  getVideoEditorClipMerge,
} from "./api";
import { clipMergeSelection } from "./clipMerge";
import { formatTime } from "./editorModel";
import { videoEditorQueryKeys } from "./queryKeys";
import type {
  VideoEditorAsset,
  VideoEditorOperation,
  VideoEditorTask,
  VideoEditorTimeline,
} from "./types";
import "./video-editor-clip-merge.css";

export function VideoEditorClipMergeDialog({
  projectId,
  timeline,
  assets,
  clipIds,
  disabled,
  commit,
  onApplied,
  onClose,
}: {
  projectId: string;
  timeline: VideoEditorTimeline;
  assets: VideoEditorAsset[];
  clipIds: string[];
  disabled: boolean;
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
  onApplied: (clipId: string) => void;
  onClose: () => void;
}) {
  const [initial] = useState(() => ({ timeline, clipIds: [...clipIds] }));
  const selected = clipMergeSelection(
    initial.timeline,
    assets,
    initial.clipIds,
  );
  const [name, setName] = useState(() =>
    `${selected.clips[0]?.name ?? "片段"}－合并`.slice(0, 255),
  );
  const [task, setTask] = useState<VideoEditorTask>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const stopApply = useRef(false);
  const applied = useRef(false);
  const alive = useRef(true);
  const client = useQueryClient();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const poll = useQuery({
    queryKey: videoEditorQueryKeys.clipMerge(projectId, task?.id ?? ""),
    queryFn: () => getVideoEditorClipMerge(projectId, task!.id),
    enabled: Boolean(task),
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.status ?? "queued")
        ? 1000
        : false,
  });
  const current = poll.data ?? task;
  const active = current && ["queued", "running"].includes(current.status);
  const close = async () => {
    if (pending) return;
    stopApply.current = true;
    if (active && current) {
      setPending(true);
      try {
        await cancelVideoEditorClipMerge(projectId, current.id);
      } catch (cause) {
        setError(
          apiErrorMessage(cause, "取消失败，请重试；不会自动替换原片段"),
        );
        setPending(false);
        return;
      }
    }
    onClose();
  };
  const dialogRef = useDrawerFocus<HTMLElement>(
    () => void close(),
    true,
    false,
  );
  useEffect(() => {
    if (current?.status !== "completed" || applied.current || stopApply.current)
      return;
    applied.current = true;
    const newClipId = crypto.randomUUID();
    setPending(true);
    void client.invalidateQueries({
      queryKey: videoEditorQueryKeys.assets(projectId),
    });
    void commit(
      [{ type: "applyClipMerge", taskId: current.id, newClipId }],
      [{ type: "undoClipMerge", taskId: current.id, newClipId }],
    )
      .then(() => {
        if (alive.current) onApplied(newClipId);
      })
      .catch((cause) => {
        if (alive.current)
          setError(
            apiErrorMessage(cause, "替换未完成，生成素材已保留，请核对时间线"),
          );
      })
      .finally(() => {
        if (alive.current) setPending(false);
      });
  }, [client, commit, current, onApplied, projectId]);
  const start = async () => {
    if (selected.error || !name.trim() || disabled || pending) return;
    setPending(true);
    setError("");
    try {
      const created = await createVideoEditorClipMerge(projectId, {
        expectedRevision: initial.timeline.revision,
        requestId: requestId.current,
        clipIds: initial.clipIds,
        name: name.trim(),
      });
      if (alive.current) setTask(created);
    } catch (cause) {
      if (alive.current)
        setError(
          apiErrorMessage(cause, "创建合并任务失败，请核对任务列表后重试"),
        );
    } finally {
      if (alive.current) setPending(false);
    }
  };
  const durationUs = selected.clips.reduce(
    (sum, clip) => sum + clip.durationUs,
    0,
  );
  return (
    <div className="ve-dialog-backdrop ve-clip-merge-backdrop">
      <section
        ref={dialogRef}
        className="ve-clip-merge-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="合并片段"
      >
        <header>
          <h2>合并片段</h2>
          <button
            aria-label="关闭合并片段"
            disabled={pending}
            onClick={() => void close()}
          >
            <X aria-hidden />
          </button>
        </header>
        <div className="ve-clip-merge-body">
          <p>
            已选择 {selected.clips.length} 个片段 · 总时长{" "}
            {formatTime(durationUs)}
          </p>
          <p>
            按时间线顺序生成新视频，保留效果与透明区域；成功后替换原片段，可撤销。
          </p>
          <label>
            合并名称
            <input
              aria-label="合并名称"
              value={name}
              maxLength={255}
              disabled={Boolean(task) || pending}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {selected.error ? <p role="alert">{selected.error}</p> : null}
          {current ? (
            <div role="status" aria-live="polite">
              <p>
                {
                  {
                    queued: "排队中",
                    running: "正在生成",
                    completed: "生成完成",
                    failed: "生成失败",
                    cancelled: "已取消",
                  }[current.status]
                }{" "}
                · {current.progress}%
              </p>
              <ProgressBar
                value={current.progress}
                label="合并进度"
                className="ve-clip-merge-progress"
              />
              {current.status === "failed" ? (
                <p role="alert">{current.error || "合并失败，原片段未替换"}</p>
              ) : null}
            </div>
          ) : null}
          {error || poll.error ? (
            <p role="alert">
              {error || apiErrorMessage(poll.error, "读取合并进度失败")}
            </p>
          ) : null}
        </div>
        <footer>
          <button disabled={pending} onClick={() => void close()}>
            {active ? "取消合并" : "关闭"}
          </button>
          {!task ? (
            <button
              className="primary"
              disabled={
                disabled || pending || Boolean(selected.error) || !name.trim()
              }
              onClick={() => void start()}
            >
              {pending ? "提交中…" : "开始合并"}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
