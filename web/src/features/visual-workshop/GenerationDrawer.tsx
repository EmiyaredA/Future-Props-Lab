import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Check, Image, LoaderCircle, Sparkles, Video, X } from "lucide-react";
import { getFiles, getFolders, type ManagedFile } from "@features/files/api";
import {
  createGenerationTask,
  getGenerationOptions,
  type GenerationTaskInput,
} from "@features/visual-workshop/api";
import { ApiError } from "@platform/api/client";

type GenerationKind = "image" | "video";
type VideoMode = "text" | "frames" | "reference";

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.problem.detail || error.message;
  return error instanceof Error ? error.message : "创建任务失败，请稍后重试。";
}

function parseUrls(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function ProjectImagePicker({
  projectId,
  label,
  value,
  multiple = false,
  max = 1,
  onChange,
}: {
  projectId: string;
  label: string;
  value: string[];
  multiple?: boolean;
  max?: number;
  onChange: (value: string[]) => void;
}) {
  const folders = useQuery({
    queryKey: ["file-folders", projectId],
    queryFn: () => getFolders(projectId),
  });
  const folderIds = useMemo(
    () => [undefined, ...(folders.data?.items.map((item) => item.id) ?? [])],
    [folders.data],
  );
  const fileQueries = useQueries({
    queries: folderIds.map((folderId) => ({
      queryKey: ["files", projectId, folderId ?? "root", "image", true],
      queryFn: () =>
        getFiles({
          projectId,
          folderId,
          mediaKind: "image",
          includeReferences: true,
        }),
      enabled: !folders.isLoading,
    })),
  });
  const files = useMemo(() => {
    const unique = new Map<string, ManagedFile>();
    fileQueries.forEach((query) =>
      query.data?.items.forEach((file) => unique.set(file.id, file)),
    );
    return [...unique.values()].sort((left, right) =>
      left.display_name.localeCompare(right.display_name, "zh-CN"),
    );
  }, [fileQueries]);
  const loading =
    folders.isLoading || fileQueries.some((query) => query.isLoading);

  return (
    <fieldset className="generation-image-picker">
      <legend>{label}</legend>
      {loading ? (
        <span className="generation-picker-state">
          <LoaderCircle className="spinning" aria-hidden /> 正在读取项目图片…
        </span>
      ) : files.length ? (
        <div className="generation-image-options">
          {files.map((file) => {
            const selected = value.includes(file.id);
            return (
              <button
                type="button"
                className={selected ? "selected" : ""}
                aria-pressed={selected}
                key={file.id}
                onClick={() => {
                  if (!multiple) {
                    onChange(selected ? [] : [file.id]);
                    return;
                  }
                  if (selected)
                    onChange(value.filter((item) => item !== file.id));
                  else if (value.length < max) onChange([...value, file.id]);
                }}
              >
                <Image aria-hidden />
                <span>{file.display_name}</span>
                {selected ? <Check aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <span className="generation-picker-state">项目素材库中暂无图片</span>
      )}
      {multiple ? (
        <small>
          已选 {value.length}/{max} 张
        </small>
      ) : null}
    </fieldset>
  );
}

export function GenerationDrawer({
  projectId,
  onClose,
  lockedKind,
  onTaskCreated,
  compact = false,
}: {
  projectId: string;
  onClose: () => void;
  lockedKind?: GenerationKind;
  onTaskCreated?: (
    task: Awaited<ReturnType<typeof createGenerationTask>>,
  ) => void;
  compact?: boolean;
}) {
  const client = useQueryClient();
  const [kind, setKind] = useState<GenerationKind>(lockedKind ?? "image");
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [seed, setSeed] = useState("");
  const [imageReference, setImageReference] = useState<string[]>([]);
  const [videoMode, setVideoMode] = useState<VideoMode>("text");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState<"480p" | "720p" | "1080p">(
    "720p",
  );
  const [ratio, setRatio] = useState<"16:9" | "9:16" | "4:3" | "3:4" | "1:1">(
    "16:9",
  );
  const [watermark, setWatermark] = useState(true);
  const [generateAudio, setGenerateAudio] = useState(false);
  const [firstFrame, setFirstFrame] = useState<string[]>([]);
  const [lastFrame, setLastFrame] = useState<string[]>([]);
  const [references, setReferences] = useState<string[]>([]);
  const [audioUrls, setAudioUrls] = useState("");
  const [videoUrls, setVideoUrls] = useState("");
  const [notice, setNotice] = useState("");
  const options = useQuery({
    queryKey: ["visual-generation-options"],
    queryFn: getGenerationOptions,
  });
  const models = (options.data?.models ?? []).filter(
    (model) => model.kind === kind,
  );
  const selectedModel = models.find((model) => model.id === modelId);

  useEffect(() => {
    const preferred = models.find((model) =>
      kind === "image"
        ? model.slug === "senseaudio-image-2.0-260319"
        : model.slug === "doubao-seedance-2-0-260128",
    );
    if (!models.some((model) => model.id === modelId))
      setModelId(preferred?.id ?? models[0]?.id ?? "");
  }, [kind, modelId, models]);
  useEffect(() => {
    if (
      kind === "image" &&
      selectedModel?.sizes?.length &&
      !selectedModel.sizes.includes(size)
    )
      setSize(
        selectedModel.sizes.includes("1024x1024")
          ? "1024x1024"
          : selectedModel.sizes[0],
      );
  }, [kind, selectedModel, size]);

  const createMutation = useMutation({
    mutationFn: (body: GenerationTaskInput) =>
      createGenerationTask(projectId, body),
    onSuccess: (task) => {
      setNotice(
        `任务已提交（${task.id.slice(0, 8)}），可在“生成任务”页查看进度。`,
      );
      void client.invalidateQueries({ queryKey: ["visual-generation-tasks"] });
      onTaskCreated?.(task);
    },
    onError: (error) => setNotice(errorMessage(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice("");
    if (!modelId) {
      setNotice("请先在模型服务中启用对应的 SenseAudio 供应商和模型。");
      return;
    }
    if (kind === "image") {
      createMutation.mutate({
        kind: "image",
        model_id: modelId,
        prompt,
        size,
        seed: seed === "" ? null : Number(seed),
        reference_asset_id: imageReference[0] ?? null,
      });
      return;
    }
    createMutation.mutate({
      kind: "video",
      model_id: modelId,
      prompt,
      mode: videoMode,
      duration,
      resolution,
      ratio,
      watermark,
      generate_audio: generateAudio,
      first_frame_asset_id:
        videoMode === "frames" ? (firstFrame[0] ?? null) : null,
      last_frame_asset_id:
        videoMode === "frames" ? (lastFrame[0] ?? null) : null,
      reference_asset_ids: videoMode === "reference" ? references : [],
      audio_urls: videoMode === "reference" ? parseUrls(audioUrls) : [],
      video_urls: videoMode === "reference" ? parseUrls(videoUrls) : [],
    });
  };

  return (
    <aside
      className={`canvas-generation-drawer${compact ? " is-compact" : ""}`}
      aria-label={lockedKind ? "节点 AI 生成" : "AI 生成"}
    >
      <header>
        <div>
          <strong>AI 生成</strong>
          <small>由 SenseAudio 异步生成，完成后自动进入素材库</small>
        </div>
        <button aria-label="关闭 AI 生成" onClick={onClose}>
          <X aria-hidden />
        </button>
      </header>
      {!lockedKind ? (
        <div className="generation-kind-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={kind === "image"}
            className={kind === "image" ? "active" : ""}
            onClick={() => setKind("image")}
          >
            <Image aria-hidden /> 图片
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "video"}
            className={kind === "video" ? "active" : ""}
            onClick={() => setKind("video")}
          >
            <Video aria-hidden /> 视频
          </button>
        </div>
      ) : null}
      <form className="generation-form" onSubmit={submit}>
        <label>
          <span>模型</span>
          <select
            aria-label="生成模型"
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            disabled={options.isLoading}
          >
            {!models.length ? <option value="">暂无可用模型</option> : null}
            {models.map((model) => (
              <option value={model.id} key={model.id}>
                {model.label}
              </option>
            ))}
          </select>
          {selectedModel?.description ? (
            <small>{selectedModel.description}</small>
          ) : null}
        </label>
        <label>
          <span>提示词</span>
          <textarea
            required={kind === "image" || videoMode === "text"}
            maxLength={6000}
            rows={5}
            placeholder={
              kind === "image" ? "描述要生成的画面…" : "描述镜头、动作和氛围…"
            }
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        {kind === "image" ? (
          <>
            <div className="generation-form-grid">
              <label>
                <span>尺寸</span>
                <select
                  value={size}
                  onChange={(event) => setSize(event.target.value)}
                >
                  {(selectedModel?.sizes ?? []).map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>种子（可选）</span>
                <input
                  type="number"
                  min="0"
                  placeholder="随机"
                  value={seed}
                  onChange={(event) => setSeed(event.target.value)}
                />
              </label>
            </div>
            <ProjectImagePicker
              projectId={projectId}
              label="参考图片（可选）"
              value={imageReference}
              onChange={setImageReference}
            />
          </>
        ) : (
          <>
            <div className="generation-form-grid generation-form-grid-three">
              <label>
                <span>时长</span>
                <select
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                >
                  {Array.from({ length: 12 }, (_, index) => index + 4).map(
                    (value) => (
                      <option value={value} key={value}>
                        {value} 秒
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
              <label>
                <span>比例</span>
                <select
                  value={ratio}
                  onChange={(event) =>
                    setRatio(event.target.value as typeof ratio)
                  }
                >
                  {(["16:9", "9:16", "4:3", "3:4", "1:1"] as const).map(
                    (value) => (
                      <option value={value} key={value}>
                        {value}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <fieldset className="generation-mode-options">
              <legend>输入方式</legend>
              {(["text", "frames", "reference"] as const).map((value) => (
                <button
                  type="button"
                  className={videoMode === value ? "selected" : ""}
                  aria-pressed={videoMode === value}
                  key={value}
                  onClick={() => setVideoMode(value)}
                >
                  {value === "text"
                    ? "纯文本"
                    : value === "frames"
                      ? "首尾帧"
                      : "参考素材"}
                </button>
              ))}
            </fieldset>
            {videoMode === "frames" ? (
              <>
                <ProjectImagePicker
                  projectId={projectId}
                  label="首帧（必选）"
                  value={firstFrame}
                  onChange={setFirstFrame}
                />
                <ProjectImagePicker
                  projectId={projectId}
                  label="尾帧（可选）"
                  value={lastFrame}
                  onChange={setLastFrame}
                />
              </>
            ) : null}
            {videoMode === "reference" ? (
              <>
                <ProjectImagePicker
                  projectId={projectId}
                  label="参考图片"
                  value={references}
                  multiple
                  max={9}
                  onChange={setReferences}
                />
                <label>
                  <span>参考音频 HTTPS URL（最多 3 个）</span>
                  <textarea
                    rows={2}
                    value={audioUrls}
                    onChange={(event) => setAudioUrls(event.target.value)}
                    placeholder="每行一个公网 HTTPS 地址"
                  />
                </label>
                <label>
                  <span>参考视频 HTTPS URL（最多 3 个）</span>
                  <textarea
                    rows={2}
                    value={videoUrls}
                    onChange={(event) => setVideoUrls(event.target.value)}
                    placeholder="每行一个公网 HTTPS 地址"
                  />
                </label>
              </>
            ) : null}
            <div className="generation-switches">
              <label>
                <input
                  type="checkbox"
                  checked={watermark}
                  onChange={(event) => setWatermark(event.target.checked)}
                />{" "}
                保留水印
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={generateAudio}
                  onChange={(event) => setGenerateAudio(event.target.checked)}
                />{" "}
                生成音频
              </label>
            </div>
          </>
        )}
        {notice ? (
          <div className="generation-notice" role="status">
            {notice}
          </div>
        ) : null}
        <button
          className="generation-submit"
          disabled={createMutation.isPending || !modelId}
          type="submit"
        >
          {createMutation.isPending ? (
            <LoaderCircle className="spinning" aria-hidden />
          ) : (
            <Sparkles aria-hidden />
          )}
          {createMutation.isPending ? "正在提交…" : "创建生成任务"}
        </button>
      </form>
    </aside>
  );
}
