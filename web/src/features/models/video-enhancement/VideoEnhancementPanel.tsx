import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@generated/api";
import type { CapabilityTestModel } from "../conversation/ModelTestCapabilityPanel";
import {
  ModelTestWorkspaceHeader,
  type ModelTestMode,
} from "../workspace/ModelTestWorkspaceHeader";
import { uploadInferenceMedia } from "../localModelApi";
import { api, unwrap } from "@platform/api/client";
import { SegmentComparison } from "./SegmentComparison";
import "./video-enhancement.css";

type Task = components["schemas"]["VideoEnhancementOut"];
const statuses: Record<Task["status"], string> = {
  queued: "排队中",
  analyzing: "正在分析镜头",
  running: "正在增强",
  pausing: "正在暂停",
  paused: "已暂停",
  interrupted: "已中断",
  combining: "正在合成整片",
  completed: "已完成",
  failed: "处理失败",
};
const pausable = ["queued", "analyzing", "running", "combining"];
const resumable = ["paused", "interrupted", "failed"];
const endpoint = "/v1/model-inference/video-enhancements";
const formatSeconds = (seconds: number) => {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
};

export function VideoEnhancementPanel({
  models,
  modelId,
  onSelectMode,
  onSelectModel,
}: {
  models: CapabilityTestModel[];
  modelId: string;
  onSelectMode: (mode: ModelTestMode) => void;
  onSelectModel: (modelId: string) => void;
}) {
  const client = useQueryClient();
  const fast =
    models.find((model) => model.value === modelId)?.providerKind ===
    "local_ffmpeg";
  const key = ["video-enhancement", modelId];
  const [file, setFile] = useState<File | null>(null);
  const [selectedTask, setSelectedTask] = useState("");
  const [comparison, setComparison] = useState<number | null>(null);
  const [error, setError] = useState("");
  const submission = useRef<{ file: File; id: string; source?: string } | null>(
    null,
  );
  const query = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(
        await api.GET(endpoint, { params: { query: { model_id: modelId } } }),
      ),
    refetchInterval: 1500,
  });
  const tasks = query.data ?? [];
  const task = tasks.find((item) => item.id === selectedTask) ?? tasks[0];
  const segment = task?.segments.find((item) => item.index === comparison);
  const create = useMutation({
    mutationFn: async (input: File) => {
      if (submission.current?.file !== input)
        submission.current = { file: input, id: crypto.randomUUID() };
      const draft = submission.current;
      draft.source ??= (await uploadInferenceMedia(input)).id;
      return unwrap(
        await api.POST(endpoint, {
          body: {
            model_id: modelId,
            request_id: draft.id,
            source_id: draft.source,
          },
        }),
      );
    },
    onSuccess: (created) => {
      setSelectedTask(created.id);
      setComparison(null);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (cause) => setError(cause.message),
  });
  const control = useMutation({
    mutationFn: async ({
      action,
      current,
    }: {
      action: "pause" | "resume";
      current: Task;
    }) =>
      unwrap(
        await api.POST(
          "/v1/model-inference/video-enhancements/{task_id}/actions",
          {
            params: { path: { task_id: current.id } },
            body: { action, expected_revision: current.revision },
          },
        ),
      ),
    onError: (cause) => setError(cause.message),
    onSettled: () => void client.invalidateQueries({ queryKey: key }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || create.isPending) return;
    setError("");
    create.mutate(file);
  }

  return (
    <section className="model-test-page video-enhancement">
      <ModelTestWorkspaceHeader
        activeMode="enhancement"
        availableModes={{
          enhancement: true,
          chat: models.some((model) => model.capabilities.includes("chat")),
          image: models.some((model) =>
            model.capabilities.includes("image_generation"),
          ),
          video: models.some((model) =>
            model.capabilities.includes("video_generation"),
          ),
          synthesis: models.some((model) =>
            model.capabilities.includes("speech_synthesis"),
          ),
          speech: models.some((model) =>
            model.capabilities.includes("speech_recognition"),
          ),
          realtime_voice: models.some((model) =>
            model.capabilities.includes("voice"),
          ),
        }}
        onSelectMode={onSelectMode}
        modelId={modelId}
        modelOptions={models.filter((model) =>
          model.capabilities.includes("video_enhancement"),
        )}
        onSelectModel={onSelectModel}
      />
      <div className="video-enhancement-body">
        <h2>视频清晰度增强</h2>
        <p>
          本机自动分段处理。每段完成后可查看对比，全部完成后导出 1080p MP4。
        </p>
        {fast && <p>使用本机 FFmpeg 等比放大并轻微锐化，保留原帧率。</p>}
        <form onSubmit={submit} className="video-enhancement-controls">
          <label>
            <span>选择原片（MP4 或 MOV）</span>
            <input
              type="file"
              accept=".mp4,.mov"
              disabled={create.isPending}
              onChange={(event) =>
                setFile(event.currentTarget.files?.[0] ?? null)
              }
            />
          </label>
          <button
            className="btn primary"
            disabled={!file || create.isPending}
            type="submit"
          >
            {create.isPending ? "正在提交…" : "开始增强"}
          </button>
        </form>
        {(error || query.error) && (
          <p role="alert">{error || query.error?.message}</p>
        )}
        {tasks.length > 1 && (
          <label className="video-enhancement-task-picker">
            <span>增强任务</span>
            <select
              value={task?.id ?? ""}
              onChange={(event) => {
                setSelectedTask(event.target.value);
                setComparison(null);
                setError("");
              }}
            >
              {tasks.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.filename} · {statuses[item.status]} ·{" "}
                  {item.id.slice(-6)}
                </option>
              ))}
            </select>
          </label>
        )}
        {task && (
          <>
            <div className="video-enhancement-controls">
              <strong>{task.filename}</strong>
              <span role="status">
                {statuses[task.status]}
                {task.segments.length > 0 &&
                  ` · ${task.completed}/${task.segments.length} 段`}
              </span>
              {(pausable.includes(task.status) ||
                resumable.includes(task.status)) && (
                <button
                  className="btn"
                  type="button"
                  disabled={control.isPending}
                  onClick={() => {
                    setError("");
                    control.mutate({
                      current: task,
                      action: pausable.includes(task.status)
                        ? "pause"
                        : "resume",
                    });
                  }}
                >
                  {pausable.includes(task.status) ? "暂停" : "继续处理"}
                </button>
              )}
              {task.result_url && (
                <a
                  className="btn primary"
                  href={mediaUrl(task.result_url)}
                  download
                >
                  下载 1080p 整片
                </a>
              )}
            </div>
            {task.error_message && <p role="alert">{task.error_message}</p>}
            {segment?.original_url && segment.result_url && (
              <SegmentComparison
                key={`${task.id}:${segment.index}`}
                original={mediaUrl(segment.original_url)}
                enhanced={mediaUrl(segment.result_url)}
                enhancedLabel={fast ? "轻微锐化" : "AI 增强"}
              />
            )}
            <ol className="video-enhancement-segments" aria-label="处理片段">
              {task.segments.map((item) => (
                <li key={item.index} className="video-enhancement-controls">
                  <span>
                    第 {item.index + 1} 段 · {formatSeconds(item.start_seconds)}
                    –{formatSeconds(item.end_seconds)}
                  </span>
                  {item.result_url ? (
                    <>
                      <button
                        className="btn"
                        type="button"
                        aria-pressed={comparison === item.index}
                        onClick={() => setComparison(item.index)}
                      >
                        对比预览
                      </button>
                      <a
                        className="btn"
                        href={mediaUrl(item.result_url)}
                        download
                      >
                        下载片段
                      </a>
                    </>
                  ) : (
                    <small>
                      {item.index === task.completed &&
                      task.status === "running"
                        ? "处理中"
                        : "待处理"}
                    </small>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

function mediaUrl(path: string) {
  return `${String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "")}${path}`;
}
