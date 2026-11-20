import { Copy, Grid2X2, Group, Ungroup } from "lucide-react";
import { CanvasArrangeControls } from "./CanvasArrangeControls";
import type { CanvasLayoutMode } from "./canvasLayout";

export function CanvasSelectionActions({
  count,
  onCopy,
  groupSelected,
  onGroup,
  onUngroup,
  onCompose,
  canArrange,
  onArrange,
}: {
  count: number;
  groupSelected?: boolean;
  onGroup?: () => void;
  onUngroup?: () => void;
  onCopy: () => void;
  onCompose?: () => void;
  canArrange: boolean;
  onArrange: (mode: CanvasLayoutMode) => void;
}) {
  if (count < 2) return null;
  return (
    <div
      className="canvas-selection-actions"
      role="toolbar"
      aria-label="已选节点操作"
    >
      <span>{groupSelected ? "已选 1 个组" : `已选 ${count} 个节点`}</span>
      {onGroup && (
        <button type="button" onClick={onGroup}>
          <Group aria-hidden /> 打组
        </button>
      )}
      {onUngroup && (
        <button type="button" onClick={onUngroup}>
          <Ungroup aria-hidden /> 解组
        </button>
      )}
      <button type="button" onClick={onCopy} title="复制选中节点 (⌘/Ctrl+C)">
        <Copy aria-hidden /> 复制
      </button>
      {onCompose ? (
        <button type="button" onClick={onCompose}>
          <Grid2X2 aria-hidden /> 合成宫格
        </button>
      ) : null}
      <CanvasArrangeControls
        selected
        disabled={!canArrange}
        onArrange={onArrange}
      />
    </div>
  );
}
