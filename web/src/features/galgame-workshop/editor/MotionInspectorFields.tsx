import { CustomSelect } from "@shared/ui/CustomSelect";
import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { Field } from "@features/galgame-workshop/editor/InspectorFieldControls";

type CameraBlock = Extract<GalgameStoryBlock, { type: "camera" }>;
type AnimateSpriteBlock = Extract<GalgameStoryBlock, { type: "animateSprite" }>;

const EASING_OPTIONS = [
  { value: "linear", label: "匀速" },
  { value: "ease", label: "柔和" },
  { value: "easeIn", label: "渐快" },
  { value: "easeOut", label: "渐慢" },
  { value: "easeInOut", label: "渐快渐慢" },
];

function RangeField({
  label,
  ariaLabel,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="galgame-stage-range">
      <span>
        {label} <em>{value}</em>
      </span>
      <span>
        <input
          aria-label={ariaLabel}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          aria-label={`${ariaLabel}数值`}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) =>
            onChange(
              Math.min(max, Math.max(min, Number(event.target.value) || 0)),
            )
          }
        />
      </span>
    </label>
  );
}

export function CameraInspectorFields({
  block,
  onChange,
}: {
  block: CameraBlock;
  onChange: (block: CameraBlock) => void;
}) {
  return (
    <>
      <Field label="镜头目标">
        <CustomSelect
          ariaLabel="镜头目标"
          value={block.target}
          options={[
            { value: "stage", label: "全部视觉层" },
            { value: "background", label: "仅背景" },
            { value: "characters", label: "仅角色" },
            { value: "cg", label: "仅 CG" },
          ]}
          onChange={(target) =>
            onChange({
              ...block,
              target: target as CameraBlock["target"],
            })
          }
        />
      </Field>
      <Field label="镜头效果">
        <CustomSelect
          ariaLabel="镜头效果"
          value={block.effect}
          options={[
            { value: "move", label: "平移 / 缩放" },
            { value: "zoomIn", label: "推近" },
            { value: "zoomOut", label: "拉远" },
            { value: "panLeft", label: "向左平移" },
            { value: "panRight", label: "向右平移" },
            { value: "panUp", label: "向上平移" },
            { value: "panDown", label: "向下平移" },
            { value: "shake", label: "震动" },
            { value: "pulse", label: "脉冲" },
            { value: "focus", label: "聚焦" },
            { value: "custom", label: "自定义" },
          ]}
          onChange={(effect) =>
            onChange({ ...block, effect: effect as CameraBlock["effect"] })
          }
        />
      </Field>
      <RangeField
        label="水平位移（%）"
        ariaLabel="镜头水平位移"
        value={block.x}
        min={-200}
        max={200}
        step={1}
        onChange={(x) => onChange({ ...block, x })}
      />
      <RangeField
        label="垂直位移（%）"
        ariaLabel="镜头垂直位移"
        value={block.y}
        min={-200}
        max={200}
        step={1}
        onChange={(y) => onChange({ ...block, y })}
      />
      <RangeField
        label="缩放"
        ariaLabel="镜头缩放"
        value={block.scale}
        min={0.1}
        max={3}
        step={0.01}
        onChange={(scale) => onChange({ ...block, scale })}
      />
      <RangeField
        label="旋转（°）"
        ariaLabel="镜头旋转"
        value={block.rotation}
        min={-180}
        max={180}
        step={1}
        onChange={(rotation) => onChange({ ...block, rotation })}
      />
      <RangeField
        label="效果强度"
        ariaLabel="镜头效果强度"
        value={block.intensity}
        min={0}
        max={10}
        step={0.1}
        onChange={(intensity) => onChange({ ...block, intensity })}
      />
      <RangeField
        label="持续时间（ms）"
        ariaLabel="镜头持续时间"
        value={block.durationMs}
        min={0}
        max={600000}
        step={50}
        onChange={(durationMs) => onChange({ ...block, durationMs })}
      />
      <Field label="缓动">
        <CustomSelect
          ariaLabel="镜头缓动"
          value={block.easing}
          options={EASING_OPTIONS}
          onChange={(easing) =>
            onChange({ ...block, easing: easing as CameraBlock["easing"] })
          }
        />
      </Field>
      <label className="galgame-stage-checkbox">
        <input
          type="checkbox"
          checked={block.waitForCompletion}
          onChange={(event) =>
            onChange({ ...block, waitForCompletion: event.target.checked })
          }
        />
        <span>等待镜头运动完成后继续</span>
      </label>
    </>
  );
}

export function AnimateSpriteInspectorFields({
  block,
  document,
  onChange,
}: {
  block: AnimateSpriteBlock;
  document: GalgameStoryProject;
  onChange: (block: AnimateSpriteBlock) => void;
}) {
  return (
    <>
      <Field label="动画角色">
        <CustomSelect
          ariaLabel="精灵动画角色"
          value={block.characterId}
          options={(document.characters ?? []).map((character) => ({
            value: character.id,
            label: character.name,
          }))}
          onChange={(characterId) => onChange({ ...block, characterId })}
        />
      </Field>
      <Field label="动作预设">
        <CustomSelect
          ariaLabel="精灵动画预设"
          value={block.animation}
          options={[
            { value: "breathe", label: "呼吸" },
            { value: "idle", label: "轻微待机（兼容）" },
            { value: "nod", label: "点头" },
            { value: "shake", label: "摇头" },
            { value: "startle", label: "惊吓" },
            { value: "lean", label: "前倾" },
            { value: "recoil", label: "后退" },
            { value: "step", label: "迈步" },
            { value: "tug", label: "拉扯" },
            { value: "bounce", label: "弹跳" },
          ]}
          onChange={(animation) => onChange({ ...block, animation })}
        />
      </Field>
      <Field label="动作方向">
        <CustomSelect
          ariaLabel="精灵动画方向"
          value={block.direction}
          options={[
            { value: "none", label: "自动 / 无方向" },
            { value: "left", label: "向左" },
            { value: "right", label: "向右" },
            { value: "towardCenter", label: "朝向画面中心" },
            { value: "awayFromCenter", label: "远离画面中心" },
          ]}
          onChange={(direction) =>
            onChange({
              ...block,
              direction: direction as AnimateSpriteBlock["direction"],
            })
          }
        />
      </Field>
      <RangeField
        label="动作强度"
        ariaLabel="精灵动画强度"
        value={block.intensity}
        min={0.1}
        max={3}
        step={0.1}
        onChange={(intensity) => onChange({ ...block, intensity })}
      />
      <RangeField
        label="持续时间（ms）"
        ariaLabel="精灵动画持续时间"
        value={block.durationMs}
        min={0}
        max={600000}
        step={50}
        onChange={(durationMs) => onChange({ ...block, durationMs })}
      />
      <Field label="缓动">
        <CustomSelect
          ariaLabel="精灵动画缓动"
          value={block.easing}
          options={EASING_OPTIONS}
          onChange={(easing) =>
            onChange({
              ...block,
              easing: easing as AnimateSpriteBlock["easing"],
            })
          }
        />
      </Field>
      <label className="galgame-stage-checkbox">
        <input
          type="checkbox"
          checked={block.loop}
          onChange={(event) =>
            onChange({ ...block, loop: event.target.checked })
          }
        />
        <span>循环播放</span>
      </label>
      <label className="galgame-stage-checkbox">
        <input
          type="checkbox"
          checked={block.waitForCompletion}
          onChange={(event) =>
            onChange({ ...block, waitForCompletion: event.target.checked })
          }
        />
        <span>等待动作完成后继续</span>
      </label>
    </>
  );
}
