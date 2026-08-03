import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Image,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { CustomSelect, type SelectOption } from "@shared/ui/CustomSelect";
import {
  createModelTestGenerationTask,
  deleteModelTestGenerationTask,
  getModelTestGenerationOptions,
  getModelTestGenerationResult,
  getModelTestGenerationTasks,
  retryModelTestGenerationMaterialization,
  type ModelTestGenerationTask,
} from "@features/models/api";

type TestModel = {
  value: string;
  label: string;
  description: string;
  providerKind:
    "openai" | "anthropic" | "senseaudio_image" | "senseaudio_video";
};

const statusLabel: Record<ModelTestGenerationTask["status"], string> = {
  queued: "等待提交",
  submitting: "正在提交",
  pending: "等待生成",
  processing: "生成中",
  completed: "已完成",
  failed: "失败",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ModelGenerationTestPanel({
  models,
  modelId,
  onSelectModel,
}: {
  models: TestModel[];
  modelId: string;
  onSelectModel: (modelId: string) => void;
}) {
  const client = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("");
  const [seed, setSeed] = useState("");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState<"480p" | "720p" | "1080p">(
    "720p",
  );
  const [ratio, setRatio] = useState<"16:9" | "9:16" | "4:3" | "3:4" | "1:1">(
    "16:9",
  );
  const [watermark, setWatermark] = useState(true);
  const [generateAudio, setGenerateAudio] = useState(false);
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const optionsQuery = useQuery({
    queryKey: ["model-test-generation-options"],
    queryFn: getModelTestGenerationOptions,
  });
  const selectedOption = optionsQuery.data?.items.find(
    (item) => item.id === modelId,
  );
  const kind = selectedOption?.kind ?? "image";
  const tasksQuery = useQuery({
    queryKey: ["model-test-generation-tasks", modelId],
    queryFn: () => getModelTestGenerationTasks(modelId),
    refetchInterval: (query) =>
      query.state.data?.items.some((task) =>
        ["queued", "submitting", "pending", "processing"].includes(task.status),
      )
        ? 5000
        : false,
  });
  const tasks = tasksQuery.data?.items ?? [];
  const activeTask = tasks.find((task) => task.id === activeId) ?? tasks[0];

  useEffect(() => {
    setActiveId(null);
    setPrompt("");
    setError("");
  }, [modelId]);
  useEffect(() => {
    const sizes = selectedOption?.sizes ?? [];
    if (kind !== "image" || !sizes.length) return;
    if (!sizes.includes(size)) {
      setSize(sizes.includes("1024x1024") ? "1024x1024" : sizes[0]);
    }
  }, [kind, selectedOption, size]);
  useEffect(() => {
    let objectUrl = "";
    setResultUrl("");
    if (!activeTask?.result_available) return;
    void getModelTestGenerationResult(activeTask.id)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setResultUrl(objectUrl);
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeTask?.id, activeTask?.result_available]);

  const refresh = async () => {
    await Promise.all([
      tasksQuery.refetch(),
      client.invalidateQueries({ queryKey: ["model-logs"] }),
    ]);
  };
  const createMutation = useMutation({
    mutationFn: () =>
      kind === "image"
        ? createModelTestGenerationTask({
            kind: "image",
            model_id: modelId,
            prompt: prompt.trim(),
            size,
            seed: seed === "" ? null : Number(seed),
          })
        : createModelTestGenerationTask({
            kind: "video",
            model_id: modelId,
            prompt: prompt.trim(),
            duration,
            resolution,
            ratio,
            watermark,
            generate_audio: generateAudio,
          }),
    onSuccess: async (task) => {
      setActiveId(task.id);
      setPrompt("");
      setError("");
      await refresh();
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
  });
  const removeMutation = useMutation({
    mutationFn: (task: ModelTestGenerationTask) =>
      deleteModelTestGenerationTask(task.id, task.revision),
    onSuccess: async () => {
      setActiveId(null);
      await refresh();
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
  });
  const retryMutation = useMutation({
    mutationFn: (taskId: string) =>
      retryModelTestGenerationMaterialization(taskId),
    onSuccess: refresh,
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
  });

  const modelOptions: SelectOption[] = useMemo(
    () =>
      models.map((model) => ({
        value: model.value,
        label: model.label,
        description: model.description,
      })),
    [models],
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    createMutation.mutate();
  };

  return (
    <section className="model-test-page generation-test-page">
      <header className="playground-header generation-test-header">
        <div>
          <h1>模型测试</h1>
          <p>按模型类型测试对话、图片与视频生成能力。</p>
        </div>
        <label className="generation-model-select">
          <span>测试模型</span>
          <CustomSelect
            ariaLabel="测试模型"
            value={modelId}
            options={modelOptions}
            onChange={onSelectModel}
          />
        </label>
      </header>
      {error ? (
        <div className="inline-alert danger playground-alert" role="alert">
          {error}
          <button aria-label="关闭提示" onClick={() => setError("")}>
            ×
          </button>
        </div>
      ) : null}
      <div className="generation-test-grid">
        <aside className="generation-test-history">
          <div className="panel-heading">
            <strong>
              {kind === "image" ? "图片测试记录" : "视频测试记录"}
            </strong>
          </div>
          <div className="generation-test-task-list">
            {tasks.map((task) => (
              <button
                className={task.id === activeTask?.id ? "active" : ""}
                key={task.id}
                onClick={() => setActiveId(task.id)}
              >
                {task.kind === "image" ? (
                  <Image aria-hidden />
                ) : (
                  <Video aria-hidden />
                )}
                <span>
                  <strong>
                    {String(task.request_payload.prompt || "未命名测试")}
                  </strong>
                  <small>
                    {statusLabel[task.status]} · {formatTime(task.created_at)}
                  </small>
                </span>
              </button>
            ))}
            {!tasks.length ? (
              <p className="conversation-empty">还没有测试记录</p>
            ) : null}
          </div>
        </aside>
        <main className="generation-test-result">
          {activeTask ? (
            <>
              <div className="generation-result-head">
                <div>
                  <strong>{activeTask.model_slug}</strong>
                  <span className={`generation-status ${activeTask.status}`}>
                    {statusLabel[activeTask.status]}
                    {activeTask.status === "processing"
                      ? ` ${activeTask.progress}%`
                      : ""}
                  </span>
                </div>
                {!(
                  ["queued", "submitting", "pending", "processing"] as string[]
                ).includes(activeTask.status) ? (
                  <button
                    aria-label="删除测试记录"
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(activeTask)}
                  >
                    <Trash2 aria-hidden />
                  </button>
                ) : null}
              </div>
              <div className="generation-result-stage">
                {resultUrl && activeTask.kind === "image" ? (
                  <img
                    src={resultUrl}
                    alt={String(
                      activeTask.request_payload.prompt || "生成图片",
                    )}
                  />
                ) : null}
                {resultUrl && activeTask.kind === "video" ? (
                  <video src={resultUrl} controls />
                ) : null}
                {!resultUrl && activeTask.status !== "failed" ? (
                  <div className="generation-result-pending">
                    <LoaderCircle className="spinning" aria-hidden />
                    <strong>{statusLabel[activeTask.status]}</strong>
                    <span>任务会在后台继续执行，刷新页面也不会丢失。</span>
                  </div>
                ) : null}
                {activeTask.status === "failed" ? (
                  <div className="generation-result-pending failed">
                    <strong>生成失败</strong>
                    <span>{activeTask.error_message}</span>
                    {activeTask.can_retry_materialization ? (
                      <button
                        onClick={() => retryMutation.mutate(activeTask.id)}
                      >
                        <RotateCcw aria-hidden /> 重试保存结果
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <p className="generation-result-prompt">
                {String(activeTask.request_payload.prompt || "")}
              </p>
            </>
          ) : (
            <div className="generation-result-pending">
              {kind === "image" ? <Image aria-hidden /> : <Video aria-hidden />}
              <strong>开始一次{kind === "image" ? "图片" : "视频"}测试</strong>
              <span>提交后可以在这里查看任务进度和生成结果。</span>
            </div>
          )}
        </main>
        <aside className="generation-test-settings">
          <div className="panel-heading">
            <strong>测试参数</strong>
          </div>
          <form onSubmit={submit}>
            <label>
              <span>提示词</span>
              <textarea
                required
                maxLength={6000}
                rows={7}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  kind === "image"
                    ? "描述要生成的画面…"
                    : "描述镜头、动作和氛围…"
                }
              />
            </label>
            {kind === "image" ? (
              <>
                <label>
                  <span>尺寸</span>
                  <select
                    value={size}
                    onChange={(event) => setSize(event.target.value)}
                  >
                    {(selectedOption?.sizes ?? []).map((item) => (
                      <option value={item} key={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>种子（可选）</span>
                  <input
                    type="number"
                    min="0"
                    value={seed}
                    onChange={(event) => setSeed(event.target.value)}
                    placeholder="随机"
                  />
                </label>
              </>
            ) : (
              <>
                <div className="generation-test-form-row">
                  <label>
                    <span>时长</span>
                    <select
                      value={duration}
                      onChange={(event) =>
                        setDuration(Number(event.target.value))
                      }
                    >
                      {Array.from({ length: 12 }, (_, index) => index + 4).map(
                        (item) => (
                          <option key={item} value={item}>
                            {item} 秒
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    <span>分辨率</span>
                    <select
                      value={resolution}
                      onChange={(event) =>
                        setResolution(event.target.value as typeof resolution)
                      }
                    >
                      <option value="480p">480p</option>
                      <option value="720p">720p</option>
                      <option value="1080p">1080p</option>
                    </select>
                  </label>
                </div>
                <label>
                  <span>比例</span>
                  <select
                    value={ratio}
                    onChange={(event) =>
                      setRatio(event.target.value as typeof ratio)
                    }
                  >
                    {(["16:9", "9:16", "4:3", "3:4", "1:1"] as const).map(
                      (item) => (
                        <option value={item} key={item}>
                          {item}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={watermark}
                    onChange={(event) => setWatermark(event.target.checked)}
                  />
                  <span>保留水印</span>
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={generateAudio}
                    onChange={(event) => setGenerateAudio(event.target.checked)}
                  />
                  <span>生成音频</span>
                </label>
              </>
            )}
            <button
              className="generation-test-submit"
              disabled={createMutation.isPending || !prompt.trim()}
            >
              {createMutation.isPending ? (
                <LoaderCircle className="spinning" aria-hidden />
              ) : (
                <Sparkles aria-hidden />
              )}
              {createMutation.isPending ? "正在提交…" : "开始测试"}
            </button>
          </form>
        </aside>
      </div>
    </section>
  );
}
