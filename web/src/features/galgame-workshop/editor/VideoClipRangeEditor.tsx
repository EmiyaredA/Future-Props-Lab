import type { ReactNode } from "react";
import { formatTimecode } from "@features/galgame-workshop/editor/timeline";
import { VideoClipTimecodeInput } from "@features/galgame-workshop/editor/VideoClipTimecodeInput";
import type { VideoClipRange } from "@features/galgame-workshop/editor/videoExportRange";
import "@features/galgame-workshop/editor/video-export.css";

export function VideoClipRangeEditor({
  title = "快速试片区间",
  fragmentTitle,
  durationMs,
  range,
  error,
  onChange,
  onReset,
  resetLabel = "重新使用当前播放头",
  resetDisabled = false,
  extraAction,
  validNote = "将从区间前最多预热 500ms；预热内容不会进入成片。",
}: {
  title?: string;
  fragmentTitle?: string;
  durationMs: number;
  range: VideoClipRange;
  error: string;
  onChange: (range: VideoClipRange) => void;
  onReset: () => void;
  resetLabel?: string;
  resetDisabled?: boolean;
  extraAction?: ReactNode;
  validNote?: ReactNode;
}) {
  const safeDuration = Math.max(1, durationMs);
  const safeStart = Math.max(0, Math.min(durationMs, range.startMs));
  const safeEnd = Math.max(0, Math.min(durationMs, range.endMs));
  return (
    <section className="galgame-video-clip-editor">
      <div className="galgame-video-clip-heading">
        <span>
          <h3>{title}</h3>
          <small>
            {fragmentTitle} · 总时长 {formatTimecode(durationMs)}
          </small>
        </span>
        <span className="galgame-video-clip-heading-actions">
          {extraAction}
          <button type="button" disabled={resetDisabled} onClick={onReset}>
            {resetLabel}
          </button>
        </span>
      </div>
      <div className="galgame-video-clip-sliders">
        <div className="galgame-video-clip-track" aria-hidden />
        <div
          className="galgame-video-clip-selection"
          aria-hidden
          style={{
            left: `${(safeStart / safeDuration) * 100}%`,
            width: `${(Math.max(0, safeEnd - safeStart) / safeDuration) * 100}%`,
          }}
        />
        <input
          type="range"
          min="0"
          max={durationMs}
          step="100"
          value={safeStart}
          aria-label="快速试片开始位置"
          onChange={(event) =>
            onChange({
              ...range,
              startMs: Math.min(Number(event.target.value), range.endMs - 100),
            })
          }
        />
        <input
          type="range"
          min="0"
          max={durationMs}
          step="100"
          value={safeEnd}
          aria-label="快速试片结束位置"
          onChange={(event) =>
            onChange({
              ...range,
              endMs: Math.max(Number(event.target.value), range.startMs + 100),
            })
          }
        />
      </div>
      <div className="galgame-video-clip-timecodes">
        <VideoClipTimecodeInput
          label="开始时间"
          value={range.startMs}
          onCommit={(startMs) => onChange({ ...range, startMs })}
        />
        <span aria-hidden>—</span>
        <VideoClipTimecodeInput
          label="结束时间"
          value={range.endMs}
          onCommit={(endMs) => onChange({ ...range, endMs })}
        />
      </div>
      <div className="galgame-video-clip-shortcuts">
        <span>从开始点向后：</span>
        {[5_000, 10_000, 30_000].map((lengthMs) => (
          <button
            key={lengthMs}
            type="button"
            onClick={() =>
              onChange({
                startMs: range.startMs,
                endMs: Math.min(durationMs, range.startMs + lengthMs),
              })
            }
          >
            {lengthMs / 1000} 秒
          </button>
        ))}
        <strong>
          成片 {formatTimecode(Math.max(0, range.endMs - range.startMs))}
        </strong>
      </div>
      {error ? (
        <p className="galgame-video-clip-error">{error}</p>
      ) : (
        <p className="galgame-video-clip-note">{validNote}</p>
      )}
    </section>
  );
}
