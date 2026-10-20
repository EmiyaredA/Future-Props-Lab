import { CustomSelect } from "@shared/ui/CustomSelect";
import { NumberField } from "../PresentationNumberField";
import type { PageSize } from "../types";

export function PageDesignControls({
  size,
  change,
  readOnly,
  grid,
  rulers,
  onGrid,
  onRulers,
}: {
  size: PageSize;
  change: (size: PageSize) => void;
  readOnly: boolean;
  grid: boolean;
  rulers: boolean;
  onGrid: () => void;
  onRulers: () => void;
}) {
  return (
    <>
      <fieldset disabled={readOnly} className="presentation-page-size">
        <legend>页面尺寸</legend>
        <CustomSelect
          ariaLabel="页面尺寸预设"
          value={`${size.width}x${size.height}`}
          options={[
            { value: "1280x720", label: "16:9 宽屏" },
            { value: "960x720", label: "4:3 标准" },
            { value: "1280x800", label: "16:10" },
            { value: "720x1280", label: "9:16 竖屏" },
            {
              value: `${size.width}x${size.height}`,
              label: `自定义 ${size.width} × ${size.height}`,
            },
          ].filter(
            (item, index, array) =>
              array.findIndex((other) => other.value === item.value) === index,
          )}
          disabled={readOnly}
          onChange={(value) => {
            const [width, height] = value.split("x").map(Number);
            change({ width, height });
          }}
        />
        <div className="presentation-geometry">
          <NumberField
            label="页面宽度"
            value={size.width}
            min={320}
            max={4096}
            onChange={(width) => change({ ...size, width: Math.round(width) })}
          />
          <NumberField
            label="页面高度"
            value={size.height}
            min={240}
            max={4096}
            onChange={(height) =>
              change({ ...size, height: Math.round(height) })
            }
          />
        </div>
        <p className="muted">调整页面边界，元素的位置与尺寸保持原值。</p>
      </fieldset>
      <div
        className="presentation-view-tools"
        role="group"
        aria-label="画布辅助工具"
      >
        <button className="btn" aria-pressed={grid} onClick={onGrid}>
          网格线
        </button>
        <button className="btn" aria-pressed={rulers} onClick={onRulers}>
          标尺
        </button>
      </div>
    </>
  );
}
