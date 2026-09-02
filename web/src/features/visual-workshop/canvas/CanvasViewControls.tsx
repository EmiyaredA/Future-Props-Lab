import type { Dispatch, SetStateAction } from "react";
import { Focus, Hand, Minus, MousePointer2, Plus } from "lucide-react";
import type { Viewport } from "@features/visual-workshop/canvas/geometry";
import type { CanvasTool } from "@features/visual-workshop/canvas/useCanvasPointerInteractions";

type CanvasViewControlsProps = {
  assetsOpen: boolean;
  toolMode: CanvasTool;
  setToolMode: Dispatch<SetStateAction<CanvasTool>>;
  viewport: Viewport;
  setZoom: (zoom: number) => void;
  resetZoom: () => void;
  fitView: () => void;
};

export function CanvasViewControls({
  assetsOpen,
  toolMode,
  setToolMode,
  viewport,
  setZoom,
  resetZoom,
  fitView,
}: CanvasViewControlsProps) {
  return (
    <div
      className={`canvas-controls${assetsOpen ? " with-assets" : ""}`}
      aria-label="画布视图控制"
    >
      <div
        className="canvas-control-mode"
        role="group"
        aria-label="画布工具模式"
      >
        <button
          className={toolMode === "select" ? "active" : ""}
          aria-label="选择和框选"
          aria-pressed={toolMode === "select"}
          title="选择和框选 (V)"
          onClick={() => setToolMode("select")}
        >
          <MousePointer2 aria-hidden />
        </button>
        <button
          className={toolMode === "pan" ? "active" : ""}
          aria-label="移动画布"
          aria-pressed={toolMode === "pan"}
          title="移动画布 (H / 按住空格)"
          onClick={() => setToolMode("pan")}
        >
          <Hand aria-hidden />
        </button>
      </div>
      <i aria-hidden />
      <button aria-label="缩小" onClick={() => setZoom(viewport.zoom - 0.1)}>
        <Minus aria-hidden />
      </button>
      <button className="canvas-zoom-value" onClick={resetZoom}>
        {Math.round(viewport.zoom * 100)}%
      </button>
      <button aria-label="放大" onClick={() => setZoom(viewport.zoom + 0.1)}>
        <Plus aria-hidden />
      </button>
      <i aria-hidden />
      <button aria-label="适配视图" title="适配视图" onClick={() => fitView()}>
        <Focus aria-hidden />
      </button>
    </div>
  );
}
