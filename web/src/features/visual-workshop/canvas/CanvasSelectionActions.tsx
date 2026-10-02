import { Copy, Grid2X2 } from "lucide-react";

export function CanvasSelectionActions({
  count,
  onCopy,
  onCompose,
}: {
  count: number;
  onCopy: () => void;
  onCompose?: () => void;
}) {
  if (count < 2) return null;
  return (
    <div
      className="canvas-selection-actions"
      role="toolbar"
      aria-label="已选节点操作"
    >
      <span>已选 {count} 个节点</span>
      <button type="button" onClick={onCopy} title="复制选中节点 (⌘/Ctrl+C)">
        <Copy aria-hidden /> 复制
      </button>
      {onCompose ? (
        <button type="button" onClick={onCompose}>
          <Grid2X2 aria-hidden /> 合成宫格
        </button>
      ) : null}
    </div>
  );
}
