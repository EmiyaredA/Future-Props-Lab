import type {
  GalgameStoryCharacterTransform,
  GalgameStoryCharacterTransition,
} from "@features/galgame-workshop/api";
import {
  characterTransform,
  characterTransition,
} from "@features/galgame-workshop/editor/stage";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function CharacterTransitionFields({
  transition,
  onChange,
}: {
  transition?: GalgameStoryCharacterTransition;
  onChange: (transition: GalgameStoryCharacterTransition) => void;
}) {
  const value = characterTransition(transition);
  return (
    <div className="galgame-character-transition-fields">
      <label>
        <input
          type="checkbox"
          checked={value.fade}
          onChange={(event) =>
            onChange({ ...value, fade: event.target.checked })
          }
        />
        <span>登退场淡入淡出</span>
      </label>
      <label className="galgame-stage-range">
        <span>
          过渡时长 <em>{value.durationMs}ms</em>
        </span>
        <input
          aria-label="角色过渡时长"
          type="range"
          min="0"
          max="5000"
          step="50"
          value={value.durationMs}
          onChange={(event) =>
            onChange({ ...value, durationMs: Number(event.target.value) })
          }
        />
      </label>
    </div>
  );
}

export function CharacterTransformFields({
  transform,
  transition,
  onTransform,
  onTransition,
}: {
  transform?: GalgameStoryCharacterTransform | null;
  transition?: GalgameStoryCharacterTransition;
  onTransform: (transform: GalgameStoryCharacterTransform) => void;
  onTransition: (transition: GalgameStoryCharacterTransition) => void;
}) {
  const value = characterTransform(transform);
  const fields = [
    ["brightness", "亮度", 0, 2, 0.05, "×"],
    ["opacity", "透明度", 0, 1, 0.05, ""],
    ["layer", "层级", 0, 20, 1, ""],
  ] as const;

  return (
    <div className="galgame-character-transform-fields">
      <p className="galgame-field-hint">
        角色距离与位置在对白卡片中选择；坐标、锚点和基准尺寸遵循角色资产的“位置与尺寸”配置。
      </p>
      {fields.map(([key, label, min, max, step, suffix]) => (
        <label key={key} className="galgame-stage-range">
          <span>
            {label} <em>{`${value[key]}${suffix}`}</em>
          </span>
          <span>
            <input
              aria-label={`角色${label}`}
              type="range"
              min={min}
              max={max}
              step={step}
              value={value[key]}
              onChange={(event) =>
                onTransform({ ...value, [key]: Number(event.target.value) })
              }
            />
            <input
              aria-label={`角色${label}数值`}
              type="number"
              min={min}
              max={max}
              step={step}
              value={value[key]}
              onChange={(event) =>
                onTransform({
                  ...value,
                  [key]: clamp(Number(event.target.value), min, max),
                })
              }
            />
          </span>
        </label>
      ))}
      <label className="galgame-stage-checkbox">
        <input
          type="checkbox"
          checked={value.flipX}
          onChange={(event) =>
            onTransform({ ...value, flipX: event.target.checked })
          }
        />
        <span>水平翻转立绘</span>
      </label>
      <CharacterTransitionFields
        transition={transition}
        onChange={onTransition}
      />
    </div>
  );
}
