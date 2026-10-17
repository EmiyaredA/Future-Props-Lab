import { useState, type CSSProperties } from "react";
import {
  ArrowUp,
  ChevronDown,
  Maximize2,
  Minimize2,
  Settings2,
  Video,
} from "lucide-react";
import { WorkflowVideoControls } from "@features/models";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  VIDEO_RATIO_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
  type VideoMode,
} from "@features/visual-workshop/generation/options";
import { GenerationPromptEditor } from "@features/visual-workshop/generation/GenerationPromptEditor";
import { PromptVersionControls } from "./PromptVersionControls";
import { GenerationSpinner } from "./GenerationActivity";
import { ProjectMediaPicker } from "@features/visual-workshop/generation/ProjectMediaPicker";
import { ReferenceDropNotice } from "@features/visual-workshop/generation/ReferenceDropNotice";
import { useGenerationDrawerController } from "@features/visual-workshop/generation/useGenerationDrawerController";
import {
  useProjectReferenceDrop,
  type ReferenceDropNotice as ReferenceDropNoticeState,
} from "./useProjectReferenceDrop";

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
    rememberPromptFiles,
    options,
    models,
    workflowCapabilities,
    referenceLimits,
    persistDraft,
    invalidSelection,
    createMutation,
    generating,
    submit,
    hasLinkedVideoReferences,
  } = controller;
  const minimumDuration = workflowCapabilities ? 4 : 2;
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
  const changeImages = (value: string[]) => {
    setReferences(value);
    persistDraft({ reference_asset_ids: value }, true);
  };
  const changeVideos = (value: string[]) => {
    setVideoReferences(value);
    persistDraft({ video_asset_ids: value }, true);
  };
  const changeAudio = (value: string[]) => {
    setAudioReferences(value);
    persistDraft({ audio_asset_ids: value }, true);
  };
  const [dropNotice, setDropNotice] = useState<ReferenceDropNoticeState | null>(
    null,
  );
  const referenceDrop = useProjectReferenceDrop({
    projectId,
    files: controller.availableReferenceFiles,
    excludedAssetIds: controller.excludedAssetIds,
    onResult: setDropNotice,
    selections: [
      {
        kind: "image",
        value: references,
        linkedValue: linkedAssetIds.image,
        multiple: true,
        max: referenceLimits.image,
        disabled: videoMode !== "reference",
        onChange: changeImages,
      },
      {
        kind: "video",
        value: videoReferences,
        linkedValue: linkedAssetIds.video,
        multiple: true,
        max: referenceLimits.video,
        disabled: videoMode !== "reference",
        onChange: changeVideos,
      },
      {
        kind: "audio",
        value: audioReferences,
        linkedValue: linkedAssetIds.audio,
        multiple: true,
        max: referenceLimits.audio,
        disabled: videoMode !== "reference",
        onChange: changeAudio,
      },
    ],
  });
  return (
    <aside
      className={`canvas-generation-drawer is-compact video-node-composer${composerExpanded ? " is-expanded" : ""}`}
      aria-label="节点 AI 生成"
    >
      <form className="video-node-composer-form" onSubmit={submit}>
        <header className="video-composer-header">
          <nav aria-label="视频生成方式">
            {modeLabels
              .filter(
                (mode) =>
                  !workflowCapabilities ||
                  mode.value === "text" ||
                  mode.value === "reference",
              )
              .map((mode) => (
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
              className={`video-composer-reference${referenceDrop.active ? " is-reference-dragover" : ""}`}
              {...referenceDrop.handlers}
              onDragOverCapture={
                videoMode === "reference"
                  ? referenceDrop.handlers.onDragOver
                  : undefined
              }
              onDropCapture={
                videoMode === "reference"
                  ? referenceDrop.handlers.onDrop
                  : undefined
              }
              role="group"
              aria-label="固定参考素材"
            >
              {videoMode === "image" ||
              (firstFrame.length > 0 && videoMode !== "frames") ? (
                <ProjectMediaPicker
                  excludedAssetIds={controller.excludedAssetIds}
                  onDropResult={setDropNotice}
                  projectId={projectId}
                  label="起始画面"
                  minimal
                  showLabel={controller.layout === "workbench"}
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
                    excludedAssetIds={controller.excludedAssetIds}
                    onDropResult={setDropNotice}
                    projectId={projectId}
                    label="首帧"
                    minimal
                    showLabel={controller.layout === "workbench"}
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
                    excludedAssetIds={controller.excludedAssetIds}
                    onDropResult={setDropNotice}
                    projectId={projectId}
                    label="尾帧（可选）"
                    minimal
                    showLabel={controller.layout === "workbench"}
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
                  excludedAssetIds={controller.excludedAssetIds}
                  onDropResult={setDropNotice}
                  projectId={projectId}
                  label="尾帧"
                  minimal
                  showLabel={controller.layout === "workbench"}
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
                      excludedAssetIds={controller.excludedAssetIds}
                      onDropResult={setDropNotice}
                      projectId={projectId}
                      label="参考图片"
                      onReorder={reorderImages}
                      minimal
                      showLabel={controller.layout === "workbench"}
                      value={references}
                      linkedValue={linkedAssetIds.image}
                      multiple
                      max={referenceLimits.image}
                      disabled={videoMode !== "reference"}
                      onChange={changeImages}
                      onFilesLoaded={rememberPromptFiles}
                      onInvalidSelection={invalidSelection}
                    />
                  ) : null}
                  {(videoMode === "reference" && referenceLimits.video > 0) ||
                  videoReferences.length ||
                  linkedAssetIds.video.length ? (
                    <ProjectMediaPicker
                      excludedAssetIds={controller.excludedAssetIds}
                      onDropResult={setDropNotice}
                      projectId={projectId}
                      label="参考视频"
                      kind="video"
                      minimal
                      showLabel={controller.layout === "workbench"}
                      value={videoReferences}
                      linkedValue={linkedAssetIds.video}
                      multiple
                      max={referenceLimits.video}
                      disabled={videoMode !== "reference"}
                      onChange={changeVideos}
                      onFilesLoaded={rememberPromptFiles}
                      onInvalidSelection={invalidSelection}
                    />
                  ) : null}
                  {videoMode === "reference" ||
                  audioReferences.length ||
                  linkedAssetIds.audio.length ? (
                    <ProjectMediaPicker
                      excludedAssetIds={controller.excludedAssetIds}
                      onDropResult={setDropNotice}
                      projectId={projectId}
                      label="参考音频"
                      kind="audio"
                      minimal
                      showLabel={controller.layout === "workbench"}
                      value={audioReferences}
                      linkedValue={linkedAssetIds.audio}
                      multiple
                      max={referenceLimits.audio}
                      disabled={videoMode !== "reference"}
                      onChange={changeAudio}
                      onFilesLoaded={rememberPromptFiles}
                      onInvalidSelection={invalidSelection}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          <ReferenceDropNotice notice={dropNotice} />
          <div className="video-composer-prompt">
            {controller.promptVersions && (
              <PromptVersionControls versions={controller.promptVersions} />
            )}
            <GenerationPromptEditor
              value={prompt}
              assets={promptAssets}
              label="视频提示词"
              placeholder="描述您的修改或生成需求…"
              canvasHistoryShortcuts
              onChange={setPrompt}
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
          <CustomSelect
            className="video-composer-model"
            ariaLabel="生成模型"
            value={modelId}
            disabled={options.isLoading || models.length === 0}
            options={
              models.length
                ? models.map((model) => ({
                    value: model.id,
                    label: model.label,
                    description: model.provider_name,
                  }))
                : [{ value: "", label: "暂无可用模型", disabled: true }]
            }
            onChange={controller.selectModel}
          />
          <details className="video-composer-parameters">
            <summary role="button" aria-label="视频参数">
              <Settings2 aria-hidden />
              {workflowCapabilities
                ? `${duration}S · ${workflowCapabilities.supports_ratio ? ratio : `${controller.workflowValues.width ?? workflowCapabilities.parameters.width?.default} × ${controller.workflowValues.height ?? workflowCapabilities.parameters.height?.default}`}`
                : `${ratio} · ${duration}S · ${resolution.toUpperCase()}`}
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
                  min={minimumDuration}
                  max="15"
                  step="1"
                  value={duration}
                  style={
                    {
                      "--video-duration-progress": `${((duration - minimumDuration) / (15 - minimumDuration)) * 100}%`,
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
                  <span>{minimumDuration} 秒</span>
                  <span>15 秒</span>
                </span>
              </label>
              {(!workflowCapabilities ||
                workflowCapabilities.supports_ratio) && (
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
              )}
              {!workflowCapabilities && (
                <>
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
                          persistDraft(
                            { watermark: event.target.checked },
                            true,
                          );
                        }}
                      />
                      保留水印
                    </label>
                  </div>
                </>
              )}
              {workflowCapabilities && (
                <WorkflowVideoControls
                  capabilities={workflowCapabilities}
                  values={controller.workflowValues}
                  onChange={controller.changeWorkflowValues}
                />
              )}
            </div>
          </details>
          <button
            className="video-composer-submit"
            disabled={
              createMutation.isPending ||
              generating ||
              !modelId ||
              (videoMode === "text" && !prompt.trim())
            }
            type="submit"
            aria-label={
              generating
                ? "视频生成中"
                : createMutation.isPending
                  ? "正在提交"
                  : "生成视频"
            }
            aria-busy={generating || createMutation.isPending}
          >
            {createMutation.isPending || generating ? (
              <GenerationSpinner />
            ) : (
              <ArrowUp aria-hidden />
            )}
            {controller.layout === "workbench" && (
              <span>
                {generating
                  ? "生成中"
                  : createMutation.isPending
                    ? "提交中"
                    : "生成"}
              </span>
            )}
          </button>
        </footer>
      </form>
    </aside>
  );
}
