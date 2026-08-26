import type { CSSProperties } from "react";
import type { GalgameStoryDialogueBoxStyle } from "@features/galgame-workshop/api";

function rangeProgress(value: number, min: number, max: number) {
  const progress = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return { "--range-progress": `${progress * 100}%` } as CSSProperties;
}

export function DialogueFontScaleField({
  style,
  onScaleChange,
  onBodyFontSizeChange,
  onNameFontSizeChange,
}: {
  style: GalgameStoryDialogueBoxStyle;
  onScaleChange: (fontScale: number) => void;
  onBodyFontSizeChange: (fontSizePx: number) => void;
  onNameFontSizeChange: (fontSizePx: number) => void;
}) {
  const bodyFontSizePx = style.body?.fontSizePx;
  const nameFontSizePx = style.speakerName?.fontSizePx;
  return (
    <>
      <label className="galgame-dialogue-range">
        <span>
          整体字体大小 <strong>{Math.round(style.fontScale * 100)}%</strong>
        </span>
        <input
          type="range"
          aria-label="对话框整体字体大小"
          min="0.8"
          max="1.4"
          step="0.05"
          value={style.fontScale}
          style={rangeProgress(style.fontScale, 0.8, 1.4)}
          onChange={(event) => onScaleChange(Number(event.target.value))}
        />
        <small>同时缩放对白正文和人物名，快速预览与视频导出共用。</small>
      </label>
      <label className="galgame-dialogue-range">
        <span>
          正文字号{" "}
          <strong>
            {bodyFontSizePx ?? Math.round(24 * style.fontScale)}px
          </strong>
        </span>
        <input
          type="range"
          aria-label="对话框正文字号"
          min="14"
          max="60"
          value={bodyFontSizePx ?? Math.round(24 * style.fontScale)}
          style={rangeProgress(
            bodyFontSizePx ?? Math.round(24 * style.fontScale),
            14,
            60,
          )}
          onChange={(event) => onBodyFontSizeChange(Number(event.target.value))}
        />
      </label>
      <label className="galgame-dialogue-range">
        <span>
          人物名字号{" "}
          <strong>
            {nameFontSizePx ??
              bodyFontSizePx ??
              Math.round(24 * style.fontScale)}
            px
          </strong>
        </span>
        <input
          type="range"
          aria-label="对话框人物名字号"
          min="12"
          max="48"
          value={
            nameFontSizePx ?? bodyFontSizePx ?? Math.round(24 * style.fontScale)
          }
          style={rangeProgress(
            nameFontSizePx ??
              bodyFontSizePx ??
              Math.round(24 * style.fontScale),
            12,
            48,
          )}
          onChange={(event) => onNameFontSizeChange(Number(event.target.value))}
        />
      </label>
    </>
  );
}
