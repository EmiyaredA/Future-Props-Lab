import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  BringToFront,
  ArrowUpToLine,
  ArrowDownToLine,
  SendToBack,
} from "lucide-react";

const alignment = [
  ["left", "左对齐", AlignStartVertical],
  ["center", "水平居中", AlignCenterVertical],
  ["right", "右对齐", AlignEndVertical],
  ["top", "顶部对齐", AlignStartHorizontal],
  ["middle", "垂直居中", AlignCenterHorizontal],
  ["bottom", "底部对齐", AlignEndHorizontal],
  ["horizontal", "水平分布", AlignHorizontalDistributeCenter],
  ["vertical", "垂直分布", AlignVerticalDistributeCenter],
] as const;
const layers = [
  ["front", "置于顶层", BringToFront],
  ["forward", "上移一层", ArrowUpToLine],
  ["backward", "下移一层", ArrowDownToLine],
  ["back", "置于底层", SendToBack],
] as const;

export function InspectorArrange({
  disabled,
  arrange,
  order,
}: {
  disabled: boolean;
  arrange: (mode: string) => void;
  order: (mode: string) => void;
}) {
  return (
    <fieldset className="presentation-desktop-control" disabled={disabled}>
      <legend>排列与层级</legend>
      <div
        className="presentation-align-icons"
        role="group"
        aria-label="对齐与分布"
      >
        {alignment.map(([mode, label, Icon]) => (
          <button
            key={mode}
            title={label}
            aria-label={label}
            onClick={() => arrange(mode)}
          >
            <Icon size={17} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div
        className="presentation-layer-grid"
        role="group"
        aria-label="图层顺序"
      >
        {layers.map(([mode, label, Icon]) => (
          <button key={mode} onClick={() => order(mode)}>
            <Icon size={14} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
