import type { CSSProperties } from "react";
import { Volume2 } from "lucide-react";
import type {
  GalgameStoryBlock,
  GalgameStoryChapter,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { formatTimecode } from "@features/galgame-workshop/editor/timeline";
import {
  CURTAIN_MODE_OPTIONS,
  WAIT_DURATION_PRESETS,
} from "@features/galgame-workshop/editor/blockRegistry";
import {
  BLOCK_LABELS,
  blockIcon,
  blockPreviewFileId,
  blockSummary,
} from "@features/galgame-workshop/editor/story-authoring/blockPresentation";

export function CommentCard({
  block,
  index,
  selected,
  onSelect,
  onBlock,
}: {
  block: Extract<GalgameStoryBlock, { type: "comment" }>;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onBlock: (block: GalgameStoryBlock) => void;
}) {
  return (
    <article
      className={`galgame-block-card galgame-comment-card is-comment${selected ? " selected" : ""}`}
      data-block-id={block.id}
      onClick={onSelect}
      onFocusCapture={onSelect}
      tabIndex={0}
    >
      <span className="galgame-block-index">{index + 1}</span>
      <span aria-hidden>#</span>
      <input
        aria-label="作者注释"
        value={block.text}
        placeholder="这条注释不会进入游戏"
        onChange={(event) => onBlock({ ...block, text: event.target.value })}
      />
    </article>
  );
}

function waitDurationLabel(durationMs: number | null) {
  if (durationMs == null) return "等待玩家继续";
  const seconds = durationMs / 1000;
  return `≈ ${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} 秒`;
}

function CurtainSwatch({
  mode,
  color,
}: {
  mode: Extract<GalgameStoryBlock, { type: "curtain" }>["mode"];
  color: string;
}) {
  return (
    <span
      className={`galgame-curtain-swatch is-${mode}`}
      style={{ "--curtain-card-color": color } as CSSProperties}
      aria-hidden
    >
      <i className="is-fullscreen" />
      <i className="is-top" />
      <i className="is-bottom" />
      <i className="is-left" />
      <i className="is-right" />
    </span>
  );
}

export function CurtainCard({
  block,
  index,
  selected,
  onSelect,
}: {
  block: Extract<GalgameStoryBlock, { type: "curtain" }>;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const modeLabel =
    CURTAIN_MODE_OPTIONS.find((option) => option.value === block.mode)?.label ??
    "全屏";
  return (
    <article
      className={`galgame-block-card galgame-curtain-card is-curtain${selected ? " selected" : ""}`}
      data-block-id={block.id}
      onFocusCapture={onSelect}
      tabIndex={0}
    >
      <span className="galgame-block-index">{index + 1}</span>
      <button
        type="button"
        className="galgame-block-select"
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="galgame-curtain-badge">
          {blockIcon(block.type)}
          <strong>幕布</strong>
        </span>
        <CurtainSwatch mode={block.mode} color={block.color} />
        <span className="galgame-curtain-copy">
          <b>{block.action === "show" ? "合上" : "打开"}</b>
          <em>{block.action === "show" ? "渐入幕布" : "渐出幕布"}</em>
        </span>
        <span className="galgame-curtain-meta">
          <small>{(block.durationMs / 1000).toFixed(1)}s</small>
          <small>{modeLabel}</small>
          <i style={{ backgroundColor: block.color }} aria-hidden />
        </span>
      </button>
    </article>
  );
}

export function WaitCard({
  block,
  index,
  selected,
  onSelect,
  onBlock,
}: {
  block: Extract<GalgameStoryBlock, { type: "wait" }>;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onBlock: (block: GalgameStoryBlock) => void;
}) {
  return (
    <article
      className={`galgame-block-card galgame-wait-card is-wait${selected ? " selected" : ""}`}
      data-block-id={block.id}
      onClick={onSelect}
      onFocusCapture={onSelect}
      tabIndex={0}
    >
      <span className="galgame-block-index">{index + 1}</span>
      <span className="galgame-wait-badge">
        {blockIcon(block.type)}
        <strong>等待</strong>
      </span>
      <label className="galgame-wait-duration">
        <input
          aria-label="等待时长"
          type="number"
          min="0"
          max="3600000"
          disabled={block.mode === "player"}
          value={block.durationMs ?? ""}
          onChange={(event) =>
            onBlock({
              ...block,
              mode: "duration",
              durationMs: Math.min(
                3600000,
                Math.max(0, Number(event.target.value)),
              ),
            })
          }
        />
        <span>ms</span>
      </label>
      <span className="galgame-wait-card-presets" aria-label="等待预设">
        {WAIT_DURATION_PRESETS.map((durationMs) => (
          <button
            key={durationMs}
            type="button"
            className={
              block.mode === "duration" && block.durationMs === durationMs
                ? "active"
                : ""
            }
            aria-pressed={
              block.mode === "duration" && block.durationMs === durationMs
            }
            onClick={() => onBlock({ ...block, mode: "duration", durationMs })}
          >
            {durationMs}
          </button>
        ))}
        <button
          type="button"
          className={block.mode === "player" ? "active" : ""}
          aria-pressed={block.mode === "player"}
          onClick={() =>
            onBlock({ ...block, mode: "player", durationMs: null })
          }
        >
          等待玩家继续
        </button>
      </span>
      <em className="galgame-wait-summary">
        {waitDurationLabel(block.durationMs)}
      </em>
    </article>
  );
}

export function OfficialCommandCard({
  block,
  index,
  selected,
  onSelect,
}: {
  block: Extract<
    GalgameStoryBlock,
    { type: "paragraphParams" | "systemMessage" }
  >;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const summary =
    block.type === "systemMessage"
      ? `${block.mode === "confirm" ? "确认" : "提示"} · ${block.text || "未填写消息"}`
      : [
          block.textSpeedCps != null ? `${block.textSpeedCps} 字/秒` : "",
          block.revealEffect ?? "",
          block.readBehavior ?? "",
        ]
          .filter(Boolean)
          .join(" · ") || "调整后续段落";
  return (
    <article
      className={`galgame-block-card galgame-official-command is-${block.type}${selected ? " selected" : ""}`}
      data-block-id={block.id}
      onFocusCapture={onSelect}
      tabIndex={0}
    >
      <span className="galgame-block-index">{index + 1}</span>
      <button type="button" className="galgame-block-select" onClick={onSelect}>
        <span className="galgame-block-kind">{blockIcon(block.type)}</span>
        <span className="galgame-block-copy">
          <strong>{BLOCK_LABELS[block.type]}</strong>
          <b>{summary}</b>
        </span>
      </button>
    </article>
  );
}

export function GenericBlockCard({
  block,
  index,
  selected,
  document,
  chapter,
  onSelect,
}: {
  block: GalgameStoryBlock;
  index: number;
  selected: boolean;
  document: GalgameStoryProject;
  chapter: GalgameStoryChapter;
  onSelect: () => void;
}) {
  return (
    <article
      className={`galgame-block-card is-${block.type}${selected ? " selected" : ""}`}
      data-block-id={block.id}
      onFocusCapture={onSelect}
      tabIndex={0}
    >
      <span className="galgame-block-index">{index + 1}</span>
      <button
        type="button"
        className="galgame-block-select"
        aria-pressed={selected}
        onClick={onSelect}
      >
        {block.type === "scene" || block.type === "showCg" ? (
          <span className="galgame-block-thumbnail">
            <StoryAssetImage
              fileId={blockPreviewFileId(block, document)}
              alt=""
              fallback={blockIcon(block.type)}
            />
          </span>
        ) : null}
        <span className="galgame-block-kind">{blockIcon(block.type)}</span>
        <span className="galgame-block-copy">
          <span>
            <strong>{BLOCK_LABELS[block.type]}</strong>
            {"atMs" in block && block.atMs != null ? (
              <em>独立 · {formatTimecode(block.atMs)}</em>
            ) : null}
          </span>
          <b>{blockSummary(block, document, chapter)}</b>
        </span>
        {block.type === "audio" ? (
          <Volume2 aria-hidden />
        ) : (
          blockIcon(block.type)
        )}
      </button>
    </article>
  );
}
