import { Minus, Plus, Scan } from "lucide-react";

export function PresentationStatusbar({
  page,
  total,
  scale,
  zoom,
  onZoom,
}: {
  page: number;
  total: number;
  scale: number;
  zoom: number | null;
  onZoom: (zoom: number | null) => void;
}) {
  const change = (value: number) =>
    onZoom(Math.max(0.25, Math.min(2, Math.round(value * 20) / 20)));
  return (
    <footer className="presentation-statusbar">
      <span>
        第 {page} / {total} 页
      </span>
      <div
        className="presentation-zoom-controls"
        title="在画布上捏合触控板，或按住 Ctrl／⌘ 滚动缩放；双指滑动查看细节"
      >
        <output aria-label="实际缩放比例">{Math.round(scale * 100)}%</output>
        <button
          aria-label="缩小画布"
          disabled={scale <= 0.25}
          onClick={() => change(scale - 0.05)}
        >
          <Minus size={15} />
        </button>
        <input
          type="range"
          className="presentation-zoom-slider"
          aria-label="画布缩放"
          aria-valuetext={`${Math.round(scale * 100)}%`}
          min={25}
          max={200}
          step={5}
          value={Math.max(25, Math.min(200, Math.round(scale * 100)))}
          onChange={(event) => change(Number(event.target.value) / 100)}
        />
        <button
          aria-label="放大画布"
          disabled={scale >= 2}
          onClick={() => change(scale + 0.05)}
        >
          <Plus size={15} />
        </button>
        <button
          className="presentation-fit"
          aria-label="适应页面"
          title="适应页面"
          aria-pressed={zoom === null}
          onClick={() => onZoom(null)}
        >
          <Scan size={16} />
          <span>适应页面</span>
        </button>
      </div>
    </footer>
  );
}
