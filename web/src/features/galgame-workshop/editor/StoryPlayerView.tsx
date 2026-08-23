import { type CSSProperties } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  Pause,
  Play,
  Ratio,
  RotateCcw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
} from "lucide-react";
import { CHARACTER_DISTANCE_SCALE } from "@features/galgame-workshop/editor/stage";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { ExpressionPortrait } from "@features/galgame-workshop/editor/ExpressionPortrait";
import { stageAspectModeLabel } from "@features/galgame-workshop/editor/stageViewportPreferences";
import { RichTextView } from "@features/galgame-workshop/editor/RichTextEditor";
import { dialogueDisplayName } from "@features/galgame-workshop/editor/richText";
import type { useStoryPlayerController } from "@features/galgame-workshop/editor/useStoryPlayerController";
import {
  STAGE_ASPECT_OPTIONS,
  clampPlayerValue,
  formatTimelineTime,
  playerAdvanceIndicatorText,
  playerHexToRgba,
} from "@features/galgame-workshop/editor/storyPlayerModel";
type StoryPlayerViewModel = ReturnType<typeof useStoryPlayerController>;

export function StoryPlayerView({ model }: { model: StoryPlayerViewModel }) {
  const {
    mode,
    chrome,
    editableCgBlockId,
    collapsed,
    onCollapsedChange,
    headerModeControl,
    workbenchHeader,
    onCgOverlayChange,
    document,
    frame,
    runtimeRef,
    mix,
    setMix,
    mixerOpen,
    setMixerOpen,
    aspectMenuOpen,
    setAspectMenuOpen,
    viewportPreferences,
    updateViewportPreferences,
    customWidthDraft,
    setCustomWidthDraft,
    customHeightDraft,
    setCustomHeightDraft,
    aspectParts,
    advanceMode,
    visibleTextLength,
    inlinePlayerWait,
    advanceRef,
    autoplayBlocked,
    setAutoplayBlocked,
    timelinePositionMs,
    timelinePlaying,
    mouthFrame,
    voiceRef,
    pendingRef,
    tryPlay,
    characters,
    scenes,
    displayFrame,
    palette,
    activeDialogue,
    runtimeVariables,
    activeTimeline,
    activeSceneLayers,
    activeVideoAsset,
    activeVideoOffsetMs,
    videoUrl,
    stageCgs,
    dialogueStyle,
    dialogueSkinAsset,
    stageStyle,
    lipSyncSpeaking,
    currentAudioLevelDb,
    stageActors,
    activeDialogueAvatar,
    dialogueAvatarAsset,
    customUiComponents,
    restart,
    enterFragment,
    seekTimeline,
    skipTimelineStep,
    toggleTimeline,
    selectAdvanceMode,
    paragraphGroup,
    advance,
    displayText,
    visibleRichContent,
    paragraphVisibleContents,
    systemMessageStyle,
    resolveSystemMessage,
    exportMode,
    selectedExportChoiceId,
  } = model;
  const camera = displayFrame.stage.camera;
  const cameraTargets = (target: "background" | "characters" | "cg") =>
    Boolean(camera && (camera.target === "stage" || camera.target === target));
  const cameraEasing = camera?.easing
    .replace("easeInOut", "ease-in-out")
    .replace("easeIn", "ease-in")
    .replace("easeOut", "ease-out");
  const cameraPlaneStyle = (
    target: "background" | "characters" | "cg",
  ): CSSProperties | undefined =>
    cameraTargets(target) && camera
      ? ({
          transform: `translate(${camera.x}%, ${camera.y}%) scale(${camera.scale}) rotate(${camera.rotation}deg)`,
          transition: `transform ${camera.durationMs}ms ${cameraEasing}`,
          animationDuration: `${camera.durationMs}ms`,
          "--galgame-camera-intensity": camera.intensity,
        } as CSSProperties)
      : undefined;
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
    dialogueStyle.body.fontSizePx,
    `clamp(14px, ${dialogueStyle.fontScale * 1.25}cqw, 28px)`,
    12,
  );
  const dialogueNameFontSize = logicalFontSize(
    dialogueStyle.speakerName.fontSizePx,
    "1em",
    10,
  );
  const dialogueIndicatorVisible =
    dialogueStyle.advanceIndicator.visible &&
    (!exportMode || dialogueStyle.advanceIndicator.showInExport);
  const dialogueIndicatorText = playerAdvanceIndicatorText({
    compact: dialogueStyle.advanceIndicator.style === "compact",
    advanceMode,
    visibleTextLength,
    textLength: Array.from(displayText).length,
    editing: mode === "edit",
    waiting: inlinePlayerWait,
  });
  return (
    <section
      className={`galgame-player${exportMode ? " galgame-player-export" : ""}${chrome === "stage-only" ? " galgame-player-stage-only" : ""}`}
      aria-label="游戏预览"
      data-lip-sync-speaking={lipSyncSpeaking ? "true" : "false"}
      data-mouth-frame={mouthFrame}
      data-audio-level-db={
        currentAudioLevelDb == null ? undefined : currentAudioLevelDb.toFixed(1)
      }
    >
      {!exportMode && chrome === "full" ? (
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
                  {scenes.get(displayFrame.stage.sceneId ?? "")?.name ??
                    "空舞台"}
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
      ) : null}
      {!exportMode && chrome === "full" && aspectMenuOpen ? (
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
                    setCustomHeightDraft(
                      String(viewportPreferences.customHeight),
                    )
                  }
                />
              </label>
            </div>
          ) : null}
        </section>
      ) : null}
      <div
        className="galgame-stage-host"
        data-aspect-mode={viewportPreferences.aspectMode}
        hidden={collapsed || undefined}
        style={
          aspectParts
            ? ({
                "--galgame-stage-aspect-w": String(aspectParts.width),
                "--galgame-stage-aspect-h": String(aspectParts.height),
              } as CSSProperties)
            : undefined
        }
      >
        <div
          className={`galgame-stage${displayFrame.stage.stageAnimation ? " is-stage-animated" : ""}`}
          data-stage-animation={displayFrame.stage.stageAnimation?.animation}
          data-aspect={
            aspectParts ? `${aspectParts.width}:${aspectParts.height}` : "auto"
          }
          style={{
            background: `radial-gradient(circle at 55% 25%, ${palette.first}, ${palette.second})`,
            ...(aspectParts
              ? {
                  aspectRatio: `${aspectParts.width} / ${aspectParts.height}`,
                }
              : null),
            animationDuration: displayFrame.stage.stageAnimation
              ? `${displayFrame.stage.stageAnimation.durationMs}ms`
              : undefined,
          }}
        >
          {mixerOpen ? (
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
          ) : null}
          {autoplayBlocked ? (
            <button
              type="button"
              className="galgame-player-enable-audio"
              onClick={() => {
                const pending = [...pendingRef.current];
                setAutoplayBlocked(false);
                void voiceRef.current?.levelMonitor
                  ?.resume()
                  .catch(() => undefined);
                for (const audio of pending) {
                  void tryPlay(audio);
                }
              }}
            >
              <Volume2 aria-hidden /> 点击启用声音
            </button>
          ) : null}
          {activeSceneLayers.map(({ layer, asset }, index) => (
            <StoryAssetImage
              key={layer.id}
              fileId={asset.fileId}
              alt=""
              className="galgame-player-background galgame-player-background-layer galgame-camera-plane"
              data-camera-effect={
                cameraTargets("background") ? camera?.effect : undefined
              }
              style={{
                zIndex: index,
                transform:
                  cameraTargets("background") && camera
                    ? `translate(${layer.offsetX + camera.x / layer.distance}%, ${layer.offsetY + camera.y / layer.distance}%) scale(${1 + (camera.scale - 1) / layer.distance}) rotate(${camera.rotation / layer.distance}deg)`
                    : `translate(${layer.offsetX}%, ${layer.offsetY}%)`,
                transformOrigin: "center",
                transition:
                  cameraTargets("background") && camera
                    ? `transform ${camera.durationMs}ms ${cameraEasing}`
                    : undefined,
                animationDuration:
                  cameraTargets("background") && camera
                    ? `${camera.durationMs}ms`
                    : undefined,
              }}
              fallback={null}
            />
          ))}
          {videoUrl && displayFrame.stage.video ? (
            <video
              className="galgame-player-video galgame-camera-plane"
              data-camera-effect={
                cameraTargets("background") ? camera?.effect : undefined
              }
              src={videoUrl}
              autoPlay={mode === "play"}
              loop={displayFrame.stage.video.loop}
              muted={displayFrame.stage.video.volume === 0}
              onPlay={() => {
                if (!activeVideoAsset) return;
                exportMode?.onAudioEvent?.({
                  action: "play",
                  channel: "video",
                  storyAssetId: activeVideoAsset.id,
                  offsetMs: activeVideoOffsetMs,
                  volume: (displayFrame.stage.video?.volume ?? 100) / 100,
                  loop: displayFrame.stage.video?.loop ?? false,
                  fadeMs: 0,
                });
              }}
              onLoadedMetadata={(event) => {
                event.currentTarget.volume =
                  displayFrame.stage.video?.volume != null
                    ? displayFrame.stage.video.volume / 100
                    : 1;
                const durationMs = Number.isFinite(event.currentTarget.duration)
                  ? Math.max(0, event.currentTarget.duration * 1000)
                  : 0;
                const offsetMs =
                  durationMs > 0 && displayFrame.stage.video?.loop
                    ? activeVideoOffsetMs % durationMs
                    : activeVideoOffsetMs;
                event.currentTarget.currentTime = Math.max(0, offsetMs) / 1000;
              }}
              onEnded={() => {
                if (
                  mode === "play" &&
                  frame.mode === "content" &&
                  frame.block.type === "video" &&
                  frame.block.waitForCompletion
                )
                  advanceRef.current();
              }}
              style={{
                objectFit: displayFrame.stage.video.fit,
                ...cameraPlaneStyle("background"),
              }}
            />
          ) : null}
          {displayFrame.stage.particle ? (
            <div
              className={`galgame-player-particles is-${displayFrame.stage.particle.preset}`}
              style={{
                opacity: Math.min(1, displayFrame.stage.particle.density / 2),
              }}
              aria-label={`${displayFrame.stage.particle.preset} 粒子效果`}
            />
          ) : null}
          {displayFrame.stage.floatingText ? (
            <div
              className="galgame-player-floating-text"
              style={{
                left: `${displayFrame.stage.floatingText.x}%`,
                top: `${displayFrame.stage.floatingText.y}%`,
                color: displayFrame.stage.floatingText.color,
                animationDuration: `${displayFrame.stage.floatingText.durationMs}ms`,
              }}
            >
              {displayFrame.stage.floatingText.text}
            </div>
          ) : null}
          {displayFrame.stage.curtain ? (
            <div
              key={displayFrame.stage.curtain.transitionKey}
              className={`galgame-player-curtain is-${displayFrame.stage.curtain.mode} is-${displayFrame.stage.curtain.action}`}
              aria-label={`${
                {
                  fullscreen: "全屏",
                  letterbox: "上下黑边",
                  pillarbox: "左右黑边",
                  frame: "四周黑边",
                }[displayFrame.stage.curtain.mode]
              }幕布${displayFrame.stage.curtain.visible ? "合上" : "打开"}`}
              style={
                {
                  "--curtain-color": displayFrame.stage.curtain.color,
                  "--curtain-opacity": displayFrame.stage.curtain.opacity,
                  "--curtain-duration": `${displayFrame.stage.curtain.durationMs}ms`,
                } as CSSProperties
              }
            >
              <i className="galgame-player-curtain-panel is-fullscreen" />
              <i className="galgame-player-curtain-panel is-top" />
              <i className="galgame-player-curtain-panel is-bottom" />
              <i className="galgame-player-curtain-panel is-left" />
              <i className="galgame-player-curtain-panel is-right" />
            </div>
          ) : null}
          {customUiComponents.map(({ component, asset }) => (
            <div
              key={component.id}
              className="galgame-player-ui-component"
              data-component-id={component.id}
              style={{
                left: `${component.x}%`,
                top: `${component.y}%`,
                width: `${component.width}%`,
                zIndex: component.layer + 40,
              }}
            >
              <StoryAssetImage
                fileId={asset.fileId}
                alt={component.name}
                className="galgame-player-ui-component-image"
                fallback={null}
              />
            </div>
          ))}
          {customUiComponents.length === 0 ? (
            <span>
              {scenes.get(displayFrame.stage.sceneId ?? "")?.name ??
                "等待场景 Block"}
            </span>
          ) : null}
          <div
            className="galgame-character-camera-plane galgame-camera-plane"
            data-camera-effect={
              cameraTargets("characters") ? camera?.effect : undefined
            }
            style={cameraPlaneStyle("characters")}
          >
            {stageActors.map(
              ({
                actor,
                character,
                renderedExpressionId,
                controlledFrameIndex,
                expression,
                skinAssetId,
                overlays,
              }) => {
                const focused =
                  displayFrame.stage.activeSpeakerIds?.includes(
                    actor.characterId,
                  ) ?? displayFrame.stage.activeSpeakerId === actor.characterId;
                const hasActiveSpeakers = Boolean(
                  displayFrame.stage.activeSpeakerIds?.length ??
                  displayFrame.stage.activeSpeakerId,
                );
                const focusMultiplier =
                  stageStyle.speakerFocusEnabled &&
                  hasActiveSpeakers &&
                  !focused
                    ? stageStyle.inactiveBrightness
                    : 1;
                const spriteAnimation =
                  displayFrame.stage.spriteAnimations?.[actor.characterId];
                const spriteDirection =
                  spriteAnimation?.direction === "left" ||
                  (spriteAnimation?.direction === "towardCenter" &&
                    actor.transform.x > 50) ||
                  (spriteAnimation?.direction === "awayFromCenter" &&
                    actor.transform.x <= 50)
                    ? -1
                    : 1;
                const spriteIntensity = spriteAnimation?.intensity ?? 1;
                const spriteAmplitude =
                  {
                    breathe: 0.8,
                    idle: 0.8,
                    nod: 2,
                    shake: 2,
                    startle: 4,
                    lean: 4,
                    recoil: -4,
                    step: 5,
                    tug: 6,
                    bounce: 5,
                  }[spriteAnimation?.animation ?? ""] ?? 2.5;
                const spriteX =
                  spriteDirection * spriteIntensity * spriteAmplitude;
                const spriteY = spriteIntensity * spriteAmplitude;
                const effectiveFlipX =
                  Boolean(expression?.flipX) !== actor.transform.flipX;
                return (
                  <div
                    key={actor.characterId}
                    className="galgame-stage-actor"
                    data-character-id={actor.characterId}
                    data-sprite-animation={spriteAnimation?.animation}
                    data-expression-id={renderedExpressionId ?? undefined}
                    data-entering={
                      actor.entering && actor.transition.fade
                        ? "true"
                        : undefined
                    }
                    data-exiting={actor.exiting ? "true" : undefined}
                    style={{
                      left: `${actor.transform.x}%`,
                      top: `${actor.transform.y}%`,
                      zIndex: actor.transform.layer + 10,
                      opacity: actor.exiting ? 0 : actor.transform.opacity,
                      filter: `brightness(${actor.transform.brightness * focusMultiplier}) drop-shadow(0 6px 14px rgb(0 0 0 / 0.3))`,
                      transformOrigin:
                        actor.transform.anchor === "center"
                          ? "center"
                          : actor.transform.anchor === "topLeft"
                            ? "top left"
                            : "bottom center",
                      transform: `${
                        actor.transform.anchor === "center"
                          ? "translate(-50%, -50%)"
                          : actor.transform.anchor === "topLeft"
                            ? "translate(0, 0)"
                            : "translate(-50%, -100%)"
                      } scale(${actor.transform.scale}) scaleX(${effectiveFlipX ? -1 : 1})`,
                      transitionDuration: `${actor.transition.durationMs}ms, ${actor.transition.durationMs}ms, ${actor.transition.durationMs}ms, ${stageStyle.focusTransitionMs}ms, ${actor.transition.durationMs}ms`,
                      animationDuration: `${actor.transition.durationMs}ms`,
                      height: `${(expression?.heightPercent ?? document.settings?.characterStageOverrides?.[character.id]?.defaultHeightPercent ?? character.portraitHeightPercent ?? document.settings?.characterStage?.defaultHeightPercent ?? 100) * CHARACTER_DISTANCE_SCALE[actor.distance]}%`,
                    }}
                  >
                    <div
                      key={spriteAnimation?.sourceBlockId ?? "still"}
                      className={`galgame-sprite-motion${spriteAnimation ? " is-sprite-animated" : ""}`}
                      data-sprite-animation={spriteAnimation?.animation}
                      data-sprite-direction={spriteAnimation?.direction}
                      style={
                        spriteAnimation
                          ? ({
                              animationDuration: `${spriteAnimation.durationMs}ms`,
                              animationIterationCount: spriteAnimation.loop
                                ? "infinite"
                                : undefined,
                              animationTimingFunction: spriteAnimation.easing
                                .replace("easeInOut", "ease-in-out")
                                .replace("easeIn", "ease-in")
                                .replace("easeOut", "ease-out"),
                              "--galgame-sprite-intensity":
                                spriteAnimation.intensity,
                              "--galgame-sprite-x": `${spriteX}%`,
                              "--galgame-sprite-x-reverse": `${-spriteX}%`,
                              "--galgame-sprite-x-quarter": `${spriteX * 0.25}%`,
                              "--galgame-sprite-y": `${-spriteY}%`,
                              "--galgame-sprite-y-reverse": `${spriteY * 0.25}%`,
                              "--galgame-sprite-rotation": `${spriteDirection * spriteIntensity * 1.5}deg`,
                              "--galgame-sprite-scale":
                                1 + 0.012 * spriteIntensity,
                            } as CSSProperties)
                          : undefined
                      }
                    >
                      <ExpressionPortrait
                        expression={expression}
                        assets={document.assets ?? []}
                        skinAssetId={skinAssetId}
                        controlledFrameIndex={controlledFrameIndex}
                        alt=""
                        className="galgame-player-portrait-image"
                        fallback={
                          <span className="galgame-player-portrait-fallback">
                            {character.name.slice(0, 1) || "角"}
                          </span>
                        }
                      />
                      {overlays.map(({ overlay, asset: overlayAsset }) => (
                        <StoryAssetImage
                          key={overlay.id}
                          fileId={overlayAsset.fileId}
                          alt=""
                          className="galgame-player-character-overlay"
                          style={{
                            left: `${overlay.x}%`,
                            top: `${overlay.y}%`,
                            width: `${overlay.width}%`,
                            opacity: overlay.opacity,
                          }}
                          fallback={null}
                        />
                      ))}
                    </div>
                  </div>
                );
              },
            )}
          </div>
          {stageCgs.map(({ key, state, cg, variant, asset }) => {
            const overlay = state.displayMode === "overlay";
            const editable =
              key === "active" &&
              overlay &&
              mode === "edit" &&
              state.sourceBlockId === editableCgBlockId;
            const updatePosition = (x: number, y: number) =>
              onCgOverlayChange?.({
                ...state.overlay,
                x: clampPlayerValue(x, 0, 100),
                y: clampPlayerValue(y, 0, 100),
              });
            return (
              <div
                key={`${key}:${state.cgId}:${state.variantId}`}
                className={`galgame-player-cg galgame-camera-plane${editable ? " is-editable" : ""}`}
                data-camera-effect={
                  cameraTargets("cg") ? camera?.effect : undefined
                }
                data-cg-id={state.cgId}
                data-variant-id={state.variantId}
                data-display-mode={state.displayMode}
                data-fit={state.fit}
                data-entering={
                  state.entering && state.transition.fade ? "true" : undefined
                }
                data-exiting={state.exiting ? "true" : undefined}
                tabIndex={editable ? 0 : -1}
                style={
                  {
                    "--galgame-cg-opacity": state.overlay.opacity,
                    left: overlay ? `${state.overlay.x}%` : undefined,
                    top: overlay ? `${state.overlay.y}%` : undefined,
                    width: overlay ? `${state.overlay.width}%` : undefined,
                    zIndex:
                      overlay && state.overlay.placement === "behindCharacters"
                        ? 5
                        : 35,
                    transitionDuration: `${state.transition.fade ? state.transition.durationMs : 0}ms`,
                    transitionProperty: cameraTargets("cg")
                      ? "opacity, transform"
                      : "opacity",
                    transitionTimingFunction: cameraTargets("cg")
                      ? cameraEasing
                      : undefined,
                    transform:
                      cameraTargets("cg") && camera
                        ? `${overlay ? "translate(-50%, -50%) " : ""}translate(${camera.x}%, ${camera.y}%) scale(${camera.scale}) rotate(${camera.rotation}deg)`
                        : undefined,
                    animationDuration:
                      cameraTargets("cg") && camera
                        ? `${camera.durationMs}ms`
                        : `${state.transition.fade ? state.transition.durationMs : 0}ms`,
                  } as CSSProperties
                }
                aria-label={`${editable ? "调整 " : ""}${cg?.name ?? "剧情 CG"} · ${variant?.label ?? "默认差分"}`}
                onPointerDown={
                  editable && onCgOverlayChange
                    ? (event) => {
                        if (
                          event.target instanceof Element &&
                          event.target.closest(".galgame-player-cg-resize")
                        )
                          return;
                        const stage =
                          event.currentTarget.closest(".galgame-stage");
                        if (!(stage instanceof HTMLElement)) return;
                        event.currentTarget.setPointerCapture(event.pointerId);
                        const move = (moveEvent: PointerEvent) => {
                          const bounds = stage.getBoundingClientRect();
                          updatePosition(
                            ((moveEvent.clientX - bounds.left) / bounds.width) *
                              100,
                            ((moveEvent.clientY - bounds.top) / bounds.height) *
                              100,
                          );
                        };
                        const finish = () => {
                          window.removeEventListener("pointermove", move);
                          window.removeEventListener("pointerup", finish);
                          window.removeEventListener("pointercancel", finish);
                        };
                        window.addEventListener("pointermove", move);
                        window.addEventListener("pointerup", finish, {
                          once: true,
                        });
                        window.addEventListener("pointercancel", finish, {
                          once: true,
                        });
                      }
                    : undefined
                }
                onKeyDown={
                  editable && onCgOverlayChange
                    ? (event) => {
                        const step = event.shiftKey ? 5 : 1;
                        const delta = {
                          ArrowLeft: [-step, 0],
                          ArrowRight: [step, 0],
                          ArrowUp: [0, -step],
                          ArrowDown: [0, step],
                        }[event.key];
                        if (!delta) return;
                        event.preventDefault();
                        updatePosition(
                          state.overlay.x + delta[0],
                          state.overlay.y + delta[1],
                        );
                      }
                    : undefined
                }
              >
                <StoryAssetImage
                  fileId={asset.fileId}
                  alt=""
                  className="galgame-player-cg-image"
                  fallback={null}
                />
                {editable && onCgOverlayChange ? (
                  <i
                    role="separator"
                    tabIndex={0}
                    className="galgame-player-cg-resize"
                    aria-label="调整 CG 画面宽度"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const stage =
                        event.currentTarget.closest(".galgame-stage");
                      if (!(stage instanceof HTMLElement)) return;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      const startX = event.clientX;
                      const startWidth = state.overlay.width;
                      const move = (moveEvent: PointerEvent) => {
                        const bounds = stage.getBoundingClientRect();
                        onCgOverlayChange({
                          ...state.overlay,
                          width: clampPlayerValue(
                            startWidth +
                              ((moveEvent.clientX - startX) / bounds.width) *
                                200,
                            5,
                            200,
                          ),
                        });
                      };
                      const finish = () => {
                        window.removeEventListener("pointermove", move);
                        window.removeEventListener("pointerup", finish);
                        window.removeEventListener("pointercancel", finish);
                      };
                      window.addEventListener("pointermove", move);
                      window.addEventListener("pointerup", finish, {
                        once: true,
                      });
                      window.addEventListener("pointercancel", finish, {
                        once: true,
                      });
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key !== "ArrowLeft" &&
                        event.key !== "ArrowRight"
                      )
                        return;
                      event.preventDefault();
                      event.stopPropagation();
                      const step = event.shiftKey ? 5 : 1;
                      onCgOverlayChange({
                        ...state.overlay,
                        width: clampPlayerValue(
                          state.overlay.width +
                            (event.key === "ArrowRight" ? step : -step),
                          5,
                          200,
                        ),
                      });
                    }}
                  />
                ) : null}
              </div>
            );
          })}
          {displayFrame.mode === "idle" ? (
            exportMode ? null : (
              <button
                className="galgame-player-start"
                type="button"
                onClick={restart}
                disabled={mode === "edit"}
              >
                <Play aria-hidden />{" "}
                {mode === "edit" ? "选择一个 Block" : "开始试玩"}
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
                  <button
                    type="button"
                    onClick={() => resolveSystemMessage(false)}
                  >
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
            <button
              className={`galgame-dialogue-box layout-${dialogueStyle.layout.mode} background-${dialogueStyle.background.mode} body-${dialogueStyle.body.align} name-${dialogueStyle.speakerName.placement} name-decoration-${dialogueStyle.speakerName.decoration} indicator-${dialogueStyle.advanceIndicator.position} indicator-style-${dialogueStyle.advanceIndicator.style} top-rule-${dialogueStyle.background.topRule}`}
              type="button"
              onClick={mode === "play" ? advance : undefined}
              style={
                {
                  background:
                    dialogueStyle.background.mode === "verticalGradient"
                      ? `linear-gradient(180deg, ${playerHexToRgba(
                          dialogueStyle.backgroundColor,
                          dialogueStyle.background.gradientTopOpacity,
                        )}, ${playerHexToRgba(
                          dialogueStyle.backgroundColor,
                          dialogueStyle.background.gradientBottomOpacity,
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
                  "--dialogue-body-font-size": dialogueBodyFontSize,
                  "--dialogue-name-font-size": dialogueNameFontSize,
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
              {displayFrame.block.type === "dialogue" ? (
                <>
                  {dialogueAvatarAsset?.type === "image" ? (
                    <span
                      className="galgame-dialogue-runtime-avatar"
                      style={
                        {
                          "--avatar-x": `${activeDialogueAvatar?.crop?.x ?? 50}%`,
                          "--avatar-y": `${activeDialogueAvatar?.crop?.y ?? 25}%`,
                          "--avatar-scale":
                            activeDialogueAvatar?.crop?.scale ?? 1.8,
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
                  <strong className="galgame-dialogue-speaker-name">
                    {dialogueSpeakerIds(displayFrame.block)
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
                <small className="galgame-dialogue-speaker-name">旁白</small>
              )}
              <span className="galgame-dialogue-body">
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
              {dialogueIndicatorVisible ? (
                <em className="galgame-dialogue-advance-indicator">
                  {dialogueStyle.advanceIndicator.style === "compact" ? (
                    <i aria-hidden />
                  ) : null}
                  {dialogueIndicatorText}
                </em>
              ) : null}
            </button>
          ) : null}
        </div>
      </div>
      {!exportMode &&
      chrome === "full" &&
      mode === "play" &&
      displayFrame.mode !== "idle" ? (
        <div className="galgame-player-runtime-controls" aria-label="试玩控制">
          {activeTimeline &&
          (displayFrame.mode === "content" ||
            displayFrame.mode === "stageOnly") ? (
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
                  {timelinePlaying ? (
                    <Pause aria-hidden />
                  ) : (
                    <Play aria-hidden />
                  )}
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
      ) : null}
    </section>
  );
}
