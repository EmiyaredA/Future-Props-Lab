import {
  ArrowUp,
  Check,
  ChevronDown,
  Image,
  LoaderCircle,
  Maximize2,
  Minimize2,
} from "lucide-react";
import {
  IMAGE_CLARITY_OPTIONS,
  IMAGE_RATIO_OPTIONS,
  imageRatioIconStyle,
} from "@features/visual-workshop/generation/options";
import { GenerationPromptEditor } from "@features/visual-workshop/generation/GenerationPromptEditor";
import { ProjectMediaPicker } from "@features/visual-workshop/generation/ProjectMediaPicker";
import { useGenerationDrawerController } from "@features/visual-workshop/generation/useGenerationDrawerController";

export function CompactImageGenerationDrawer({
  controller,
}: {
  controller: ReturnType<typeof useGenerationDrawerController>;
}) {
  const {
    projectId,
    modelId,
    setModelId,
    prompt,
    setPrompt,
    setSize,
    seed,
    setSeed,
    imageCount,
    setImageCount,
    gridSize,
    setGridSize,
    gridOutput,
    setGridOutput,
    imageReference,
    setImageReference,
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
    availableImageSizes,
    selectedImageSize,
    persistDraft,
    invalidSelection,
    isSubmitting,
    submit,
  } = controller;
  return (
    <aside
      className={`canvas-generation-drawer is-compact image-node-composer${composerExpanded ? " is-expanded" : ""}`}
      aria-label="节点 AI 生成"
    >
      <form className="video-node-composer-form" onSubmit={submit}>
        <div className="image-composer-body">
          <div className="image-composer-tools">
            <ProjectMediaPicker
              excludedAssetIds={controller.excludedAssetIds}
              projectId={projectId}
              multiple={(selectedModel?.max_reference_images ?? 1) > 1}
              max={selectedModel?.max_reference_images ?? 1}
              label="参考图片（可选）"
              minimal={!composerExpanded}
              uploadLast
              value={imageReference}
              linkedValue={linkedAssetIds.image}
              onReorder={
                linkedAssetIds.image.length
                  ? undefined
                  : controller.reorderImages
              }
              onChange={(value) => {
                setImageReference(value);
                persistDraft(
                  { reference_asset_id: null, reference_asset_ids: value },
                  true,
                );
              }}
              onFilesLoaded={rememberPromptFiles}
              onInvalidSelection={invalidSelection}
            />
            <button
              type="button"
              className="video-composer-close"
              aria-label={
                composerExpanded ? "收起图片生成器" : "展开图片生成器"
              }
              title={composerExpanded ? "收起" : "展开"}
              onClick={() => setComposerExpanded((current) => !current)}
            >
              {composerExpanded ? (
                <Minimize2 aria-hidden />
              ) : (
                <Maximize2 aria-hidden />
              )}
            </button>
          </div>
          <div className="video-composer-prompt image-composer-prompt">
            <GenerationPromptEditor
              value={prompt}
              assets={promptAssets}
              label="图片提示词"
              placeholder="描述你想生成的画面…"
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

        <footer className="video-composer-footer image-composer-footer">
          <span className="video-composer-kind">
            <Image aria-hidden />
            图片生成
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
          <details className="video-composer-parameters image-composer-parameters">
            <summary role="button" aria-label="图片参数">
              <span
                className="image-parameter-summary-icon"
                aria-hidden="true"
              />
              {selectedImageSize
                ? `${selectedImageSize.ratio} / ${selectedImageSize.clarity}`
                : "选择尺寸"}
              <ChevronDown aria-hidden />
            </summary>
            <div className="image-parameter-popover">
              <fieldset className="image-ratio-options">
                <legend>比例</legend>
                <div role="group" aria-label="图片比例">
                  {IMAGE_RATIO_OPTIONS.map((option) => {
                    const choices = availableImageSizes.filter(
                      (choice) => choice.ratio === option.label,
                    );
                    const available = choices.length > 0;
                    const selected = selectedImageSize?.ratio === option.label;
                    return (
                      <button
                        type="button"
                        aria-label={`比例 ${option.label}`}
                        aria-pressed={selected}
                        disabled={!available}
                        key={option.label}
                        onClick={() => {
                          const next =
                            choices.find(
                              (choice) =>
                                choice.clarity === selectedImageSize?.clarity,
                            ) ?? choices[0];
                          if (next) setSize(next.value);
                          if (next) persistDraft({ size: next.value }, true);
                        }}
                      >
                        <span className="image-ratio-icon-shell">
                          <span style={imageRatioIconStyle(option)} />
                        </span>
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <fieldset className="image-clarity-options">
                <legend>清晰度</legend>
                <div role="group" aria-label="图片清晰度">
                  {IMAGE_CLARITY_OPTIONS.map((clarity) => {
                    const next = availableImageSizes.find(
                      (choice) =>
                        choice.ratio === selectedImageSize?.ratio &&
                        choice.clarity === clarity,
                    );
                    return (
                      <button
                        type="button"
                        aria-label={`清晰度 ${clarity}`}
                        aria-pressed={selectedImageSize?.clarity === clarity}
                        disabled={!next}
                        key={clarity}
                        onClick={() => {
                          if (next) {
                            setSize(next.value);
                            persistDraft({ size: next.value }, true);
                          }
                        }}
                      >
                        {clarity}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              {selectedModel?.supports_seed !== false && (
                <label className="image-seed-control">
                  <span>种子（可选）</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="随机"
                    value={seed}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSeed(value);
                      const parsed = Number(value);
                      persistDraft({
                        seed:
                          value !== "" &&
                          Number.isSafeInteger(parsed) &&
                          parsed >= 0
                            ? parsed
                            : null,
                      });
                    }}
                    onBlur={() => persistDraft({}, true)}
                  />
                </label>
              )}
            </div>
          </details>
          <details className="image-composer-count">
            <summary role="button" aria-label="生成数量">
              {gridSize === 1 ? `×${imageCount}` : `${gridSize}宫格`}
              <ChevronDown aria-hidden />
            </summary>
            <div role="listbox" aria-label="选择图片输出方式">
              {[1, 2, 3, 4].map((count) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={gridSize === 1 && imageCount === count}
                  key={count}
                  onClick={(event) => {
                    setImageCount(count);
                    setGridSize(1);
                    persistDraft({ image_count: count, grid_size: 1 }, true);
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                  }}
                >
                  ×{count}
                  {gridSize === 1 && imageCount === count ? (
                    <Check aria-hidden />
                  ) : null}
                </button>
              ))}
              {[4, 9].map((count) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={gridSize === count}
                  key={`grid-${count}`}
                  onClick={(event) => {
                    const next = count as 4 | 9;
                    setGridSize(next);
                    persistDraft({ grid_size: next }, true);
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                  }}
                >
                  {count} 宫格
                  {gridSize === count ? <Check aria-hidden /> : null}
                </button>
              ))}
            </div>
          </details>
          {gridSize > 1 ? (
            <details className="image-composer-count image-grid-output">
              <summary role="button" aria-label="宫格输出方式">
                {gridOutput === "nodes" ? "独立节点" : "合成大图"}
                <ChevronDown aria-hidden />
              </summary>
              <div role="listbox" aria-label="选择宫格输出方式">
                {(
                  [
                    ["nodes", "独立节点"],
                    ["composite", "合成大图"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={gridOutput === value}
                    key={value}
                    onClick={(event) => {
                      setGridOutput(value);
                      persistDraft({ grid_output: value }, true);
                      event.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                    }}
                  >
                    {label}
                    {gridOutput === value ? <Check aria-hidden /> : null}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
          <button
            className="video-composer-submit"
            disabled={isSubmitting || !modelId || !prompt.trim()}
            type="submit"
            aria-label={isSubmitting ? "正在提交" : "生成图片"}
          >
            {isSubmitting ? (
              <LoaderCircle className="spinning" aria-hidden />
            ) : (
              <ArrowUp aria-hidden />
            )}
            {controller.layout === "workbench" && (
              <span>{isSubmitting ? "提交中" : "生成"}</span>
            )}
          </button>
        </footer>
      </form>
    </aside>
  );
}
