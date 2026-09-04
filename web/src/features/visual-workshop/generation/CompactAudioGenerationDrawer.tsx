import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  LoaderCircle,
  Music,
  Sparkles,
  Waves,
  X,
} from "lucide-react";
import { ProjectMediaPicker } from "./ProjectMediaPicker";
import {
  createGenerationTask,
  getGenerationOptions,
  type GenerationTaskInput,
  type VisualCanvasAudioGenerationDraft,
} from "@features/visual-workshop/api";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import { apiErrorMessage } from "@platform/api/errors";
import type { GenerationDrawerProps } from "./generationDrawerTypes";

export function CompactAudioGenerationDrawer({
  projectId,
  canvasNodeId,
  draft,
  onDraftChange,
  onBeforeSubmit,
  onTaskCreated,
  onClose,
  linkedAssetIds = { image: [], video: [], audio: [] },
}: GenerationDrawerProps) {
  const audioDraft = draft as
    VisualCanvasAudioGenerationDraft | null | undefined;
  const client = useQueryClient();
  const [mode, setMode] = useState<"music" | "sfx">(
    audioDraft?.mode ?? "music",
  );
  const [modelId, setModelId] = useState(audioDraft?.model_id ?? "");
  const [prompt, setPrompt] = useState(audioDraft?.prompt ?? "");
  const [theme, setTheme] = useState(audioDraft?.theme ?? "");
  const [style, setStyle] = useState(audioDraft?.style ?? "");
  const [duration, setDuration] = useState(audioDraft?.duration ?? 15);
  const [smartDuration, setSmartDuration] = useState(
    audioDraft?.smart_duration ?? true,
  );
  const [influence, setInfluence] = useState(
    audioDraft?.prompt_influence ?? 0.5,
  );
  const [format, setFormat] = useState<"mp3" | "wav">(
    audioDraft?.output_format ?? "mp3",
  );
  const [references, setReferences] = useState(
    audioDraft?.reference_asset_ids ?? [],
  );
  const [notice, setNotice] = useState("");
  const options = useQuery({
    queryKey: visualWorkshopQueryKeys.generationOptions,
    queryFn: getGenerationOptions,
  });
  const models = (options.data?.models ?? []).filter(
    (model) =>
      model.kind === "audio" &&
      (mode === "music"
        ? model.slug.includes("music")
        : model.slug.includes("sfx")),
  );
  useEffect(() => {
    const next = audioDraft?.reference_asset_ids ?? [];
    setReferences((current) =>
      current.length === next.length &&
      current.every((id, index) => id === next[index])
        ? current
        : next,
    );
  }, [audioDraft?.reference_asset_ids]);
  useEffect(() => {
    if (models.some((model) => model.id === modelId)) return;
    setModelId(models[0]?.id ?? "");
  }, [modelId, models]);
  const saveDraft = (immediate = false, nextMode = mode) => {
    onDraftChange?.(
      {
        model_id: modelId || null,
        mode: nextMode,
        prompt,
        theme,
        style,
        duration,
        smart_duration: smartDuration,
        prompt_influence: influence,
        output_format: format,
        reference_asset_ids: references,
      },
      immediate,
    );
  };
  const create = useMutation({
    mutationFn: async (body: GenerationTaskInput) =>
      createGenerationTask(projectId, body),
    onSuccess: async (task) => {
      await onTaskCreated?.(task);
      setNotice(`任务已提交（${task.id.slice(0, 8)}）`);
      void client.invalidateQueries({
        queryKey: visualWorkshopQueryKeys.generationTasks,
      });
    },
    onError: (error) =>
      setNotice(apiErrorMessage(error, "创建音频生成任务失败，请稍后重试。")),
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!modelId) {
      setNotice("请先配置并启用对应的音频生成供应商。");
      return;
    }
    if (!prompt.trim()) {
      setNotice("请输入音乐或音效描述。");
      return;
    }
    saveDraft(true);
    try {
      const revision = await onBeforeSubmit?.();
      create.mutate({
        kind: "audio",
        model_id: modelId,
        mode,
        prompt: prompt.trim(),
        theme,
        style,
        duration,
        smart_duration: smartDuration,
        prompt_influence: influence,
        output_format: format,
        reference_asset_ids: mode === "music" ? references : [],
        ...(canvasNodeId && typeof revision === "number"
          ? {
              canvas_node_id: canvasNodeId,
              expected_canvas_revision: revision,
            }
          : {}),
      });
    } catch (error) {
      setNotice(apiErrorMessage(error, "保存画布失败，请重试。"));
    }
  };

  return (
    <form className="audio-generation-composer" onSubmit={submit}>
      <header>
        <nav role="tablist">
          <button
            type="button"
            className={mode === "music" ? "active" : ""}
            onClick={() => {
              setMode("music");
              saveDraft(true, "music");
            }}
          >
            <Music aria-hidden /> 音乐生成
          </button>
          <button
            type="button"
            className={mode === "sfx" ? "active" : ""}
            onClick={() => {
              setMode("sfx");
              saveDraft(true, "sfx");
            }}
          >
            <Waves aria-hidden /> 音效生成
          </button>
        </nav>
        <button type="button" aria-label="折叠生成面板" onClick={onClose}>
          <X aria-hidden />
        </button>
      </header>
      <div className="audio-generation-reference-stack">
        {mode === "music" ||
        references.length ||
        linkedAssetIds.audio.length ? (
          <div className="audio-generation-references">
            <strong>参考音频</strong>
            <ProjectMediaPicker
              projectId={projectId}
              label="参考音频"
              kind="audio"
              value={references}
              multiple
              max={3}
              minimal
              uploadLast
              disabled={mode !== "music"}
              linkedValue={linkedAssetIds.audio}
              onChange={setReferences}
            />
          </div>
        ) : null}
      </div>
      <div className="audio-generation-editor">
        <textarea
          maxLength={6000}
          value={prompt}
          placeholder={
            mode === "music"
              ? "描述 BGM 的情绪、节奏、乐器与使用场景…"
              : "描述需要的音效，例如：雨夜中远处驶过的列车…"
          }
          onChange={(event) => setPrompt(event.target.value)}
          onBlur={() => saveDraft()}
        />
        {mode === "music" ? (
          <div className="audio-generation-meta">
            <input
              value={theme}
              placeholder="主题（可选）"
              onChange={(event) => setTheme(event.target.value)}
            />
            <input
              value={style}
              placeholder="风格（可选）"
              onChange={(event) => setStyle(event.target.value)}
            />
          </div>
        ) : null}
      </div>
      <footer>
        <details className="audio-model-choice">
          <summary>
            {models.find((model) => model.id === modelId)?.label ?? "选择模型"}
            <ChevronDown aria-hidden />
          </summary>
          <div>
            {models.map((model) => (
              <button
                type="button"
                key={model.id}
                onClick={(event) => {
                  setModelId(model.id);
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                }}
              >
                {model.label}
              </button>
            ))}
          </div>
        </details>
        <label>
          时长 {duration}s
          <input
            type="range"
            min={1}
            max={mode === "sfx" ? 10 : 180}
            value={duration}
            disabled={mode === "sfx" && smartDuration}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
        </label>
        {mode === "sfx" ? (
          <button
            type="button"
            className={smartDuration ? "active" : ""}
            onClick={() => setSmartDuration((value) => !value)}
          >
            智能时长
          </button>
        ) : null}
        {mode === "sfx" ? (
          <label>
            提示词影响 {Math.round(influence * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={influence}
              onChange={(event) => setInfluence(Number(event.target.value))}
            />
          </label>
        ) : null}
        <div className="audio-format-options">
          {(["mp3", "wav"] as const).map((item) => (
            <button
              type="button"
              className={format === item ? "active" : ""}
              key={item}
              onClick={() => setFormat(item as typeof format)}
            >
              {item.toUpperCase()}
            </button>
          ))}
        </div>
        {notice ? <span role="status">{notice}</span> : null}
        <button className="audio-generate-submit" disabled={create.isPending}>
          {create.isPending ? (
            <LoaderCircle className="spinning" aria-hidden />
          ) : (
            <Sparkles aria-hidden />
          )}
          生成
        </button>
      </footer>
    </form>
  );
}
