import { useRef } from "react";
import type { PetDocument } from "./api";
import type { PetRendererHandle } from "./PetRenderer";
import { DesktopPetFigure } from "./DesktopPetFigure";
import {
  EVENT_LABELS,
  MOTION_LABELS,
  EXPRESSION_LABELS,
  reactionFor,
} from "./playback";
import type { EditorTab, useEditorPreview } from "./useEditorPreview";
import type { useDesktopPreviewLink } from "./useDesktopPreviewLink";
import { MOTION_DEMOS, type MotionDemo } from "./locomotion/demo";
import { useVirtualMotion } from "./locomotion/useVirtualMotion";
import { humanMotionUnavailable } from "./locomotion/motionAvailability";

export function EditorStage({
  document,
  tab,
  skinId,
  figureName,
  preview,
  link,
}: {
  document: PetDocument;
  tab: EditorTab;
  skinId: string | null;
  figureName: string;
  preview: ReturnType<typeof useEditorPreview>;
  link: ReturnType<typeof useDesktopPreviewLink>;
}) {
  const checker = ["look", "events", "lines"].includes(tab);
  const habits = document.config.habits;
  const unavailableMotion = humanMotionUnavailable(document.whaleModel);
  const figureRef = useRef<PetRendererHandle>(null);
  const virtual = useVirtualMotion(
    tab === "preview" && !unavailableMotion ? preview.motionDemo : null,
    preview.key,
    habits?.size ?? 220,
    () => figureRef.current?.geometry?.()?.strideLength,
    () => ({
      transition: figureRef.current?.motionTransition?.() ?? null,
      failure: figureRef.current?.motionFailure?.() ?? null,
    }),
    () => figureRef.current?.cancelMotionPlayback?.(),
  );
  const reaction = reactionFor(document, preview.eventName);
  const whale = document.sourceType === "coopanion-whale";
  const fourEdges =
    (document.whaleModel?.motionRig as { version?: number } | undefined)
      ?.version === 2;
  const motion = reaction.motionId
    ? ((whale
        ? MOTION_LABELS[reaction.motionId]
        : document.character?.motions?.find(
            (item) => item.id === reaction.motionId,
          )?.name) ?? reaction.motionId)
    : "无动作";
  const expression = reaction.expressionId
    ? ((whale
        ? EXPRESSION_LABELS[reaction.expressionId]
        : document.character?.expressions?.find(
            (item) => item.id === reaction.expressionId,
          )?.name) ?? reaction.expressionId)
    : "无表情";
  const figure = (
    <DesktopPetFigure
      ref={figureRef}
      document={document}
      skinId={skinId}
      view={checker ? "center" : "floor"}
      eventName={preview.eventName}
      reactionKey={preview.key}
      playbackMode={preview.mode}
      motionDemo={unavailableMotion ? null : preview.motionDemo}
      locomotion={virtual.placement?.frame}
    />
  );
  return (
    <main className="dp-editor-center">
      <div className="dp-stage-tools">
        <button type="button" onClick={preview.playSelected}>
          ▶ 播放事件
        </button>
        <span>
          {preview.mode === "inspect"
            ? "调整预览"
            : preview.mode === "event"
              ? "事件播放"
              : "已返回待机"}
        </span>
      </div>
      <div className="dp-preview-details" role="status">
        {EVENT_LABELS[preview.eventName]} · {motion} · {expression}
        {preview.motionDemo && ` · 姿态：${MOTION_DEMOS[preview.motionDemo]}`}
      </div>
      {unavailableMotion && (
        <div className="dp-preview-details" role="status">
          {unavailableMotion}
        </div>
      )}
      {virtual.error && (
        <div className="dp-preview-details" role="status">
          {virtual.error}
        </div>
      )}
      <div className="dp-preview-link">
        <button
          type="button"
          role="switch"
          aria-checked={link.enabled}
          disabled={!link.available && !link.enabled}
          onClick={() => link.toggle()}
        >
          同步预览到桌宠{link.enabled ? "：开启" : "：关闭"}
        </button>
        <span role="status">{link.message}</span>
      </div>
      {tab === "preview" && (
        <div className="dp-motion-demos dp-segments" aria-label="桌面活动演示">
          {(Object.entries(MOTION_DEMOS) as [MotionDemo, string][]).map(
            ([id, label]) => (
              <button
                key={id}
                type="button"
                disabled={
                  !whale ||
                  Boolean(unavailableMotion) ||
                  (!fourEdges && ["climb-top", "climb-bottom"].includes(id))
                }
                title={
                  !whale
                    ? "Live2D 暂不支持"
                    : unavailableMotion
                      ? unavailableMotion
                      : !fourEdges && ["climb-top", "climb-bottom"].includes(id)
                        ? "此资源包未提供四边姿势"
                        : undefined
                }
                aria-pressed={preview.motionDemo === id}
                onClick={() => preview.demonstrate(id)}
              >
                {label}
                {unavailableMotion ||
                (!fourEdges && ["climb-top", "climb-bottom"].includes(id))
                  ? "（暂不支持）"
                  : ""}
              </button>
            ),
          )}
          {!whale && <span>Live2D 暂不支持这些姿态</span>}
        </div>
      )}
      {checker ? (
        <div className="dp-checker-stage">
          <span className="dp-stage-badge">
            {tab === "look" ? figureName : EVENT_LABELS[preview.eventName]}
          </span>
          <div className="dp-character-frame">{figure}</div>
          {preview.bubble && (
            <div className="dp-desktop-bubble">{preview.bubble}</div>
          )}
        </div>
      ) : (
        <div className="dp-desktop-stage" ref={virtual.stage}>
          <div className="dp-desktop-menubar">
            Future Props Lab · 文件 · 编辑 · 视图
          </div>
          <div className="dp-desktop-window">
            <div>正在工作的窗口</div>
            <span />
            <span />
            <span />
          </div>
          <button
            type="button"
            aria-label="触摸桌宠，试听反应"
            className="dp-desktop-pet"
            style={{
              height: habits?.size ?? 220,
              width: (habits?.size ?? 220) * 0.75,
              ...(virtual.placement
                ? {
                    left: virtual.placement.left,
                    top: virtual.placement.top,
                    right: "auto",
                    bottom: "auto",
                  }
                : {}),
            }}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              preview.play(
                event.clientY < bounds.top + bounds.height * 0.48
                  ? "pet"
                  : "click",
              );
            }}
          >
            {figure}
          </button>
          {preview.bubble && (
            <div className="dp-desktop-bubble">{preview.bubble}</div>
          )}
          <div className="dp-desktop-state">
            {habits?.roam === "off"
              ? "不乱动"
              : habits?.roam === "free"
                ? "常走动"
                : "多待着"}{" "}
            · 透明区域穿透
          </div>
        </div>
      )}
      <footer className="dp-stage-footer">
        <span>
          {whale
            ? document.whaleModel?.rigProfile === "human-chibi"
              ? "人物分件动画"
              : "原版鲸鱼娘分件动画"
            : `角色画布 ${document.character?.width} × ${document.character?.height}`}
        </span>
        <span>草稿预览 · 保存后成为默认配置</span>
      </footer>
    </main>
  );
}
