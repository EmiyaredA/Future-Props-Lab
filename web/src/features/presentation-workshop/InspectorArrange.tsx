import type { LayoutCommand, LayoutControls } from "./layoutObjects";
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

const alignmentIcons = {
  left: AlignStartVertical,
  center: AlignCenterVertical,
  right: AlignEndVertical,
  top: AlignStartHorizontal,
  middle: AlignCenterHorizontal,
  bottom: AlignEndHorizontal,
  horizontal: AlignHorizontalDistributeCenter,
  vertical: AlignVerticalDistributeCenter,
};
const layers = [
  ["front", "置于顶层", BringToFront],
  ["forward", "上移一层", ArrowUpToLine],
  ["backward", "下移一层", ArrowDownToLine],
  ["back", "置于底层", SendToBack],
] as const;

export function InspectorArrange({
  disabled,
  layout,
  arrange,
  order,
}: {
  disabled: boolean;
  arrange: (mode: LayoutCommand) => void;
  layout: LayoutControls;
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
        {layout.commands
          .filter((c) => c.mode in alignmentIcons)
          .map((c) => {
            const Icon = alignmentIcons[c.mode as keyof typeof alignmentIcons];
            return (
              <button
                key={c.mode}
                title={c.reason ?? c.label}
                aria-label={c.label}
                disabled={!!c.reason}
                onClick={() => arrange(c.mode)}
              >
                <Icon size={17} aria-hidden="true" />
              </button>
            );
          })}
      </div>
      {layout.reference && (
        <p className="presentation-layout-reference">
          尺寸基准：{layout.reference}
        </p>
      )}
      <div
        className="presentation-layer-grid"
        role="group"
        aria-label="统一尺寸"
      >
        {layout.commands
          .filter((c) => ["width", "height", "size"].includes(c.mode))
          .map((c) => (
            <button
              key={c.mode}
              disabled={!!c.reason}
              title={c.reason ?? c.label}
              onClick={() => arrange(c.mode)}
            >
              {c.label}
            </button>
          ))}
      </div>
      {layout.commands.find((c) => c.mode === "size")?.reason && (
        <p className="muted presentation-layout-reason">
          {layout.commands.find((c) => c.mode === "size")?.reason}
        </p>
      )}
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
