import { type CSSProperties } from "react";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import { RichTextView } from "@features/galgame-workshop/editor/RichTextEditor";
import { dialogueDisplayName } from "@features/galgame-workshop/editor/richText";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import {
  dialogueEffectiveOpacity,
  dialogueSpeakerNameLayout,
} from "@features/galgame-workshop/api/dialogueBoxStyle";
import {
  playerAdvanceIndicatorText,
  playerHexToRgba,
} from "@features/galgame-workshop/editor/storyPlayerModel";
import type { useStoryPlayerController } from "@features/galgame-workshop/editor/useStoryPlayerController";

type StoryPlayerViewModel = ReturnType<typeof useStoryPlayerController>;

export function StoryPlayerDialogueLayer({
  model,
}: {
  model: StoryPlayerViewModel;
}) {
  const {
    activeDialogue,
    activeDialogueAvatar,
    advance,
    advanceMode,
    characters,
    dialogueAvatarAsset,
    dialogueSkinAsset,
    dialogueStyle,
    displayFrame,
    displayText,
    document,
    exportMode,
    inlinePlayerWait,
    mode,
    runtimeVariables,
    visibleRichContent,
    visibleTextLength,
  } = model;
  const canvasWidth = document.settings?.canvas?.width ?? 1920;
  const logicalFontSize = (
    logicalPixels: number | null | undefined,
    fallback: string,
    minimum: number,
  ) =>
    logicalPixels == null
      ? fallback
      : `clamp(${minimum}px, ${(logicalPixels / canvasWidth) * 100}cqw, ${logicalPixels}px)`;
  const dialogueBodyFontSize = logicalFontSize(
    dialogueStyle.body.fontSizePx == null
      ? null
      : Math.round(dialogueStyle.body.fontSizePx * dialogueStyle.fontScale),
    `clamp(14px, ${dialogueStyle.fontScale * 1.25}cqw, 28px)`,
    12,
  );
  const dialogueNameFontSize = logicalFontSize(
    dialogueStyle.speakerName.fontSizePx == null
      ? null
      : Math.round(
          dialogueStyle.speakerName.fontSizePx * dialogueStyle.fontScale,
        ),
    "1em",
    10,
  );
  const nameLayout = dialogueSpeakerNameLayout(
    dialogueStyle.speakerName.placement,
  );
  const namePositionStyle: CSSProperties | undefined =
    dialogueStyle.layout.mode === "bottomOverlay" &&
    nameLayout.vertical === "top"
      ? { top: "var(--dialogue-name-top, 9px)" }
      : undefined;
  const bodyPositionStyle: CSSProperties | undefined =
    dialogueStyle.layout.mode === "bottomOverlay" &&
    nameLayout.vertical === "top"
      ? {
          top: "max(var(--dialogue-inset-top, 0%), calc(var(--dialogue-name-top, 9px) + var(--dialogue-name-font-size, 1em) + var(--dialogue-name-gap, 7px)))",
        }
      : dialogueStyle.layout.mode !== "bottomOverlay" &&
          dialogueStyle.speakerName.placement === "topCenter"
        ? {
            marginTop: "calc(var(--dialogue-name-font-size, 1em) * 1.65)",
          }
        : undefined;
  const overlayBodyWidth =
    Math.max(0, 100 - dialogueStyle.layout.contentInsetXPercent * 2) *
    (dialogueStyle.body.maxWidthPercent / 100);
  const indicatorVisible =
    dialogueStyle.advanceIndicator.visible &&
    (!exportMode || dialogueStyle.advanceIndicator.showInExport);
  const indicatorText = playerAdvanceIndicatorText({
    compact: dialogueStyle.advanceIndicator.style === "compact",
    advanceMode,
    visibleTextLength,
    textLength: Array.from(displayText).length,
    editing: mode === "edit",
    waiting: inlinePlayerWait,
  });
  const displayDialogue =
    displayFrame.mode === "content" && displayFrame.block.type === "dialogue"
      ? displayFrame.block
      : null;

  return (
    <button
      className={`galgame-dialogue-box layout-${dialogueStyle.layout.mode} background-${dialogueStyle.background.mode} body-${dialogueStyle.body.align} name-${dialogueStyle.speakerName.placement} name-decoration-${dialogueStyle.speakerName.decoration} indicator-${dialogueStyle.advanceIndicator.position} indicator-style-${dialogueStyle.advanceIndicator.style} top-rule-${dialogueStyle.background.topRule}`}
      data-speaker-horizontal={nameLayout.horizontal}
      data-speaker-vertical={nameLayout.vertical}
      type="button"
      onClick={mode === "play" ? advance : undefined}
      style={
        {
          background:
            dialogueStyle.background.mode === "verticalGradient"
              ? `linear-gradient(180deg, ${playerHexToRgba(
                  dialogueStyle.backgroundColor,
                  dialogueEffectiveOpacity(
                    dialogueStyle.backgroundOpacity,
                    dialogueStyle.background.gradientTopOpacity,
                  ),
                )}, ${playerHexToRgba(
                  dialogueStyle.backgroundColor,
                  dialogueEffectiveOpacity(
                    dialogueStyle.backgroundOpacity,
                    dialogueStyle.background.gradientBottomOpacity,
                  ),
                )})`
              : playerHexToRgba(
                  dialogueStyle.backgroundColor,
                  dialogueStyle.backgroundOpacity,
                ),
          borderRadius: `${dialogueStyle.borderRadius}px`,
          color: dialogueStyle.textColor,
          "--dialogue-width": `${dialogueStyle.layout.widthPercent}%`,
          "--dialogue-height": `${dialogueStyle.layout.heightPercent}%`,
          "--dialogue-bottom": `${dialogueStyle.layout.bottomOffsetPercent}%`,
          "--dialogue-inset-x": `${dialogueStyle.layout.contentInsetXPercent}%`,
          "--dialogue-inset-top": `${dialogueStyle.layout.contentInsetTopPercent}%`,
          "--dialogue-inset-bottom": `${dialogueStyle.layout.contentInsetBottomPercent}%`,
          "--dialogue-body-width": `${dialogueStyle.body.maxWidthPercent}%`,
          "--dialogue-overlay-body-width": `${overlayBodyWidth}%`,
          "--dialogue-body-font-size": dialogueBodyFontSize,
          "--dialogue-name-font-size": dialogueNameFontSize,
          "--dialogue-name-top": logicalFontSize(15, "15px", 8),
          "--dialogue-name-gap": logicalFontSize(14, "14px", 7),
          "--dialogue-line-height": dialogueStyle.body.lineHeight,
          "--dialogue-name-color": dialogueStyle.nameColor,
          "--dialogue-rule-color": playerHexToRgba(
            dialogueStyle.background.topRuleColor,
            dialogueStyle.background.topRuleOpacity,
          ),
        } as CSSProperties
      }
    >
      {dialogueSkinAsset ? (
        <StoryAssetImage
          fileId={dialogueSkinAsset.fileId}
          alt=""
          className="galgame-dialogue-skin-image"
          fallback={null}
        />
      ) : null}
      {displayDialogue ? (
        <>
          {dialogueAvatarAsset?.type === "image" ? (
            <span
              className="galgame-dialogue-runtime-avatar"
              style={
                {
                  "--avatar-x": `${activeDialogueAvatar?.crop?.x ?? 50}%`,
                  "--avatar-y": `${activeDialogueAvatar?.crop?.y ?? 25}%`,
                  "--avatar-scale": activeDialogueAvatar?.crop?.scale ?? 1.8,
                } as CSSProperties
              }
            >
              <StoryAssetImage
                fileId={dialogueAvatarAsset.fileId}
                alt=""
                fallback={null}
              />
            </span>
          ) : null}
          <strong
            className="galgame-dialogue-speaker-name"
            style={namePositionStyle}
          >
            {dialogueSpeakerIds(displayDialogue)
              .map((speakerId, index) => {
                const character = characters.get(speakerId);
                return index === 0
                  ? dialogueDisplayName(
                      character,
                      activeDialogue?.displayNameId,
                      runtimeVariables,
                    )
                  : (character?.name ?? "未知角色");
              })
              .join("、")}
          </strong>
        </>
      ) : (
        <small
          className="galgame-dialogue-speaker-name"
          style={namePositionStyle}
        >
          旁白
        </small>
      )}
      <span className="galgame-dialogue-body" style={bodyPositionStyle}>
        {visibleRichContent ? (
          <RichTextView
            content={visibleRichContent}
            document={document}
            variables={runtimeVariables}
          />
        ) : (
          Array.from(displayText).slice(0, visibleTextLength).join("")
        )}
      </span>
      {indicatorVisible ? (
        <em className="galgame-dialogue-advance-indicator">
          {dialogueStyle.advanceIndicator.style === "compact" ? (
            <i aria-hidden />
          ) : null}
          {indicatorText}
        </em>
      ) : null}
    </button>
  );
}
