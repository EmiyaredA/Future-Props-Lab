import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Frame, Maximize2 } from "lucide-react";
import type {
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { StoryPlayer } from "@features/galgame-workshop/editor/StoryPlayer";
import { DEFAULT_STAGE_VIEWPORT_PREFERENCES } from "@features/galgame-workshop/editor/stageViewportPreferences";
import {
  FULL_CAPTURE_FRAME,
  normalizeCaptureFrame,
  type CaptureFrame,
} from "@features/galgame-workshop/editor/videoCaptureFrame";
import "@features/galgame-workshop/editor/video-capture-frame.css";
const validWidth = (value: number) =>
  Math.min(1920, Math.max(320, Math.round(value / 16) * 16));

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

export function VideoCaptureFrameEditor({
  document,
  fragment,
  timelinePositionMs,
  value,
  onChange,
}: {
  document: GalgameStoryProject;
  fragment?: GalgameStoryFragment;
  timelinePositionMs: number;
  value: CaptureFrame;
  onChange: (value: CaptureFrame) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [previewMode, setPreviewMode] = useState<"edit" | "export">("edit");
  const custom =
    value.width !== 1920 ||
    value.height !== 1080 ||
    value.x !== 0 ||
    value.y !== 0;
  const updateNumber = (key: "x" | "y" | "width", next: number) =>
    onChange(normalizeCaptureFrame({ ...value, [key]: next }));
  const startDrag = (
    event: ReactPointerEvent,
    handle: (typeof HANDLES)[number] | "move",
  ) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = { x: event.clientX, y: event.clientY, frame: value };
    const move = (nextEvent: PointerEvent) => {
      const dx = ((nextEvent.clientX - origin.x) / bounds.width) * 1920;
      const dy = ((nextEvent.clientY - origin.y) / bounds.height) * 1080;
      if (handle === "move") {
        onChange(
          normalizeCaptureFrame({
            ...origin.frame,
            x: origin.frame.x + dx,
            y: origin.frame.y + dy,
          }),
        );
        return;
      }
      const horizontal = handle.includes("w")
        ? -dx
        : handle.includes("e")
          ? dx
          : dy * (16 / 9);
      const width = validWidth(origin.frame.width + horizontal);
      onChange(
        normalizeCaptureFrame({
          width,
          x: handle.includes("w")
            ? origin.frame.x + origin.frame.width - width
            : origin.frame.x,
          y: handle.includes("n")
            ? origin.frame.y + origin.frame.height - (width * 9) / 16
            : origin.frame.y,
        }),
      );
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const frameStyle = {
    left: `${(value.x / 1920) * 100}%`,
    top: `${(value.y / 1080) * 100}%`,
    width: `${(value.width / 1920) * 100}%`,
    height: `${(value.height / 1080) * 100}%`,
  };
  const currentUiOutside =
    value.y + value.height < 1060 ||
    value.x > 96 ||
    value.x + value.width < 1824;
  return (
    <section className="galgame-capture-editor">
      <div className="galgame-capture-heading">
        <span>
          <h3>视频取景</h3>
          <small>拖动取景框；导出时会裁切并缩放回所选画质</small>
        </span>
        <div role="group" aria-label="预览画面">
          <button
            type="button"
            className={previewMode === "edit" ? "active" : ""}
            onClick={() => setPreviewMode("edit")}
          >
            编辑画面
          </button>
          <button
            type="button"
            className={previewMode === "export" ? "active" : ""}
            onClick={() => setPreviewMode("export")}
          >
            导出画面
          </button>
        </div>
      </div>
      <div
        className={`galgame-capture-surface is-${previewMode}`}
        ref={surfaceRef}
      >
        <div
          className="galgame-capture-source"
          style={
            previewMode === "export"
              ? {
                  width: `${(1920 / value.width) * 100}%`,
                  height: `${(1080 / value.height) * 100}%`,
                  left: `${(-value.x / value.width) * 100}%`,
                  top: `${(-value.y / value.height) * 100}%`,
                }
              : undefined
          }
        >
          <StoryPlayer
            document={document}
            mode="edit"
            editFragment={fragment}
            editTimelinePositionMs={timelinePositionMs}
            chrome="stage-only"
            viewportPreferences={DEFAULT_STAGE_VIEWPORT_PREFERENCES}
          />
        </div>
        {previewMode === "edit" ? (
          <>
            <div className="galgame-capture-grid" aria-hidden />
            <div className="galgame-capture-safe-title" aria-hidden>
              标题安全区
            </div>
            <div className="galgame-capture-safe-dialogue" aria-hidden>
              对白安全区
            </div>
            <div
              className="galgame-capture-frame"
              style={frameStyle}
              onPointerDown={(event) => startDrag(event, "move")}
            >
              {HANDLES.map((handle) => (
                <button
                  key={handle}
                  type="button"
                  aria-label={`${handle} 方向调整取景框`}
                  className={`is-${handle}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    startDrag(event, handle);
                  }}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div className="galgame-capture-controls">
        <div role="group" aria-label="取景模式">
          <button
            type="button"
            className={!custom ? "active" : ""}
            onClick={() => onChange(FULL_CAPTURE_FRAME)}
          >
            <Maximize2 aria-hidden />
            完整舞台
          </button>
          <button
            type="button"
            className={custom ? "active" : ""}
            onClick={() =>
              onChange(normalizeCaptureFrame({ x: 160, y: 90, width: 1600 }))
            }
          >
            <Frame aria-hidden />
            自定义取景
          </button>
        </div>
        {(["x", "y", "width"] as const).map((key) => (
          <label key={key}>
            <span>{key === "width" ? "宽度" : key.toUpperCase()}</span>
            <input
              type="number"
              step={key === "width" ? 16 : 2}
              value={value[key]}
              onChange={(event) =>
                updateNumber(key, Number(event.target.value))
              }
            />
          </label>
        ))}
        <label>
          <span>高度</span>
          <input type="number" value={value.height} readOnly />
        </label>
      </div>
      <p className={currentUiOutside ? "is-warning" : ""}>
        {currentUiOutside
          ? "当前帧 UI 有部分位于取景框外"
          : "当前帧 UI 位于取景框内"}{" "}
        · 仅检查此刻画面
      </p>
    </section>
  );
}
