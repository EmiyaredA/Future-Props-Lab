import { useRef, useState } from "react";
import { Eye, EyeOff, LockKeyhole, UnlockKeyhole } from "lucide-react";
import { valueAt } from "./model";
import type { MotionLayer, ResolvedDocument } from "./types";

type DragState = {
  id: string;
  mode: "move" | "start" | "end";
  x: number;
  start: number;
  end: number;
};

export function MotionTimeline({
  document,
  frame,
  selectedId,
  onFrame,
  onSelect,
  onChangeLayer,
  onBeginEdit,
}: {
  document: ResolvedDocument;
  frame: number;
  selectedId: string | null;
  onFrame: (frame: number) => void;
  onSelect: (id: string) => void;
  onChangeLayer: (
    id: string,
    patch: Partial<MotionLayer>,
    record?: boolean,
  ) => void;
  onBeginEdit: () => void;
}) {
  const ruler = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [width, setWidth] = useState(900);
  const duration = document.settings.durationFrames;
  const pxPerFrame = Math.max(2, width / duration);
  const time = (value: number) =>
    `${(value / document.settings.fps).toFixed(1)}s`;
  const pointerFrame = (clientX: number) => {
    const rect = ruler.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(
      0,
      Math.min(duration - 1, Math.round((clientX - rect.left) / pxPerFrame)),
    );
  };
  const startDrag = (
    event: React.PointerEvent,
    layer: MotionLayer,
    mode: DragState["mode"],
  ) => {
    if (layer.locked) return;
    event.stopPropagation();
    onBeginEdit();
    onSelect(layer.id);
    drag.current = {
      id: layer.id,
      mode,
      x: event.clientX,
      start: layer.startFrame,
      end: layer.endFrame,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent) => {
    if (!drag.current) return;
    const item = drag.current;
    const delta = Math.round((event.clientX - item.x) / pxPerFrame);
    if (item.mode === "move") {
      const length = item.end - item.start;
      const start = Math.max(
        0,
        Math.min(duration - length, item.start + delta),
      );
      onChangeLayer(
        item.id,
        { startFrame: start, endFrame: start + length },
        false,
      );
    } else if (item.mode === "start") {
      onChangeLayer(
        item.id,
        { startFrame: Math.max(0, Math.min(item.end - 1, item.start + delta)) },
        false,
      );
    } else {
      onChangeLayer(
        item.id,
        {
          endFrame: Math.min(
            duration,
            Math.max(item.start + 1, item.end + delta),
          ),
        },
        false,
      );
    }
  };
  return (
    <section className="mc-timeline" aria-label="图层时间线">
      <div className="mc-timeline-heading">
        <strong>时间线</strong>
        <span>
          {time(frame)} / {time(duration)}
        </span>
        <span>{document.settings.fps} fps</span>
      </div>
      <div className="mc-timeline-scroller">
        <div className="mc-timeline-inner">
          <div className="mc-timeline-ruler">
            <div className="mc-timeline-label">
              图层 · {document.layers.length} 项
            </div>
            <div
              className="mc-ruler-track"
              ref={(element) => {
                ruler.current = element;
                if (element && Math.abs(element.clientWidth - width) > 3)
                  setWidth(element.clientWidth);
              }}
              onClick={(event) => onFrame(pointerFrame(event.clientX))}
            >
              {Array.from(
                { length: Math.ceil(duration / document.settings.fps) + 1 },
                (_, index) => (
                  <span
                    key={index}
                    style={{
                      left: `${index * document.settings.fps * pxPerFrame}px`,
                    }}
                  >
                    {String(index).padStart(2, "0")}:00
                  </span>
                ),
              )}
              <i className="mc-playhead" style={{ left: frame * pxPerFrame }} />
            </div>
          </div>
          {document.layers
            .slice()
            .reverse()
            .map((layer) => (
              <div
                className={`mc-timeline-row ${selectedId === layer.id ? "selected" : ""}`}
                key={layer.id}
              >
                <div className="mc-timeline-label">
                  <button
                    className="mc-layer-name"
                    data-amadeus-id={layer.id}
                    onClick={() => onSelect(layer.id)}
                  >
                    {layer.kind === "text"
                      ? "T"
                      : layer.kind === "shape"
                        ? "◆"
                        : layer.kind === "video"
                          ? "▣"
                          : "▧"}{" "}
                    &nbsp;{layer.name}
                  </button>
                  <button
                    aria-label={`${layer.visible ? "隐藏" : "显示"}${layer.name}`}
                    onClick={() =>
                      onChangeLayer(layer.id, { visible: !layer.visible })
                    }
                  >
                    {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <button
                    aria-label={`${layer.locked ? "解锁" : "锁定"}${layer.name}`}
                    onClick={() =>
                      onChangeLayer(layer.id, { locked: !layer.locked })
                    }
                  >
                    {layer.locked ? (
                      <LockKeyhole size={14} />
                    ) : (
                      <UnlockKeyhole size={14} />
                    )}
                  </button>
                </div>
                <div
                  className="mc-timeline-track"
                  onClick={(event) => onFrame(pointerFrame(event.clientX))}
                >
                  <div
                    className={`mc-layer-bar mc-bar-${layer.kind}`}
                    data-amadeus-id={layer.id}
                    style={{
                      left: layer.startFrame * pxPerFrame,
                      width: (layer.endFrame - layer.startFrame) * pxPerFrame,
                    }}
                    onPointerDown={(event) => startDrag(event, layer, "move")}
                    onPointerMove={moveDrag}
                    onPointerUp={() => {
                      drag.current = null;
                    }}
                  >
                    <span
                      className="mc-trim-handle left"
                      onPointerDown={(event) =>
                        startDrag(event, layer, "start")
                      }
                      onPointerMove={moveDrag}
                      onPointerUp={() => {
                        drag.current = null;
                      }}
                    />
                    <span className="mc-bar-title">{layer.name}</span>
                    <span
                      className="mc-trim-handle right"
                      onPointerDown={(event) => startDrag(event, layer, "end")}
                      onPointerMove={moveDrag}
                      onPointerUp={() => {
                        drag.current = null;
                      }}
                    />
                  </div>
                  {(layer.keyframes ?? []).map((key) => (
                    <button
                      key={key.id}
                      className="mc-key-diamond"
                      style={{
                        left: (layer.startFrame + key.frame) * pxPerFrame,
                      }}
                      title={`${key.property} · 第 ${key.frame} 帧`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(layer.id);
                        onFrame(layer.startFrame + key.frame);
                      }}
                    >
                      ◆
                    </button>
                  ))}
                  <i
                    className="mc-playhead"
                    style={{ left: frame * pxPerFrame }}
                  />
                </div>
              </div>
            ))}
          {selectedId &&
            (() => {
              const layer = document.layers.find(
                (item) => item.id === selectedId,
              );
              return (
                layer && (
                  <div className="mc-property-row">
                    <div className="mc-timeline-label">位置 X / Y</div>
                    <div className="mc-timeline-track">
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          color: "#9db4c9",
                        }}
                      >
                        {Math.round(valueAt(layer, "x", frame))},{" "}
                        {Math.round(valueAt(layer, "y", frame))}
                      </span>
                    </div>
                  </div>
                )
              );
            })()}
        </div>
      </div>
    </section>
  );
}
