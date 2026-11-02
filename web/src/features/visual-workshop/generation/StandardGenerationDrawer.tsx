import { LoadingState } from "@shared/ui/LoadingState";
import { Image, Sparkles, Video, X } from "lucide-react";
import { GenerationSpinner } from "./GenerationActivity";
import { WorkflowVideoControls } from "@features/models";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { GenerationPromptEditor } from "@features/visual-workshop/generation/GenerationPromptEditor";
import { PromptVersionControls } from "./PromptVersionControls";
import { ProjectMediaPicker } from "@features/visual-workshop/generation/ProjectMediaPicker";
import { useGenerationDrawerController } from "@features/visual-workshop/generation/useGenerationDrawerController";

export function StandardGenerationDrawer({
  controller,
}: {
  controller: ReturnType<typeof useGenerationDrawerController>;
}) {
  const {
    projectId,
    onClose,
    lockedKind,
    compact,
    kind,
    setKind,
    modelId,
    selectModel,
    workflowCapabilities,
    referenceLimits,
    prompt,
    setPrompt,
    size,
    setSize,
    seed,
    setSeed,
    imageReference,
    setImageReference,
    videoMode,
    setVideoMode,
    duration,
    setDuration,
    resolution,
    setResolution,
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
    audioReferences,
    setAudioReferences,
    videoReferences,
    setVideoReferences,
    notice,
    promptAssets,
    rememberPromptFiles,
    options,
    models,
    selectedModel,
    createMutation,
    submit,
  } = controller;
  return (
    <aside
      className={`canvas-generation-drawer${compact ? " is-compact" : ""}`}
      aria-label={lockedKind ? "节点 AI 生成" : "AI 生成"}
    >
      <header>
        <div>
          <strong>AI 生成</strong>
          <small>生成完成后自动保存输出版本</small>
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
          <CustomSelect
            ariaLabel="生成模型"
            value={modelId}
            onChange={selectModel}
            disabled={options.isLoading}
            options={
              models.length
                ? models.map((model) => ({
                    value: model.id,
                    label: model.label,
                    description: kind === "video" ? model.slug : undefined,
                  }))
                : [{ value: "", label: "暂无可用模型", disabled: true }]
            }
          />
          {selectedModel?.description ? (
            <small>{selectedModel.description}</small>
          ) : null}
        </label>
        <div className="generation-form-prompt">
          {controller.promptVersions ? (
            <PromptVersionControls versions={controller.promptVersions} />
          ) : (
            <span>提示词</span>
          )}
          <GenerationPromptEditor
            value={prompt}
            assets={promptAssets}
            label={kind === "image" ? "图片提示词" : "视频提示词"}
            placeholder={
              kind === "image" ? "描述要生成的画面…" : "描述镜头、动作和氛围…"
            }
            onChange={setPrompt}
            onBlur={() => controller.persistDraft({}, true)}
          />
        </div>
        {kind === "image" ? (
          <>
            <div className="generation-form-grid">
              <label>
                <span>尺寸</span>
                <CustomSelect
                  ariaLabel="生成尺寸"
                  value={size}
                  onChange={setSize}
                  options={(selectedModel?.sizes ?? []).map((option) => ({
                    value: option,
                    label: option,
                  }))}
                />
              </label>
              {selectedModel?.supports_seed !== false && (
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
              )}
            </div>
            <ProjectMediaPicker
              excludedAssetIds={controller.excludedAssetIds}
              projectId={projectId}
              label="参考图片（可选）"
              multiple={(selectedModel?.max_reference_images ?? 1) > 1}
              max={selectedModel?.max_reference_images ?? 1}
              value={imageReference}
              onChange={setImageReference}
              onReorder={controller.reorderImages}
              onFilesLoaded={rememberPromptFiles}
            />
          </>
        ) : (
          <>
            <div className="generation-form-grid generation-form-grid-three">
              <label>
                <span>时长</span>
                <CustomSelect
                  ariaLabel="视频时长"
                  value={String(duration)}
                  onChange={(value) => setDuration(Number(value))}
                  options={controller.videoOptions.durations}
                />
              </label>
              {!workflowCapabilities && (
                <label>
                  <span>分辨率</span>
                  <CustomSelect
                    ariaLabel="视频分辨率"
                    value={resolution}
                    onChange={(value) =>
                      setResolution(value as typeof resolution)
                    }
                    options={controller.videoOptions.resolutions.map(
                      (value) => ({
                        value,
                        label: value,
                      }),
                    )}
                  />
                </label>
              )}
              {(!workflowCapabilities ||
                workflowCapabilities.supports_ratio) && (
                <label>
                  <span>比例</span>
                  <CustomSelect
                    ariaLabel="视频比例"
                    value={controller.effectiveRatio}
                    onChange={(value) =>
                      setRatio(value as typeof controller.ratio)
                    }
                    options={controller.videoOptions.ratios.map((value) => ({
                      value,
                      label: value === "adaptive" ? "自适应" : value,
                    }))}
                  />
                </label>
              )}
            </div>
            <fieldset className="generation-mode-options">
              <legend>输入方式</legend>
              {(["text", "image", "frames", "reference"] as const)
                .filter(
                  (value) =>
                    !workflowCapabilities ||
                    value === "text" ||
                    value === "reference",
                )
                .map((value) => (
                  <button
                    type="button"
                    className={videoMode === value ? "selected" : ""}
                    aria-pressed={videoMode === value}
                    key={value}
                    onClick={() => setVideoMode(value)}
                  >
                    {value === "text"
                      ? "纯文本"
                      : value === "image"
                        ? "图生视频"
                        : value === "frames"
                          ? "首尾帧"
                          : "参考素材"}
                  </button>
                ))}
            </fieldset>
            {videoMode === "image" ? (
              <ProjectMediaPicker
                excludedAssetIds={controller.excludedAssetIds}
                projectId={projectId}
                label="起始画面（必选）"
                value={firstFrame}
                onChange={setFirstFrame}
                onFilesLoaded={rememberPromptFiles}
              />
            ) : null}
            {videoMode === "frames" ? (
              <>
                <ProjectMediaPicker
                  excludedAssetIds={controller.excludedAssetIds}
                  projectId={projectId}
                  label="首帧（必选）"
                  value={firstFrame}
                  onChange={setFirstFrame}
                  onFilesLoaded={rememberPromptFiles}
                />
                <ProjectMediaPicker
                  excludedAssetIds={controller.excludedAssetIds}
                  projectId={projectId}
                  label="尾帧（可选）"
                  value={lastFrame}
                  onChange={setLastFrame}
                  onFilesLoaded={rememberPromptFiles}
                />
              </>
            ) : null}
            {videoMode === "reference" ? (
              <>
                <ProjectMediaPicker
                  excludedAssetIds={controller.excludedAssetIds}
                  projectId={projectId}
                  label="参考图片"
                  value={references}
                  multiple
                  max={referenceLimits.image}
                  onChange={setReferences}
                  onFilesLoaded={rememberPromptFiles}
                />
                {(referenceLimits.video > 0 || videoReferences.length > 0) && (
                  <ProjectMediaPicker
                    excludedAssetIds={controller.excludedAssetIds}
                    projectId={projectId}
                    label="参考视频"
                    kind="video"
                    value={videoReferences}
                    multiple
                    max={referenceLimits.video}
                    onChange={setVideoReferences}
                    onFilesLoaded={rememberPromptFiles}
                  />
                )}
                <ProjectMediaPicker
                  excludedAssetIds={controller.excludedAssetIds}
                  projectId={projectId}
                  label="参考音频"
                  kind="audio"
                  value={audioReferences}
                  multiple
                  max={referenceLimits.audio}
                  onChange={setAudioReferences}
                  onFilesLoaded={rememberPromptFiles}
                />
              </>
            ) : null}
            {!workflowCapabilities && (
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
            )}
            {workflowCapabilities && (
              <WorkflowVideoControls
                capabilities={workflowCapabilities}
                values={controller.workflowValues}
                onChange={controller.changeWorkflowValues}
              />
            )}
          </>
        )}
        {notice ? (
          <div className="generation-notice" role="status">
            {notice}
          </div>
        ) : null}
        <button
          className="generation-submit"
          disabled={
            controller.generating || createMutation.isPending || !modelId
          }
          aria-busy={controller.generating || createMutation.isPending}
          type="submit"
        >
          {createMutation.isPending || controller.generating ? (
            <GenerationSpinner />
          ) : (
            <Sparkles aria-hidden />
          )}
          {controller.generating ? (
            <LoadingState variant="inline" label="生成中…" />
          ) : createMutation.isPending ? (
            <LoadingState variant="inline" label="正在提交…" />
          ) : (
            "创建生成任务"
          )}
        </button>
      </form>
    </aside>
  );
}
