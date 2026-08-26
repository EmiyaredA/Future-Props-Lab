import {
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  Ratio,
  RotateCcw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
} from "lucide-react";
import { stageAspectModeLabel } from "@features/galgame-workshop/editor/stageViewportPreferences";
import {
  STAGE_ASPECT_OPTIONS,
  formatTimelineTime,
} from "@features/galgame-workshop/editor/storyPlayerModel";
import type { useStoryPlayerController } from "@features/galgame-workshop/editor/useStoryPlayerController";

export type StoryPlayerViewModel = ReturnType<typeof useStoryPlayerController>;

export function StoryPlayerHeader({ model }: { model: StoryPlayerViewModel }) {
  const {
    mode,
    chrome,
    workbenchHeader,
    scenes,
    displayFrame,
    document,
    headerModeControl,
    aspectMenuOpen,
    setAspectMenuOpen,
    mixerOpen,
    setMixerOpen,
    viewportPreferences,
    restart,
    onCollapsedChange,
    collapsed,
    exportMode,
  } = model;
  if (exportMode || chrome !== "full") return null;
  return (
    <header>
      <div>
        <strong>
          {workbenchHeader
            ? "实时预览"
            : mode === "edit"
              ? "舞台编辑"
              : "游戏预览"}
        </strong>
        {workbenchHeader ? (
          <i className="galgame-player-live">● LIVE</i>
        ) : (
          <>
            <small>
              {scenes.get(displayFrame.stage.sceneId ?? "")?.name ?? "空舞台"}
            </small>
            <em className="galgame-player-resolution">
              {document.settings?.canvas?.width ?? 1920} ×{" "}
              {document.settings?.canvas?.height ?? 1080}
            </em>
          </>
        )}
      </div>
      <span className="galgame-player-header-actions">
        {workbenchHeader ? (
          <em className="galgame-player-resolution">
            {document.settings?.canvas?.width ?? 1920} ×{" "}
            {document.settings?.canvas?.height ?? 1080}
          </em>
        ) : null}
        {headerModeControl}
        <button
          type="button"
          className={aspectMenuOpen ? "active" : ""}
          onClick={() => {
            setAspectMenuOpen((current) => !current);
            setMixerOpen(false);
          }}
          aria-label="舞台比例"
          aria-expanded={aspectMenuOpen}
          title={`舞台比例：${stageAspectModeLabel(viewportPreferences.aspectMode)}`}
        >
          <Ratio aria-hidden />
        </button>
        {mode === "play" ? (
          <button
            type="button"
            className={mixerOpen ? "active" : ""}
            onClick={() => {
              setMixerOpen((current) => !current);
              setAspectMenuOpen(false);
            }}
            aria-label="试玩混音"
          >
            <SlidersHorizontal aria-hidden />
          </button>
        ) : null}
        {mode === "play" ? (
          <button type="button" onClick={restart} aria-label="重新开始试玩">
            <RotateCcw aria-hidden />
          </button>
        ) : null}
        {onCollapsedChange ? (
          <button
            type="button"
            onClick={() => onCollapsedChange(!collapsed)}
            aria-label={collapsed ? "展开舞台预览" : "折叠舞台预览"}
            aria-pressed={collapsed}
            title={collapsed ? "展开舞台预览" : "折叠舞台预览"}
          >
            {collapsed ? (
              <ChevronDown aria-hidden />
            ) : (
              <ChevronUp aria-hidden />
            )}
          </button>
        ) : null}
      </span>
    </header>
  );
}

export function StoryPlayerAspectMenu({
  model,
}: {
  model: StoryPlayerViewModel;
}) {
  const {
    chrome,
    exportMode,
    aspectMenuOpen,
    viewportPreferences,
    updateViewportPreferences,
    customWidthDraft,
    setCustomWidthDraft,
    customHeightDraft,
    setCustomHeightDraft,
  } = model;
  if (exportMode || chrome !== "full" || !aspectMenuOpen) return null;
  return (
    <section className="galgame-player-aspect" aria-label="舞台比例选项">
      <header>
        <strong>舞台比例</strong>
        <Ratio aria-hidden />
      </header>
      <div className="galgame-player-aspect-options" role="listbox">
        {STAGE_ASPECT_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="option"
            aria-selected={viewportPreferences.aspectMode === option}
            className={
              viewportPreferences.aspectMode === option ? "active" : ""
            }
            onClick={() =>
              updateViewportPreferences({
                ...viewportPreferences,
                aspectMode: option,
              })
            }
          >
            {stageAspectModeLabel(option)}
          </button>
        ))}
      </div>
      {viewportPreferences.aspectMode === "custom" ? (
        <div className="galgame-player-aspect-custom">
          <label>
            <span>宽</span>
            <input
              aria-label="自定义比例宽度"
              type="number"
              min="1"
              max="9999"
              value={customWidthDraft}
              onChange={(event) => {
                const raw = event.target.value;
                setCustomWidthDraft(raw);
                const next = Number(raw);
                if (!Number.isFinite(next) || next <= 0) return;
                updateViewportPreferences({
                  ...viewportPreferences,
                  customWidth: Math.min(9999, Math.round(next)),
                });
              }}
              onBlur={() =>
                setCustomWidthDraft(String(viewportPreferences.customWidth))
              }
            />
          </label>
          <span aria-hidden>:</span>
          <label>
            <span>高</span>
            <input
              aria-label="自定义比例高度"
              type="number"
              min="1"
              max="9999"
              value={customHeightDraft}
              onChange={(event) => {
                const raw = event.target.value;
                setCustomHeightDraft(raw);
                const next = Number(raw);
                if (!Number.isFinite(next) || next <= 0) return;
                updateViewportPreferences({
                  ...viewportPreferences,
                  customHeight: Math.min(9999, Math.round(next)),
                });
              }}
              onBlur={() =>
                setCustomHeightDraft(String(viewportPreferences.customHeight))
              }
            />
          </label>
        </div>
      ) : null}
    </section>
  );
}

export function StoryPlayerMixer({ model }: { model: StoryPlayerViewModel }) {
  const { mixerOpen, mix, setMix } = model;
  if (!mixerOpen) return null;
  return (
    <section className="galgame-player-mixer" aria-label="试玩混音">
      <header>
        <strong>试玩混音</strong>
        <Volume2 aria-hidden />
      </header>
      {(
        [
          ["voice", "配音"],
          ["bgm", "音乐"],
          ["ambient", "环境音"],
          ["sfx", "音效"],
        ] as const
      ).map(([channel, label]) => (
        <label key={channel}>
          <span>
            {label} <em>{mix[channel]}%</em>
          </span>
          <input
            aria-label={`${label}混音音量`}
            type="range"
            min="0"
            max="100"
            value={mix[channel]}
            onChange={(event) =>
              setMix((current) => ({
                ...current,
                [channel]: Number(event.target.value),
              }))
            }
          />
        </label>
      ))}
    </section>
  );
}

export function StoryPlayerEnableAudio({
  model,
}: {
  model: StoryPlayerViewModel;
}) {
  const { autoplayBlocked, pendingRef, setAutoplayBlocked, voiceRef, tryPlay } =
    model;
  if (!autoplayBlocked) return null;
  return (
    <button
      type="button"
      className="galgame-player-enable-audio"
      onClick={() => {
        const pending = [...pendingRef.current];
        setAutoplayBlocked(false);
        void voiceRef.current?.levelMonitor?.resume().catch(() => undefined);
        for (const audio of pending) void tryPlay(audio);
      }}
    >
      <Volume2 aria-hidden /> 点击启用声音
    </button>
  );
}

export function StoryPlayerRuntimeControls({
  model,
}: {
  model: StoryPlayerViewModel;
}) {
  const {
    exportMode,
    chrome,
    mode,
    displayFrame,
    activeTimeline,
    skipTimelineStep,
    toggleTimeline,
    timelinePlaying,
    timelinePositionMs,
    seekTimeline,
    advanceMode,
    selectAdvanceMode,
  } = model;
  if (
    exportMode ||
    chrome !== "full" ||
    mode !== "play" ||
    displayFrame.mode === "idle"
  ) {
    return null;
  }
  return (
    <div className="galgame-player-runtime-controls" aria-label="试玩控制">
      {activeTimeline &&
      (displayFrame.mode === "content" || displayFrame.mode === "stageOnly") ? (
        <>
          <span className="galgame-player-runtime-transport">
            <button
              type="button"
              onClick={() => skipTimelineStep(-1)}
              aria-label="上一步"
            >
              <SkipBack aria-hidden />
            </button>
            <button
              type="button"
              onClick={toggleTimeline}
              aria-label={timelinePlaying ? "暂停时间轴" : "播放时间轴"}
            >
              {timelinePlaying ? <Pause aria-hidden /> : <Play aria-hidden />}
            </button>
            <button
              type="button"
              onClick={() => skipTimelineStep(1)}
              aria-label="下一步"
            >
              <SkipForward aria-hidden />
            </button>
          </span>
          <input
            type="range"
            min="0"
            max={activeTimeline.durationMs}
            step="100"
            value={Math.min(timelinePositionMs, activeTimeline.durationMs)}
            onChange={(event) => seekTimeline(Number(event.target.value))}
            aria-label="剧情时间轴进度"
          />
          <time>
            {formatTimelineTime(timelinePositionMs)} /{" "}
            {formatTimelineTime(activeTimeline.durationMs)}
          </time>
        </>
      ) : (
        <span className="galgame-player-runtime-hint">点击对话继续</span>
      )}
      <span className="galgame-player-advance-control">
        <small>推进</small>
        <span className="galgame-player-advance-mode" aria-label="推进模式">
          <button
            type="button"
            className={advanceMode === "manual" ? "active" : ""}
            onClick={() => selectAdvanceMode("manual")}
          >
            手动
          </button>
          <button
            type="button"
            className={advanceMode === "auto" ? "active" : ""}
            onClick={() => selectAdvanceMode("auto")}
          >
            自动
          </button>
          <button
            type="button"
            className={advanceMode === "skip" ? "active" : ""}
            onClick={() => selectAdvanceMode("skip")}
          >
            跳过
          </button>
        </span>
      </span>
    </div>
  );
}
