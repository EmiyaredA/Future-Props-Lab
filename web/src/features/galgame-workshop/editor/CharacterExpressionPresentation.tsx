import type { CSSProperties } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileImage,
  Film,
  FolderOpen,
  ImagePlus,
  Plus,
  Trash2,
  Volume2,
} from "lucide-react";
import type { CharacterWorkspaceViewModel } from "@features/galgame-workshop/editor/characterWorkspaceViewModel";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { CustomSelect } from "@shared/ui/CustomSelect";

export function CharacterExpressionPresentation({
  model,
}: {
  model: CharacterWorkspaceViewModel;
}) {
  const {
    assetsById,
    expressions,
    fileInput,
    projectAssetsQuery,
    selectedExpression,
    setPicker,
    appendExistingExpressionFrame,
    setSequencePlaybackMode,
    switchExpressionToSequence,
    switchExpressionToStatic,
    updateExpression,
    updateSequenceFrames,
  } = model;
  if (!selectedExpression) return null;

  return (
    <section className="galgame-expression-setting-section galgame-expression-presentation">
      <header>
        <span>
          <Film aria-hidden />
          <strong>呈现方式</strong>
        </span>
        <small>
          {selectedExpression.renderMode === "frameSequence"
            ? `序列帧 · ${selectedExpression.sequence?.frames.length ?? 0} 帧`
            : "静态图片"}
        </small>
      </header>
      <div
        className="galgame-expression-render-modes"
        role="group"
        aria-label="表情呈现方式"
      >
        <button
          type="button"
          aria-pressed={selectedExpression.renderMode !== "frameSequence"}
          onClick={switchExpressionToStatic}
        >
          静态图片
        </button>
        <button
          type="button"
          aria-pressed={selectedExpression.renderMode === "frameSequence"}
          onClick={switchExpressionToSequence}
        >
          序列帧
        </button>
        <button type="button" disabled title="首期暂不支持 Spine 资源包">
          Spine
        </button>
        <button type="button" disabled title="首期暂不支持 Live2D 资源包">
          Live2D
        </button>
      </div>
      {selectedExpression.renderMode === "frameSequence" &&
      selectedExpression.sequence ? (
        <div className="galgame-expression-sequence-editor">
          <div
            className="galgame-expression-playback-modes"
            role="group"
            aria-label="序列播放方式"
          >
            <button
              type="button"
              aria-pressed={
                (selectedExpression.sequence.playbackMode ?? "timed") ===
                "timed"
              }
              onClick={() => setSequencePlaybackMode("timed")}
            >
              定时播放
            </button>
            <button
              type="button"
              aria-pressed={
                selectedExpression.sequence.playbackMode === "lipSync"
              }
              onClick={() => setSequencePlaybackMode("lipSync")}
            >
              语音口型
            </button>
          </div>
          <div className="galgame-expression-sequence-controls">
            <label className="galgame-expression-fps-control">
              <span>播放帧率</span>
              <span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  aria-label="播放帧率"
                  value={selectedExpression.sequence.fps}
                  onChange={(event) =>
                    updateExpression(selectedExpression.id, (expression) => ({
                      ...expression,
                      sequence: expression.sequence
                        ? {
                            ...expression.sequence,
                            fps: Math.min(
                              60,
                              Math.max(
                                1,
                                Math.round(Number(event.target.value) || 1),
                              ),
                            ),
                          }
                        : expression.sequence,
                    }))
                  }
                />
                <em>FPS</em>
                <span
                  className="galgame-expression-fps-slider"
                  style={
                    {
                      "--sequence-ratio":
                        (selectedExpression.sequence.fps - 1) / 59,
                    } as CSSProperties
                  }
                >
                  <input
                    type="range"
                    min={1}
                    max={60}
                    aria-label="播放帧率滑杆"
                    value={selectedExpression.sequence.fps}
                    onChange={(event) =>
                      updateExpression(selectedExpression.id, (expression) => ({
                        ...expression,
                        sequence: expression.sequence
                          ? {
                              ...expression.sequence,
                              fps: Number(event.target.value),
                            }
                          : expression.sequence,
                      }))
                    }
                  />
                </span>
              </span>
            </label>
            {selectedExpression.sequence.playbackMode === "lipSync" ? (
              <div className="galgame-expression-lip-sync-note">
                <Volume2 aria-hidden />
                <span>
                  <strong>语音驱动</strong>
                  <small>静止闭口，按音量切换三帧</small>
                </span>
              </div>
            ) : (
              <label className="galgame-expression-setting-toggle">
                <span>
                  <strong>循环播放</strong>
                  <small>关闭后停留在最后一帧</small>
                </span>
                <input
                  type="checkbox"
                  aria-label="循环播放"
                  checked={selectedExpression.sequence.loop}
                  onChange={(event) =>
                    updateExpression(selectedExpression.id, (expression) => ({
                      ...expression,
                      sequence: expression.sequence
                        ? {
                            ...expression.sequence,
                            loop: event.target.checked,
                          }
                        : expression.sequence,
                    }))
                  }
                />
                <i aria-hidden />
              </label>
            )}
          </div>
          <p className="galgame-expression-sequence-help">
            {selectedExpression.sequence.playbackMode === "lipSync"
              ? "按闭口、半口、张口顺序保存三帧；首帧同时用于缩略图和静止状态。"
              : `共 ${selectedExpression.sequence.frames.length} 个帧表情。首帧用于父节点缩略图；每帧仍可单独管理资源。`}
          </p>
          <ol className="galgame-expression-frame-list">
            {selectedExpression.sequence.frames.map((frame, index, frames) => {
              const storyAsset = assetsById.get(frame.assetId);
              const projectAsset = projectAssetsQuery.data?.items.find(
                (asset) => asset.id === storyAsset?.fileId,
              );
              return (
                <li key={frame.id}>
                  <span>
                    {selectedExpression.sequence?.playbackMode === "lipSync"
                      ? ["闭", "半", "张"][index]
                      : index + 1}
                  </span>
                  <StoryAssetImage
                    fileId={storyAsset?.fileId}
                    alt=""
                    fallback={<FileImage aria-hidden />}
                  />
                  <strong>
                    {projectAsset?.display_name ?? `帧 ${index + 1}`}
                  </strong>
                  <button
                    type="button"
                    aria-label={`上移第 ${index + 1} 帧`}
                    disabled={index === 0}
                    onClick={() =>
                      updateSequenceFrames((current) => {
                        const next = [...current];
                        [next[index - 1], next[index]] = [
                          next[index],
                          next[index - 1],
                        ];
                        return next;
                      })
                    }
                  >
                    <ChevronUp aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`下移第 ${index + 1} 帧`}
                    disabled={index === frames.length - 1}
                    onClick={() =>
                      updateSequenceFrames((current) => {
                        const next = [...current];
                        [next[index], next[index + 1]] = [
                          next[index + 1],
                          next[index],
                        ];
                        return next;
                      })
                    }
                  >
                    <ChevronDown aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="danger"
                    aria-label={`删除第 ${index + 1} 帧`}
                    disabled={
                      frames.length === 1 ||
                      selectedExpression.sequence?.playbackMode === "lipSync"
                    }
                    onClick={() =>
                      updateSequenceFrames((current) =>
                        current.filter((item) => item.id !== frame.id),
                      )
                    }
                  >
                    <Trash2 aria-hidden />
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="galgame-expression-sequence-actions">
            <CustomSelect
              ariaLabel="从已有表情添加帧"
              className="galgame-expression-sequence-source"
              leadingIcon={<ImagePlus aria-hidden />}
              showChevron={false}
              disabled={
                selectedExpression.sequence.playbackMode === "lipSync" &&
                selectedExpression.sequence.frames.length >= 3
              }
              value=""
              onChange={appendExistingExpressionFrame}
              options={[
                { value: "", label: "从已有表情添加" },
                ...expressions
                  .filter(
                    (expression) => expression.id !== selectedExpression.id,
                  )
                  .map((expression) => ({
                    value: expression.id,
                    label: expression.label,
                  })),
              ]}
            />
            <button
              type="button"
              disabled={
                selectedExpression.sequence.playbackMode === "lipSync" &&
                selectedExpression.sequence.frames.length >= 3
              }
              onClick={() =>
                setPicker({
                  mode: "sequence",
                  source: "project",
                })
              }
            >
              <FolderOpen aria-hidden /> 从项目素材添加
            </button>
            <button
              type="button"
              disabled={
                selectedExpression.sequence.playbackMode === "lipSync" &&
                selectedExpression.sequence.frames.length >= 3
              }
              onClick={() => {
                setPicker({
                  mode: "sequence",
                  source: "project",
                });
                requestAnimationFrame(() => fileInput.current?.click());
              }}
            >
              <Plus aria-hidden /> 从本地导入
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
