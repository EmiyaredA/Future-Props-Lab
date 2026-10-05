import { useId, useMemo, useRef } from "react";
import {
  Info,
  Monitor,
  Play,
  SlidersHorizontal,
  TriangleAlert,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { PetDocument } from "./api";
import type { PetRendererHandle } from "./PetRenderer";
import { reactionForHit } from "./interaction";
import { DesktopPetFigure } from "./DesktopPetFigure";
import {
  EVENT_LABELS,
  MOTION_LABELS,
  EXPRESSION_LABELS,
  reactionFor,
  reactionMotionUnavailable,
  reactionExpressionUnavailable,
} from "./playback";
import type { EditorTab, useEditorPreview } from "./useEditorPreview";
import type { useDesktopPreviewLink } from "./useDesktopPreviewLink";
import { MOTION_DEMOS, type MotionDemo } from "./locomotion/demo";
import { useVirtualMotion } from "./locomotion/useVirtualMotion";
import {
  humanMotionUnavailable,
  sequenceDemoUnavailable,
} from "./locomotion/motionAvailability";
import { modelSequences } from "./sequences/capabilities";

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
  const linkStatusId = useId();
  const checker = ["look", "events", "lines"].includes(tab);
  const habits = document.config.habits;
  const availability = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(MOTION_DEMOS) as MotionDemo[]).map((id) => [
          id,
          document.sourceType !== "coopanion-whale"
            ? "Live2D 暂不支持"
            : sequenceDemoUnavailable(document.whaleModel, id),
        ]),
      ),
    [document.whaleModel, document.sourceType],
  );
  const unavailableMotion = preview.motionDemo
    ? availability[preview.motionDemo]
    : null;
  const sequenceResource = useMemo(
    () => modelSequences(document.whaleModel),
    [document.whaleModel],
  );
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
  const previewIssues = Array.from(
    new Set(
      [
        unavailableMotion,
        reactionMotionUnavailable(document, reaction.motionId),
        reactionExpressionUnavailable(document, reaction.expressionId),
        virtual.error,
      ].filter((message): message is string => Boolean(message)),
    ),
  );
  const resourceIssue = whale
    ? humanMotionUnavailable(document.whaleModel)
    : null;
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
        <div className="dp-stage-heading">
          <h2>实时预览</h2>
          <p>修改后立即查看当前效果</p>
        </div>
        <div className="dp-stage-actions">
          <span className="dp-preview-mode" data-mode={preview.mode}>
            {preview.mode === "inspect" ? (
              <SlidersHorizontal size={15} aria-hidden="true" />
            ) : (
              <Play size={15} aria-hidden="true" />
            )}
            {preview.mode === "inspect"
              ? "调整预览"
              : preview.mode === "event"
                ? "事件播放"
                : "已返回待机"}
          </span>
          <button type="button" onClick={preview.playSelected}>
            <Play size={16} aria-hidden="true" />
            播放事件
          </button>
        </div>
      </div>
      <div className="dp-preview-details" role="status">
        <span className="dp-preview-chip dp-preview-event">
          {EVENT_LABELS[preview.eventName]}
        </span>
        <span className="dp-preview-chip" aria-label={`动作：${motion}`}>
          {motion}
        </span>
        <span className="dp-preview-chip" aria-label={`表情：${expression}`}>
          {expression}
        </span>
        {preview.motionDemo && (
          <span className="dp-preview-chip">
            姿态：{MOTION_DEMOS[preview.motionDemo]}
            {unavailableMotion ? "（暂不支持）" : ""}
          </span>
        )}
      </div>
      {tab === "preview" && (
        <div className="dp-motion-demos dp-segments" aria-label="桌面活动演示">
          {(Object.entries(MOTION_DEMOS) as [MotionDemo, string][]).map(
            ([id, label]) => (
              <button
                key={id}
                type="button"
                disabled={Boolean(availability[id])}
                title={availability[id] ?? undefined}
                aria-pressed={preview.motionDemo === id}
                onClick={() => preview.demonstrate(id)}
              >
                {label}
                {whale && availability[id] ? "（暂不支持）" : ""}
              </button>
            ),
          )}
          {!whale && <span>Live2D 暂不支持这些姿态</span>}
        </div>
      )}
      {checker ? (
        <div className="dp-checker-stage">
          {tab === "look" && (
            <span className="dp-stage-badge">{figureName}</span>
          )}
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
              const target = figureRef.current;
              const reaction = reactionForHit(
                event.detail === 0
                  ? undefined
                  : target
                    ? target.classifyHit?.(event.clientX, event.clientY)
                    : null,
                event.clientY,
                bounds,
              );
              if (reaction) preview.play(reaction);
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
      {(previewIssues.length > 0 || resourceIssue) && (
        <div className="dp-stage-capability" role="status">
          <TriangleAlert size={18} aria-hidden="true" />
          <div>
            <strong>
              {previewIssues.length > 0
                ? "当前效果暂不可预览"
                : "部分动作尚未就绪"}
            </strong>
            {previewIssues.length > 0 ? (
              previewIssues.map((message) => <p key={message}>{message}</p>)
            ) : (
              <p>{resourceIssue}</p>
            )}
          </div>
        </div>
      )}
      <div className="dp-preview-link">
        <button
          type="button"
          role="switch"
          className="dp-preview-link-toggle"
          aria-checked={link.enabled}
          aria-describedby={linkStatusId}
          disabled={!link.available && !link.enabled}
          onClick={() => link.toggle()}
        >
          <Monitor size={16} aria-hidden="true" />
          同步预览到桌宠
          <span className="dp-switch-track" aria-hidden="true">
            <span />
          </span>
        </button>
        <span id={linkStatusId} role="status">
          {link.message}
        </span>
      </div>
      <div className="dp-stage-guidance">
        {preview.mode === "event" && habits?.sound ? (
          <Volume2 size={15} aria-hidden="true" />
        ) : (
          <VolumeX size={15} aria-hidden="true" />
        )}
        <span>
          {preview.mode === "event"
            ? habits?.sound
              ? "事件音效已开启"
              : "事件音效已关闭"
            : "自动预览 · 静音"}
        </span>
        <span className="dp-stage-play-hint">
          <Info size={15} aria-hidden="true" />
          播放事件检查完整反应
        </span>
      </div>
      <footer className="dp-stage-footer">
        <span>
          {whale
            ? sequenceResource.kind === "valid"
              ? "完整序列帧动画"
              : sequenceResource.kind === "invalid"
                ? "完整序列帧资源无效"
                : document.whaleModel?.rigProfile === "human-chibi"
                  ? "人物资源预览"
                  : "原版鲸鱼娘分件动画"
            : `角色画布 ${document.character?.width} × ${document.character?.height}`}
        </span>
        <span>草稿预览 · 保存后成为默认配置</span>
      </footer>
    </main>
  );
}
