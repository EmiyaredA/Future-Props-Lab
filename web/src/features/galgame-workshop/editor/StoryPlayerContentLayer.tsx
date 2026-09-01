import type { CSSProperties } from "react";
import { Clock3, Play } from "lucide-react";
import { RichTextView } from "@features/galgame-workshop/editor/RichTextEditor";
import { StoryPlayerDialogueLayer } from "@features/galgame-workshop/editor/StoryPlayerDialogueLayer";
import type { StoryPlayerViewModel } from "@features/galgame-workshop/editor/StoryPlayerControls";

export function StoryPlayerContentLayer({
  model,
}: {
  model: StoryPlayerViewModel;
}) {
  const {
    mode,
    exportMode,
    displayFrame,
    restart,
    skipTimelineStep,
    enterFragment,
    selectedExportChoiceId,
    systemMessageStyle,
    resolveSystemMessage,
    advance,
    runtimeRef,
    paragraphVisibleContents,
    paragraphGroup,
    document,
    runtimeVariables,
    visibleTextLength,
    displayText,
  } = model;
  return displayFrame.mode === "idle" ? (
    exportMode ? null : (
      <button
        className="galgame-player-start"
        type="button"
        onClick={restart}
        disabled={mode === "edit"}
      >
        <Play aria-hidden /> {mode === "edit" ? "选择一个 Block" : "开始试玩"}
      </button>
    )
  ) : displayFrame.mode === "ending" ? (
    exportMode ? null : (
      <div className="galgame-ending">
        <small>ENDING</small>
        <strong>{displayFrame.label}</strong>
        <button type="button" onClick={restart}>
          重新开始
        </button>
      </div>
    )
  ) : displayFrame.mode === "error" ? (
    <div className="galgame-player-error" role="alert">
      <strong>试玩已停止</strong>
      <span>{displayFrame.message}</span>
      <button type="button" onClick={restart}>
        重新开始
      </button>
    </div>
  ) : displayFrame.mode === "stageOnly" ? (
    mode === "play" && !exportMode ? (
      <button
        type="button"
        className="galgame-stage-advance"
        onClick={() => skipTimelineStep(1)}
      >
        点击继续
      </button>
    ) : null
  ) : displayFrame.block.type === "branch" ? (
    <div className="galgame-choices">
      <strong>{displayFrame.block.prompt || "请选择"}</strong>
      {displayFrame.block.choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          onClick={() => enterFragment(choice.targetFragmentId)}
          className={
            selectedExportChoiceId === choice.id
              ? "is-export-selected"
              : undefined
          }
        >
          {choice.text || "未命名选项"}
        </button>
      ))}
    </div>
  ) : displayFrame.block.type === "systemMessage" ? (
    <div
      className={`galgame-system-message tone-${displayFrame.block.tone}`}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      autoFocus
      aria-label={
        displayFrame.block.title ??
        (displayFrame.block.mode === "confirm" ? "请确认" : "提示")
      }
      style={
        systemMessageStyle
          ? ({
              "--message-panel": systemMessageStyle.panelColor,
              "--message-title": systemMessageStyle.titleColor,
              "--message-text": systemMessageStyle.textColor,
              "--message-accent": systemMessageStyle.accentColor,
              "--message-radius": `${systemMessageStyle.borderRadius}px`,
              "--message-width": `${systemMessageStyle.width}px`,
            } as CSSProperties)
          : undefined
      }
      onKeyDown={(event) => {
        if (event.key === "Escape") resolveSystemMessage(false);
      }}
    >
      <strong>
        {displayFrame.block.title ??
          (displayFrame.block.mode === "confirm" ? "请确认" : "提示")}
      </strong>
      <p>{displayFrame.block.text}</p>
      <footer>
        {displayFrame.block.mode === "confirm" ? (
          <button type="button" onClick={() => resolveSystemMessage(false)}>
            {displayFrame.block.cancelLabel || "取消"}
          </button>
        ) : null}
        <button
          type="button"
          className="primary"
          onClick={() => resolveSystemMessage(true)}
        >
          {displayFrame.block.acceptLabel ||
            (displayFrame.block.mode === "confirm" ? "确认" : "知道了")}
        </button>
      </footer>
    </div>
  ) : displayFrame.block.type === "wait" ? (
    <button
      type="button"
      className="galgame-player-wait"
      onClick={
        mode === "play" && displayFrame.block.mode === "player"
          ? advance
          : undefined
      }
    >
      <Clock3 aria-hidden />
      <strong>
        {displayFrame.block.mode === "player"
          ? "点击继续"
          : `等待 ${displayFrame.block.durationMs ?? 0}ms`}
      </strong>
      <small>
        {displayFrame.block.mode === "player"
          ? "空格 / Enter / 向下滚轮"
          : "定时等待"}
      </small>
    </button>
  ) : displayFrame.block.type === "storyParagraph" ? (
    <button
      type="button"
      className={`galgame-story-paragraph style-${runtimeRef.current.paragraph.styleRef.id}`}
      onClick={mode === "play" ? advance : undefined}
    >
      <span>
        {paragraphVisibleContents.map(({ block, content }, index) => (
          <p
            key={block.id}
            className={
              paragraphGroup &&
              paragraphGroup.start + index < displayFrame.blockIndex
                ? "is-read"
                : undefined
            }
          >
            <RichTextView
              content={content}
              document={document}
              variables={runtimeVariables}
            />
          </p>
        ))}
      </span>
      <em>
        {visibleTextLength < Array.from(displayText).length
          ? "点击显示全文"
          : "点击继续"}
      </em>
    </button>
  ) : displayText ? (
    <StoryPlayerDialogueLayer model={model} />
  ) : null;
}
