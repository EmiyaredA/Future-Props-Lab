import type { CSSProperties } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Settings2,
  Video,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  VIDEO_RATIO_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
  type VideoMode,
} from "@features/visual-workshop/generation/options";
import { GenerationPromptEditor } from "@features/visual-workshop/generation/GenerationPromptEditor";
import { ProjectMediaPicker } from "@features/visual-workshop/generation/ProjectMediaPicker";
import { useGenerationDrawerController } from "@features/visual-workshop/generation/useGenerationDrawerController";

export function CompactVideoGenerationDrawer({
  controller,
}: {
  controller: ReturnType<typeof useGenerationDrawerController>;
}) {
  const modeLabels: Array<{ value: VideoMode; label: string }> = [
    { value: "text", label: "文生视频" },
    { value: "image", label: "图生视频" },
    { value: "frames", label: "首尾帧" },
    { value: "reference", label: "全能参考" },
  ];
  const {
    projectId,
    modelId,
    setModelId,
    prompt,
    setPrompt,
    videoMode,
    setVideoMode,
    duration,
    setDuration,
    resolution,
    setResolution,
    ratio,
    setRatio,
    watermark,
    setWatermark,
    generateAudio,
    setGenerateAudio,
    firstFrame,
    setFirstFrame,
    lastFrame,
    setLastFrame,
    references,
    setReferences,
    reorderImages,
    audioReferences,
    setAudioReferences,
    videoReferences,
    setVideoReferences,
    composerExpanded,
    setComposerExpanded,
    notice,
    promptAssets,
    linkedAssetIds,
    modelMenuRef,
    rememberPromptFiles,
    options,
    models,
    selectedModel,
    persistDraft,
    invalidSelection,
    createMutation,
    submit,
    hasLinkedVideoReferences,
  } = controller;
  const hasFrameReferences = firstFrame.length > 0 || lastFrame.length > 0;
  const hasOmniReferences =
    references.length > 0 ||
    videoReferences.length > 0 ||
    audioReferences.length > 0 ||
    linkedAssetIds.image.length > 0 ||
    linkedAssetIds.video.length > 0 ||
    linkedAssetIds.audio.length > 0;
  const showReferenceBar =
    videoMode !== "text" || hasFrameReferences || hasOmniReferences;
  return (
    <aside
      className={`canvas-generation-drawer is-compact video-node-composer${composerExpanded ? " is-expanded" : ""}`}
      aria-label="节点 AI 生成"
    >
      <form className="video-node-composer-form" onSubmit={submit}>
        <header className="video-composer-header">
          <nav aria-label="视频生成方式">
            {modeLabels.map((mode) => (
              <button
                type="button"
                className={videoMode === mode.value ? "active" : ""}
                aria-pressed={videoMode === mode.value}
                disabled={
                  hasLinkedVideoReferences && mode.value !== "reference"
                }
                title={
                  hasLinkedVideoReferences && mode.value !== "reference"
                    ? "存在画布连线素材时需使用全能参考"
                    : undefined
                }
                key={mode.value}
                onClick={() => {
                  setVideoMode(mode.value);
                  persistDraft({ mode: mode.value }, true);
                }}
              >
                {mode.label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            className="video-composer-close"
            aria-label={composerExpanded ? "收起视频生成器" : "展开视频生成器"}
            title={composerExpanded ? "收起" : "展开"}
            onClick={() => setComposerExpanded((current) => !current)}
          >
            {composerExpanded ? (
              <Minimize2 aria-hidden />
            ) : (
              <Maximize2 aria-hidden />
            )}
          </button>
        </header>

        <div className="video-composer-body">
          {showReferenceBar ? (
            <div
              className="video-composer-reference"
              role="group"
              aria-label="固定参考素材"
            >
              {videoMode === "image" ||
              (firstFrame.length > 0 && videoMode !== "frames") ? (
                <ProjectMediaPicker
                  projectId={projectId}
                  label="起始画面"
                  minimal
                  value={firstFrame}
                  disabled={videoMode !== "image"}
                  onChange={(value) => {
                    setFirstFrame(value);
                    persistDraft(
                      { first_frame_asset_id: value[0] ?? null },
                      true,
                    );
                  }}
                  onFilesLoaded={rememberPromptFiles}
                  onInvalidSelection={invalidSelection}
                />
              ) : null}
              {videoMode === "frames" ? (
                <>
                  <ProjectMediaPicker
                    projectId={projectId}
                    label="首帧"
                    minimal
                    value={firstFrame}
                    onChange={(value) => {
                      setFirstFrame(value);
                      persistDraft(
                        { first_frame_asset_id: value[0] ?? null },
                        true,
                      );
                    }}
                    onFilesLoaded={rememberPromptFiles}
                    onInvalidSelection={invalidSelection}
                  />
                  <ProjectMediaPicker
                    projectId={projectId}
                    label="尾帧（可选）"
                    minimal
                    value={lastFrame}
                    onChange={(value) => {
                      setLastFrame(value);
                      persistDraft(
                        { last_frame_asset_id: value[0] ?? null },
                        true,
                      );
                    }}
                    onFilesLoaded={rememberPromptFiles}
                    onInvalidSelection={invalidSelection}
                  />
                </>
              ) : null}
              {lastFrame.length > 0 && videoMode !== "frames" ? (
                <ProjectMediaPicker
                  projectId={projectId}
                  label="尾帧"
                  minimal
                  value={lastFrame}
                  disabled
                  onChange={(value) => {
                    setLastFrame(value);
                    persistDraft(
                      { last_frame_asset_id: value[0] ?? null },
                      true,
                    );
                  }}
                  onFilesLoaded={rememberPromptFiles}
                  onInvalidSelection={invalidSelection}
                />
              ) : null}
              {videoMode === "reference" || hasOmniReferences ? (
                <>
                  {videoMode === "reference" ||
                  references.length ||
                  linkedAssetIds.image.length ? (
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="参考图片"
                      onReorder={reorderImages}
                      minimal
                      value={references}
                      linkedValue={linkedAssetIds.image}
                      multiple
                      max={9}
                      disabled={videoMode !== "reference"}
                      onChange={(value) => {
                        setReferences(value);
                        persistDraft({ reference_asset_ids: value }, true);
                      }}
                      onFilesLoaded={rememberPromptFiles}
                      onInvalidSelection={invalidSelection}
                    />
                  ) : null}
                  {videoMode === "reference" ||
                  videoReferences.length ||
                  linkedAssetIds.video.length ? (
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="参考视频"
                      kind="video"
                      minimal
                      value={videoReferences}
                      linkedValue={linkedAssetIds.video}
                      multiple
                      max={3}
                      disabled={videoMode !== "reference"}
                      onChange={(value) => {
                        setVideoReferences(value);
                        persistDraft({ video_asset_ids: value }, true);
                      }}
                      onFilesLoaded={rememberPromptFiles}
                      onInvalidSelection={invalidSelection}
                    />
                  ) : null}
                  {videoMode === "reference" ||
                  audioReferences.length ||
                  linkedAssetIds.audio.length ? (
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="参考音频"
                      kind="audio"
                      minimal
                      value={audioReferences}
                      linkedValue={linkedAssetIds.audio}
                      multiple
                      max={3}
                      disabled={videoMode !== "reference"}
                      onChange={(value) => {
                        setAudioReferences(value);
                        persistDraft({ audio_asset_ids: value }, true);
                      }}
                      onFilesLoaded={rememberPromptFiles}
                      onInvalidSelection={invalidSelection}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          <div className="video-composer-prompt">
            <GenerationPromptEditor
              value={prompt}
              assets={promptAssets}
              label="视频提示词"
              placeholder="描述您的修改或生成需求…"
              canvasHistoryShortcuts
              onChange={(value) => {
                setPrompt(value);
                persistDraft({ prompt: value });
              }}
              onBlur={() => persistDraft({}, true)}
            />
          </div>
        </div>

        {notice ? (
          <div
            className="generation-notice video-composer-notice"
            role="status"
          >
            {notice}
          </div>
        ) : null}

        <footer className="video-composer-footer">
          <span className="video-composer-kind">
            <Video aria-hidden />
            视频生成
          </span>
          <details
            className="video-composer-model"
            ref={modelMenuRef}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                event.currentTarget.removeAttribute("open");
            }}
          >
            <summary
              role="button"
              aria-label="生成模型"
              aria-disabled={options.isLoading || models.length === 0}
              onClick={(event) => {
                if (options.isLoading || models.length === 0)
                  event.preventDefault();
              }}
            >
              <span>{selectedModel?.label ?? "暂无可用模型"}</span>
              <ChevronDown aria-hidden />
            </summary>
            <div className="video-model-menu" role="listbox">
              {models.map((model) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={model.id === modelId}
                  key={model.id}
                  onClick={() => {
                    setModelId(model.id);
                    persistDraft({ model_id: model.id }, true);
                    modelMenuRef.current?.removeAttribute("open");
                  }}
                >
                  {model.id === modelId ? <Check aria-hidden /> : <span />}
                  {model.label}
                </button>
              ))}
            </div>
          </details>
          <details className="video-composer-parameters">
            <summary>
              <Settings2 aria-hidden />
              {ratio} · {duration}S · {resolution.toUpperCase()}
              <ChevronDown aria-hidden />
            </summary>
            <div className="video-parameter-popover">
              <label className="video-duration-control">
                <span className="video-duration-head">
                  <span>时长</span>
                  <output>{duration} 秒</output>
                </span>
                <input
                  type="range"
                  aria-label="时长"
                  min="2"
                  max="15"
                  step="1"
                  value={duration}
                  style={
                    {
                      "--video-duration-progress": `${((duration - 2) / 13) * 100}%`,
                    } as CSSProperties
                  }
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setDuration(value);
                    persistDraft({ duration: value });
                  }}
                  onPointerUp={() => persistDraft({}, true)}
                  onBlur={() => persistDraft({}, true)}
                />
                <span className="video-duration-limits" aria-hidden="true">
                  <span>2 秒</span>
                  <span>15 秒</span>
                </span>
              </label>
              <label>
                <span>画面比例</span>
                <CustomSelect
                  ariaLabel="画面比例"
                  className="video-parameter-select"
                  value={ratio}
                  options={VIDEO_RATIO_OPTIONS}
                  onChange={(value) => {
                    const next = value as typeof ratio;
                    setRatio(next);
                    persistDraft({ ratio: next }, true);
                  }}
                />
              </label>
              <label>
                <span>清晰度</span>
                <CustomSelect
                  ariaLabel="清晰度"
                  className="video-parameter-select"
                  value={resolution}
                  options={VIDEO_RESOLUTION_OPTIONS}
                  onChange={(value) => {
                    const next = value as typeof resolution;
                    setResolution(next);
                    persistDraft({ resolution: next }, true);
                  }}
                />
              </label>
              <div className="video-parameter-switches">
                <label>
                  <input
                    type="checkbox"
                    checked={generateAudio}
                    onChange={(event) => {
                      setGenerateAudio(event.target.checked);
                      persistDraft(
                        { generate_audio: event.target.checked },
                        true,
                      );
                    }}
                  />
                  生成音频
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={watermark}
                    onChange={(event) => {
                      setWatermark(event.target.checked);
                      persistDraft({ watermark: event.target.checked }, true);
                    }}
                  />
                  保留水印
                </label>
              </div>
            </div>
          </details>
          <button
            className="video-composer-submit"
            disabled={
              createMutation.isPending ||
              !modelId ||
              (videoMode === "text" && !prompt.trim())
            }
            type="submit"
            aria-label={createMutation.isPending ? "正在提交" : "生成视频"}
          >
            {createMutation.isPending ? (
              <LoaderCircle className="spinning" aria-hidden />
            ) : (
              <ArrowUp aria-hidden />
            )}
          </button>
        </footer>
      </form>
    </aside>
  );
}
