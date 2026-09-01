import type { CSSProperties } from "react";
import {
  activeStageSpeakerIds,
  CHARACTER_DISTANCE_SCALE,
} from "@features/galgame-workshop/editor/stage";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { ExpressionPortrait } from "@features/galgame-workshop/editor/ExpressionPortrait";
import { storyPlayerSceneLayerStyle } from "@features/galgame-workshop/editor/storyPlayerSceneStyle";
import { StoryPlayerContentLayer } from "@features/galgame-workshop/editor/StoryPlayerContentLayer";
import { groundPortraitElement } from "@features/galgame-workshop/editor/portraitGrounding";
import {
  StoryPlayerAspectMenu,
  StoryPlayerEnableAudio,
  StoryPlayerHeader,
  StoryPlayerMixer,
  StoryPlayerRuntimeControls,
  type StoryPlayerViewModel,
} from "@features/galgame-workshop/editor/StoryPlayerControls";
import {
  cameraEasingCss,
  clampPlayerValue,
  storyPlayerCameraPlaneStyle,
} from "@features/galgame-workshop/editor/storyPlayerModel";

export function StoryPlayerView({ model }: { model: StoryPlayerViewModel }) {
  const {
    mode,
    chrome,
    editableCgBlockId,
    collapsed,
    onCgOverlayChange,
    document,
    frame,
    viewportPreferences,
    aspectParts,
    advanceRef,
    mouthFrame,
    scenes,
    showAuthoringOverlays,
    displayFrame,
    palette,
    stageScenes,
    activeVideoAsset,
    activeVideoOffsetMs,
    videoUrl,
    stageCgs,
    stageStyle,
    lipSyncSpeaking,
    currentAudioLevelDb,
    stageActors,
    customUiComponents,
    exportMode,
  } = model;
  const camera = displayFrame.stage.camera;
  const cameraTargets = (target: "background" | "characters" | "cg") =>
    Boolean(camera && (camera.target === "stage" || camera.target === target));
  const cameraEasing = cameraEasingCss(camera?.easing);
  const cameraPlaneStyle = (target: "background" | "characters" | "cg") =>
    storyPlayerCameraPlaneStyle(camera, target);
  const activeSpeakerIds = new Set(activeStageSpeakerIds(displayFrame.stage));
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
      <StoryPlayerHeader model={model} />
      <StoryPlayerAspectMenu model={model} />
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
          <StoryPlayerMixer model={model} />
          <StoryPlayerEnableAudio model={model} />
          {stageScenes.map(({ state, layer, asset }, index) => (
            <StoryAssetImage
              key={`${state.sourceBlockId}:${layer.id}`}
              fileId={asset.fileId}
              alt=""
              className="galgame-player-background galgame-player-background-layer galgame-camera-plane"
              data-entering={
                state.entering && state.transition.fade ? "true" : undefined
              }
              data-exiting={state.exiting ? "true" : undefined}
              data-camera-effect={
                cameraTargets("background") ? camera?.effect : undefined
              }
              style={storyPlayerSceneLayerStyle({
                index,
                state,
                layer,
                camera,
                cameraActive: cameraTargets("background"),
                cameraEasing,
              })}
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
                width: "max-content",
                maxWidth: "82%",
                fontSize: displayFrame.stage.floatingText.fontSize
                  ? `${displayFrame.stage.floatingText.fontSize / 19.2}cqw`
                  : "clamp(18px, 3cqw, 48px)",
                fontWeight: 700,
                lineHeight: 1.5,
                textAlign: "center",
                whiteSpace: "pre-line",
                textShadow: "0 2px 12px rgb(0 0 0 / 0.75)",
                animation:
                  displayFrame.stage.floatingText.durationMs >= 5000
                    ? "none"
                    : undefined,
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
          {!exportMode &&
          showAuthoringOverlays &&
          customUiComponents.length === 0 ? (
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
              (
                {
                  actor,
                  character,
                  renderedExpressionId,
                  controlledFrameIndex,
                  expression,
                  skinAssetId,
                  overlays,
                },
                actorStackIndex,
              ) => {
                const focused = activeSpeakerIds.has(actor.characterId);
                const hasActiveSpeakers = activeSpeakerIds.size > 0;
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
                      zIndex: actorStackIndex + 10,
                      opacity: actor.exiting ? 0 : actor.transform.opacity,
                      filter: `brightness(${actor.transform.brightness * focusMultiplier})`,
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
                        onImageLoad={groundPortraitElement}
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
                key={`${state.sourceBlockId}:${state.cgId}:${state.variantId}`}
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
          <StoryPlayerContentLayer model={model} />
        </div>
      </div>
      <StoryPlayerRuntimeControls model={model} />
    </section>
  );
}
