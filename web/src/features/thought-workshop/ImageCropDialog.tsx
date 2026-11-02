import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RotateCcw, X } from "lucide-react";
import { createPortal } from "react-dom";
import "./image-crop-dialog.css";

export type CropRect = {
  cropLeft: number;
  cropTop: number;
  cropWidth: number;
  cropHeight: number;
};

type CropRatio = "free" | "original" | "1:1" | "4:3" | "16:9";
type CropHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const FULL_CROP: CropRect = {
  cropLeft: 0,
  cropTop: 0,
  cropWidth: 100,
  cropHeight: 100,
};
const MIN_CROP = 1;
const cropRatios: Array<{ value: CropRatio; label: string }> = [
  { value: "free", label: "自由" },
  { value: "original", label: "原图" },
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "16:9", label: "16:9" },
];
const cropHandles: Array<{ value: CropHandle; label: string }> = [
  { value: "nw", label: "左上角" },
  { value: "n", label: "上边" },
  { value: "ne", label: "右上角" },
  { value: "e", label: "右边" },
  { value: "se", label: "右下角" },
  { value: "s", label: "下边" },
  { value: "sw", label: "左下角" },
  { value: "w", label: "左边" },
];

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function normalizeCrop(rect: CropRect): CropRect {
  const cropLeft = clamp(Math.round(rect.cropLeft), 0, 99);
  const cropTop = clamp(Math.round(rect.cropTop), 0, 99);
  return {
    cropLeft,
    cropTop,
    cropWidth: clamp(Math.round(rect.cropWidth), MIN_CROP, 100 - cropLeft),
    cropHeight: clamp(Math.round(rect.cropHeight), MIN_CROP, 100 - cropTop),
  };
}

function isFullCrop(rect: CropRect) {
  return (
    rect.cropLeft === 0 &&
    rect.cropTop === 0 &&
    rect.cropWidth === 100 &&
    rect.cropHeight === 100
  );
}

function percentAspect(
  ratio: CropRatio,
  natural: { width: number; height: number },
) {
  if (ratio === "free") return null;
  if (ratio === "original") return 1;
  if (!natural.width || !natural.height) return null;
  const target = ratio === "1:1" ? 1 : ratio === "4:3" ? 4 / 3 : 16 / 9;
  return target * (natural.height / natural.width);
}

function fitRatio(rect: CropRect, aspect: number | null) {
  if (!aspect || !Number.isFinite(aspect)) return normalizeCrop(rect);
  let width = rect.cropWidth;
  let height = rect.cropHeight;
  if (width / height > aspect) width = height * aspect;
  else height = width / aspect;
  return normalizeCrop({
    cropLeft: rect.cropLeft + (rect.cropWidth - width) / 2,
    cropTop: rect.cropTop + (rect.cropHeight - height) / 2,
    cropWidth: width,
    cropHeight: height,
  });
}

function cropFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  aspect: number | null,
) {
  return fitRatio(
    {
      cropLeft: Math.min(start.x, end.x),
      cropTop: Math.min(start.y, end.y),
      cropWidth: Math.max(MIN_CROP, Math.abs(end.x - start.x)),
      cropHeight: Math.max(MIN_CROP, Math.abs(end.y - start.y)),
    },
    aspect,
  );
}

function moveCrop(rect: CropRect, dx: number, dy: number) {
  return normalizeCrop({
    ...rect,
    cropLeft: clamp(rect.cropLeft + dx, 0, 100 - rect.cropWidth),
    cropTop: clamp(rect.cropTop + dy, 0, 100 - rect.cropHeight),
  });
}

function resizeCrop(
  rect: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  aspect: number | null,
) {
  let left = rect.cropLeft;
  let top = rect.cropTop;
  let right = rect.cropLeft + rect.cropWidth;
  let bottom = rect.cropTop + rect.cropHeight;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - MIN_CROP);
  if (handle.includes("e")) right = clamp(right + dx, left + MIN_CROP, 100);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + MIN_CROP, 100);
  return fitRatio(
    {
      cropLeft: left,
      cropTop: top,
      cropWidth: right - left,
      cropHeight: bottom - top,
    },
    aspect,
  );
}

function arrowDelta(event: ReactKeyboardEvent) {
  const step = event.shiftKey ? 5 : 1;
  if (event.key === "ArrowLeft") return { x: -step, y: 0 };
  if (event.key === "ArrowRight") return { x: step, y: 0 };
  if (event.key === "ArrowUp") return { x: 0, y: -step };
  if (event.key === "ArrowDown") return { x: 0, y: step };
  return null;
}

export function ImageCropDialog({
  url,
  alt,
  initial,
  naturalSize,
  onCancel,
  onConfirm,
}: {
  url: string;
  alt: string;
  initial: CropRect | null;
  naturalSize: { width: number; height: number };
  onCancel: () => void;
  onConfirm: (crop: CropRect | null) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  const [draft, setDraft] = useState<CropRect>(initial ?? FULL_CROP);
  const [ratio, setRatio] = useState<CropRatio>("free");
  const [natural, setNatural] = useState(naturalSize);
  const drag = useRef<{
    kind: "create" | "move" | "resize";
    start: { x: number; y: number };
    initial: CropRect;
    handle?: CropHandle;
  } | null>(null);
  cancelRef.current = onCancel;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const ownsScrollLock = previousOverflow !== "hidden";
    if (ownsScrollLock) document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current();
      }
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [tabindex="0"]',
      );
      const first = controls?.[0];
      const last = controls?.[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const frame = requestAnimationFrame(() =>
      closeRef.current?.focus({ preventScroll: true }),
    );
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(frame);
      if (ownsScrollLock) document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, []);

  const point = (event: ReactPointerEvent) => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box?.width || !box.height) return { x: 0, y: 0 };
    return {
      x: clamp(((event.clientX - box.left) / box.width) * 100, 0, 100),
      y: clamp(((event.clientY - box.top) / box.height) * 100, 0, 100),
    };
  };
  const aspect = percentAspect(ratio, natural);
  const beginDrag = (
    event: ReactPointerEvent,
    kind: "create" | "move" | "resize",
    handle?: CropHandle,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const start = point(event);
    drag.current = { kind, start, initial: draft, handle };
    if (kind === "create") setDraft(cropFromPoints(start, start, aspect));
  };
  const updateDrag = (event: ReactPointerEvent) => {
    const active = drag.current;
    if (!active) return;
    const current = point(event);
    const dx = current.x - active.start.x;
    const dy = current.y - active.start.y;
    if (active.kind === "create")
      setDraft(cropFromPoints(active.start, current, aspect));
    else if (active.kind === "move") setDraft(moveCrop(active.initial, dx, dy));
    else if (active.handle)
      setDraft(resizeCrop(active.initial, active.handle, dx, dy, aspect));
  };
  const stopDrag = () => {
    drag.current = null;
  };

  return createPortal(
    <div
      className="modal-backdrop thought-image-crop-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="modal-card thought-image-crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="thought-image-crop-header">
          <div>
            <h2 id={titleId}>裁剪图片</h2>
            <p id={descriptionId}>拖动选区或手柄调整保留区域。</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn"
            aria-label="关闭裁剪"
            onClick={onCancel}
          >
            <X aria-hidden />
          </button>
        </header>
        <div className="thought-image-crop-scroll">
          <div
            ref={frameRef}
            className="thought-image-crop-frame"
            onPointerDown={(event) => beginDrag(event, "create")}
            onPointerMove={updateDrag}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
          >
            <ResponsiveImage
              src={url}
              alt={alt}
              draggable={false}
              onLoad={(event) =>
                setNatural({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
            />
            <div
              className="thought-image-crop-selection"
              role="group"
              tabIndex={0}
              aria-label="移动裁剪区域"
              style={{
                left: `${draft.cropLeft}%`,
                top: `${draft.cropTop}%`,
                width: `${draft.cropWidth}%`,
                height: `${draft.cropHeight}%`,
              }}
              onPointerDown={(event) => beginDrag(event, "move")}
              onKeyDown={(event) => {
                const delta = arrowDelta(event);
                if (!delta) return;
                event.preventDefault();
                setDraft((current) => moveCrop(current, delta.x, delta.y));
              }}
            >
              <span className="thought-image-crop-grid" aria-hidden />
              {cropHandles.map((handle) => (
                <button
                  key={handle.value}
                  type="button"
                  className={`thought-image-crop-handle crop-handle-${handle.value}`}
                  aria-label={`调整裁剪区域${handle.label}`}
                  onPointerDown={(event) =>
                    beginDrag(event, "resize", handle.value)
                  }
                  onKeyDown={(event) => {
                    const delta = arrowDelta(event);
                    if (!delta) return;
                    event.preventDefault();
                    setDraft((current) =>
                      resizeCrop(
                        current,
                        handle.value,
                        delta.x,
                        delta.y,
                        aspect,
                      ),
                    );
                  }}
                />
              ))}
            </div>
          </div>
          <div
            className="thought-image-crop-ratios"
            role="group"
            aria-label="裁剪比例"
          >
            {cropRatios.map((option) => (
              <button
                key={option.value}
                type="button"
                className={ratio === option.value ? "active" : ""}
                aria-pressed={ratio === option.value}
                onClick={() => {
                  setRatio(option.value);
                  setDraft((current) =>
                    fitRatio(current, percentAspect(option.value, natural)),
                  );
                }}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              className="thought-image-crop-reset"
              onClick={() => {
                setRatio("free");
                setDraft(FULL_CROP);
              }}
            >
              <RotateCcw aria-hidden />
              重置
            </button>
          </div>
        </div>
        <div className="modal-actions thought-image-crop-actions">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => onConfirm(isFullCrop(draft) ? null : draft)}
          >
            应用裁剪
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
