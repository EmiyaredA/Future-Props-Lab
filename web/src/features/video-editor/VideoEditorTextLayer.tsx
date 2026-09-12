import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { textLayerPath } from "./api";
import { textPosition, textPositionOperations } from "./textModel";
import type { VideoEditorClip, VideoEditorOperation } from "./types";
import "./video-editor-text.css";

export function VideoEditorTextLayer({
  projectId,
  revision,
  clip,
  style,
  canvasWidth,
  canvasHeight,
  stageRef,
  playheadUs,
  selected,
  disabled,
  onSelect,
  setPlaying,
  onDragging,
  commit,
}: {
  projectId: string;
  revision: number;
  clip: VideoEditorClip;
  style: CSSProperties;
  canvasWidth: number;
  canvasHeight: number;
  stageRef: RefObject<HTMLDivElement | null>;
  playheadUs: number;
  selected: boolean;
  disabled: boolean;
  onSelect?: (clipId: string) => void;
  setPlaying: (value: boolean) => void;
  onDragging: (value: boolean) => void;
  commit?: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
}) {
  const { url, error } = useApiBlobUrl(
    textLayerPath(projectId, clip.id, revision),
  );
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const origin = useRef<
    | {
        pointerId: number;
        clientX: number;
        clientY: number;
        x: number;
        y: number;
        ratioX: number;
        ratioY: number;
        revision: number;
      }
    | undefined
  >(undefined);
  const nextPosition = useRef<{ x: number; y: number } | undefined>(undefined);
  const cancel = () => {
    origin.current = undefined;
    nextPosition.current = undefined;
    setPosition(undefined);
    onDragging(false);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && origin.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        origin.current = undefined;
        nextPosition.current = undefined;
        setPosition(undefined);
        onDragging(false);
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      onDragging(false);
    };
  }, [onDragging]);
  const savePosition = async (x: number, y: number) => {
    if (!commit) return;
    const operations = textPositionOperations(clip, playheadUs, x, y);
    setSaving(true);
    setSaveError("");
    try {
      await commit(operations.redo, operations.undo);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "位置保存失败");
    } finally {
      setSaving(false);
      cancel();
    }
  };
  const fitRatio =
    size.width && size.height
      ? clip.fitMode === "cover"
        ? Math.max(canvasWidth / size.width, canvasHeight / size.height)
        : clip.fitMode === "contain"
          ? Math.min(canvasWidth / size.width, canvasHeight / size.height)
          : clip.fitMode === "height" && clip.heightPercent
            ? (canvasHeight * clip.heightPercent) / 100 / size.height
            : 1
      : 1;
  const geometry: CSSProperties = {
    ...style,
    ...(position
      ? {
          left: `${(position.x / canvasWidth) * 100}%`,
          top: `${(position.y / canvasHeight) * 100}%`,
        }
      : {}),
    width: `${((size.width * fitRatio) / canvasWidth) * 100}%`,
    height: `${((size.height * fitRatio) / canvasHeight) * 100}%`,
  };
  return (
    <>
      <div className="ve-text-layer" style={geometry}>
        {url && (
          <img
            src={url}
            alt={clip.text ?? "文字"}
            draggable={false}
            onLoad={(event) =>
              setSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
        )}
      </div>
      {Boolean(size.width) && !disabled && commit && (
        <button
          type="button"
          className={`ve-text-hit ${selected ? "selected" : ""}`}
          style={{ ...geometry, opacity: 1, filter: undefined }}
          aria-label={`移动文字：${clip.text}`}
          disabled={saving}
          onPointerDown={(event) => {
            if (event.button !== 0 || saving) return;
            const bounds = stageRef.current?.getBoundingClientRect();
            if (!bounds?.width || !bounds.height) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            onSelect?.(clip.id);
            setPlaying(false);
            const initial = textPosition(clip, playheadUs);
            origin.current = {
              pointerId: event.pointerId,
              clientX: event.clientX,
              clientY: event.clientY,
              ...initial,
              ratioX: canvasWidth / bounds.width,
              ratioY: canvasHeight / bounds.height,
              revision,
            };
            nextPosition.current = initial;
          }}
          onPointerMove={(event) => {
            const start = origin.current;
            if (!start || start.pointerId !== event.pointerId) return;
            let x = start.x + (event.clientX - start.clientX) * start.ratioX;
            let y = start.y + (event.clientY - start.clientY) * start.ratioY;
            if (Math.abs(x - canvasWidth / 2) < 6 * start.ratioX)
              x = canvasWidth / 2;
            if (Math.abs(y - canvasHeight / 2) < 6 * start.ratioY)
              y = canvasHeight / 2;
            nextPosition.current = { x: Math.round(x), y: Math.round(y) };
            setPosition(nextPosition.current);
            onDragging(true);
          }}
          onPointerUp={(event) => {
            const start = origin.current;
            if (!start || start.pointerId !== event.pointerId) return;
            const next = nextPosition.current;
            origin.current = undefined;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            if (
              start.revision !== revision ||
              !next ||
              (next.x === start.x && next.y === start.y)
            ) {
              cancel();
              return;
            }
            void savePosition(next.x, next.y);
          }}
          onPointerCancel={cancel}
          onLostPointerCapture={() => {
            if (origin.current) cancel();
          }}
          onKeyDown={(event) => {
            if (
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            const current = textPosition(clip, playheadUs);
            const step = event.shiftKey ? 10 : 1;
            onSelect?.(clip.id);
            setPlaying(false);
            void savePosition(
              current.x +
                (event.key === "ArrowRight"
                  ? step
                  : event.key === "ArrowLeft"
                    ? -step
                    : 0),
              current.y +
                (event.key === "ArrowDown"
                  ? step
                  : event.key === "ArrowUp"
                    ? -step
                    : 0),
            );
          }}
        />
      )}
      {position?.x === canvasWidth / 2 && (
        <i className="ve-text-guide vertical" aria-hidden />
      )}
      {position?.y === canvasHeight / 2 && (
        <i className="ve-text-guide horizontal" aria-hidden />
      )}
      {(error || saveError) && (
        <span className="ve-text-preview-error" role="alert">
          {saveError || "文字预览加载失败，请刷新重试"}
        </span>
      )}
    </>
  );
}
