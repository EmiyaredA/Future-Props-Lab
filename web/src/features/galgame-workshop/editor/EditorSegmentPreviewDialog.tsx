import { useEffect, useId, useMemo, useRef } from "react";
import { Film, Play, X } from "lucide-react";
import type { GalgameStoryFragment } from "@features/galgame-workshop/api";
import { VideoClipRangeEditor } from "@features/galgame-workshop/editor/VideoClipRangeEditor";
import {
  selectedBlockClipRange,
  type VideoClipRange,
  videoClipRangeError,
} from "@features/galgame-workshop/editor/videoExportRange";
import "@features/galgame-workshop/editor/segment-preview-dialog.css";

export type SegmentPreviewSelection = VideoClipRange & {
  fragmentId: string;
};

export function EditorSegmentPreviewDialog({
  open,
  fragment,
  selectedBlockIndex,
  selection,
  renderDisabledReason,
  onChange,
  onClose,
  onPreview,
  onRender,
}: {
  open: boolean;
  fragment?: GalgameStoryFragment;
  selectedBlockIndex?: number | null;
  selection?: SegmentPreviewSelection;
  renderDisabledReason?: string;
  onChange: (selection: SegmentPreviewSelection) => void;
  onClose: () => void;
  onPreview: () => void;
  onRender: () => void;
}) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", closeOnEscape);
    requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);
  const durationMs = fragment?.timeline?.durationMs;
  const error = useMemo(
    () =>
      selection
        ? videoClipRangeError(selection, durationMs)
        : "当前 Fragment 没有时间轴，无法预演区间",
    [durationMs, selection],
  );
  const blockRange = fragment
    ? selectedBlockClipRange(fragment, selectedBlockIndex)
    : undefined;
  if (!open) return null;
  return (
    <div
      className="galgame-video-export-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="galgame-video-export-dialog galgame-segment-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <span>
            <Play aria-hidden />
            <span>
              <strong id={titleId}>预演时间区间</strong>
              <small>圈选故事中段，反复检查当前编辑效果</small>
            </span>
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="关闭区间预演设置"
          >
            <X aria-hidden />
          </button>
        </header>
        {fragment && durationMs != null && selection ? (
          <VideoClipRangeEditor
            title="预演区间"
            fragmentTitle={fragment.title}
            durationMs={durationMs}
            range={selection}
            error={error}
            onChange={(range) =>
              onChange({ fragmentId: fragment.id, ...range })
            }
            onReset={() =>
              blockRange && onChange({ fragmentId: fragment.id, ...blockRange })
            }
            resetLabel="使用当前 Block"
            resetDisabled={!blockRange}
            validNote="预演会恢复开始点的完整舞台与音频状态。"
            extraAction={
              !blockRange ? <small>当前 Block 没有可播放时段</small> : undefined
            }
          />
        ) : (
          <p className="galgame-segment-preview-unavailable">
            当前 Fragment 没有时间轴，无法使用区间预演。
          </p>
        )}
        <footer>
          {renderDisabledReason ? (
            <small role="status">{renderDisabledReason}</small>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={Boolean(error || renderDisabledReason)}
            onClick={onRender}
          >
            <Film aria-hidden /> 渲染此区间
          </button>
          <button
            type="button"
            className="galgame-video-export-start"
            disabled={Boolean(error)}
            onClick={onPreview}
          >
            <Play aria-hidden /> 开始区间预演
          </button>
        </footer>
      </section>
    </div>
  );
}
