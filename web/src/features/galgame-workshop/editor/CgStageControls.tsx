import type { GalgameStoryCgOverlay } from "@features/galgame-workshop/api";
import {
  DEFAULT_CG_OVERLAY,
  cgOverlay,
} from "@features/galgame-workshop/editor/stage";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function CgOverlayTransformFields({
  overlay,
  onChange,
}: {
  overlay?: GalgameStoryCgOverlay;
  onChange: (overlay: GalgameStoryCgOverlay) => void;
}) {
  const value = cgOverlay(overlay);
  const fields = [
    ["x", "X 位置", 0, 100, 1, "%"],
    ["y", "Y 位置", 0, 100, 1, "%"],
    ["width", "画面宽度", 5, 200, 1, "%"],
    ["opacity", "透明度", 0, 1, 0.05, ""],
  ] as const;

  return (
    <div className="galgame-character-transform-fields galgame-cg-overlay-fields">
      <div className="galgame-position-presets" aria-label="CG 布局预设">
        <button
          type="button"
          onClick={() => onChange({ ...value, x: 50, y: 50, width: 60 })}
        >
          居中 60%
        </button>
        <button type="button" onClick={() => onChange(DEFAULT_CG_OVERLAY)}>
          重置布局
        </button>
      </div>
      {fields.map(([key, label, min, max, step, suffix]) => (
        <label key={key} className="galgame-stage-range">
          <span>
            {label} <em>{`${value[key]}${suffix}`}</em>
          </span>
          <span>
            <input
              aria-label={`CG ${label}`}
              type="range"
              min={min}
              max={max}
              step={step}
              value={value[key]}
              onChange={(event) =>
                onChange({ ...value, [key]: Number(event.target.value) })
              }
            />
            <input
              aria-label={`CG ${label}数值`}
              type="number"
              min={min}
              max={max}
              step={step}
              value={value[key]}
              onChange={(event) =>
                onChange({
                  ...value,
                  [key]: clamp(Number(event.target.value), min, max),
                })
              }
            />
          </span>
        </label>
      ))}
    </div>
  );
}
