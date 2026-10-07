import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Network } from "lucide-react";
import type { CanvasLayoutMode } from "./canvasLayout";
import "../styles/canvas-arrangement.css";

export function CanvasArrangeControls({
  disabled,
  selected = false,
  onArrange,
}: {
  disabled: boolean;
  selected?: boolean;
  onArrange: (mode: CanvasLayoutMode) => void;
}) {
  const label = selected ? "整理选中节点" : "一键整理";
  return (
    <div className="canvas-arrange-controls" role="group" aria-label={label}>
      <button
        type="button"
        disabled={disabled}
        className="canvas-arrange-default"
        onClick={() => onArrange("flow")}
        aria-label={label}
        title={label}
      >
        <Network aria-hidden />
        <span>{label}</span>
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={selected ? "选中节点整理方式" : "画布整理方式"}
            className="canvas-arrange-trigger"
          >
            <ChevronDown aria-hidden />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="canvas-arrange-menu"
            side="top"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            aria-label="选择整理方式"
          >
            <DropdownMenu.Item onSelect={() => onArrange("flow")}>
              {selected ? "按连线整理选中" : "按连线整理全部"}
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => onArrange("grid")}>
              {selected ? "网格整理选中" : "网格整理全部"}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
