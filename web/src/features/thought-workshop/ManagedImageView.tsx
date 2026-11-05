import { LoadingState } from "@shared/ui/LoadingState";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { useDocumentAccess } from "./DocumentAccess";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { NodeSelection, Selection } from "@tiptap/pm/state";
import { useImagePreviewUrl } from "@platform/api/useImagePreviewUrl";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { ImageCropDialog, type CropRect } from "./ImageCropDialog";
import { ImageToolbar } from "./ImageToolbar";

type ImageAlign = "left" | "center" | "right";

function clampWidth(value: number) {
  return Math.max(40, Math.min(2000, Math.round(value)));
}

function readCrop(attrs: Record<string, unknown>): CropRect | null {
  const cropLeft = attrs.cropLeft;
  const cropTop = attrs.cropTop;
  const cropWidth = attrs.cropWidth;
  const cropHeight = attrs.cropHeight;
  if (
    [cropLeft, cropTop, cropWidth, cropHeight].every(
      (value) => typeof value === "number",
    )
  )
    return {
      cropLeft: cropLeft as number,
      cropTop: cropTop as number,
      cropWidth: cropWidth as number,
      cropHeight: cropHeight as number,
    };
  return null;
}

function readAlign(value: unknown): ImageAlign {
  return value === "center" || value === "right" ? value : "left";
}

const clearCrop = {
  cropLeft: null,
  cropTop: null,
  cropWidth: null,
  cropHeight: null,
};

export function ManagedImageView({
  node,
  selected,
  updateAttributes,
  editor,
  getPos,
}: NodeViewProps) {
  const access = useDocumentAccess();
  const preferredPreviewSize =
    (Number(node.attrs.width) || 480) *
      Math.min(window.devicePixelRatio || 1, 2) >
    640
      ? 1280
      : 640;
  // Keep the selected image and its controls mounted during width changes.
  const unselectedPreviewSize = useRef(preferredPreviewSize);
  useEffect(() => {
    if (!selected) unselectedPreviewSize.current = preferredPreviewSize;
  }, [preferredPreviewSize, selected]);
  const {
    ref: previewRef,
    url,
    error,
    progress,
  } = useImagePreviewUrl(
    access.assetUrl(String(node.attrs.assetId)),
    selected ? unselectedPreviewSize.current : preferredPreviewSize,
  );
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [cropping, setCropping] = useState(false);
  const [fullSize, setFullSize] = useState<{ width: number; height: number }>();
  const originalImage = useApiBlobUrl(
    cropping ? access.assetUrl(String(node.attrs.assetId)) : null,
  );
  useEffect(() => {
    if (!originalImage.url) {
      setFullSize(undefined);
      return;
    }
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active)
        setFullSize({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.src = originalImage.url;
    return () => {
      active = false;
      image.onload = null;
    };
  }, [originalImage.url]);
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const resize = useRef<{
    startX: number;
    startWidth: number;
    direction: 1 | -1;
  } | null>(null);
  const crop = readCrop(node.attrs);
  const align = readAlign(node.attrs.align);
  const displayWidth = Number(node.attrs.width) || 480;
  const caption = String(node.attrs.caption || "");
  const alt = String(node.attrs.alt || "");

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!resize.current) return;
      const next = clampWidth(
        resize.current.startWidth +
          resize.current.direction * (event.clientX - resize.current.startX),
      );
      updateAttributes({ width: next });
    };
    const onUp = () => {
      resize.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updateAttributes]);

  useEffect(() => {
    if (!selected || !editor.isEditable || cropping) return;
    const deselect = () => {
      const position = getPos();
      const selection = editor.state.selection;
      if (
        typeof position !== "number" ||
        !(selection instanceof NodeSelection) ||
        selection.from !== position
      )
        return;
      const nextPosition = Math.min(
        editor.state.doc.content.size,
        position + node.nodeSize,
      );
      editor.view.dispatch(
        editor.state.tr.setSelection(
          Selection.near(editor.state.doc.resolve(nextPosition)),
        ),
      );
    };
    const dismissFromOutside = (event: MouseEvent) => {
      const target = event.target;
      const root = rootRef.current;
      if (!(target instanceof Element) || !root) return;
      // Closing the portal can re-enable this listener during the same click.
      if (target.closest(".thought-image-crop-backdrop")) return;
      const interactive = target.closest(
        ".thought-image-figure, .thought-image-actions",
      );
      if (interactive && root.contains(interactive)) return;
      deselect();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        if (rootRef.current?.querySelector(".thought-image-settings")) return;
        event.preventDefault();
        event.stopPropagation();
        deselect();
        editor.view.focus();
      } else if (
        event.key === "Tab" &&
        !event.shiftKey &&
        event.target === editor.view.dom
      ) {
        const first = rootRef.current?.querySelector<HTMLButtonElement>(
          ".thought-image-toolbar:not([inert]) button",
        );
        if (first) {
          event.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };
    document.addEventListener("click", dismissFromOutside);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", dismissFromOutside);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [cropping, editor, getPos, node.nodeSize, selected]);

  const closeCrop = () => {
    setCropping(false);
    requestAnimationFrame(() =>
      rootRef.current
        ?.querySelector<HTMLButtonElement>(
          '.thought-image-toolbar button[aria-label="裁剪"]',
        )
        ?.focus({ preventScroll: true }),
    );
  };

  const beginResize = (event: ReactPointerEvent, direction: 1 | -1) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resize.current = {
      startX: event.clientX,
      startWidth: frameRef.current?.offsetWidth || displayWidth,
      direction,
    };
  };
  const cropAspect =
    crop && natural.width > 0 && natural.height > 0
      ? (natural.width * crop.cropWidth) / (natural.height * crop.cropHeight)
      : null;
  const recordNaturalSize = (image: HTMLImageElement) =>
    setNatural({ width: image.naturalWidth, height: image.naturalHeight });

  return (
    <NodeViewWrapper
      ref={rootRef}
      className={`thought-image thought-image-align-${align} ${selected ? "selected" : ""}`}
    >
      <div
        className="thought-image-figure"
        style={{ width: displayWidth, maxWidth: "100%" }}
      >
        <div
          ref={(element) => {
            frameRef.current = element;
            previewRef.current = element;
          }}
          className="thought-image-frame"
          onClick={(event) => {
            if (
              !editor.isEditable ||
              (event.target as Element).closest("button")
            )
              return;
            const position = getPos();
            if (typeof position !== "number") return;
            event.stopPropagation();
            editor.view.dispatch(
              editor.state.tr.setSelection(
                NodeSelection.create(editor.state.doc, position),
              ),
            );
            editor.view.focus();
          }}
        >
          {url ? (
            crop && cropAspect ? (
              <div
                className="thought-image-crop-viewport"
                style={{ aspectRatio: String(cropAspect) }}
              >
                <ResponsiveImage
                  src={url}
                  alt={alt || "笔记图片"}
                  draggable={false}
                  onLoad={(event) => recordNaturalSize(event.currentTarget)}
                  style={{
                    width: `${10000 / crop.cropWidth}%`,
                    height: `${10000 / crop.cropHeight}%`,
                    left: `${(-crop.cropLeft / crop.cropWidth) * 100}%`,
                    top: `${(-crop.cropTop / crop.cropHeight) * 100}%`,
                  }}
                />
              </div>
            ) : (
              <ResponsiveImage
                src={url}
                alt={alt || "笔记图片"}
                draggable={false}
                onLoad={(event) => recordNaturalSize(event.currentTarget)}
              />
            )
          ) : (
            <span>
              {error ? (
                "图片读取失败"
              ) : (
                <LoadingState
                  variant="inline"
                  label="图片加载中…"
                  progress={progress}
                />
              )}
            </span>
          )}
          {selected && editor.isEditable && url ? (
            <>
              <button
                type="button"
                className="thought-image-handle thought-image-handle-se"
                aria-label="从右下角拖动调整图片宽度"
                onPointerDown={(event) => beginResize(event, 1)}
              />
              <button
                type="button"
                className="thought-image-handle thought-image-handle-sw"
                aria-label="从左下角拖动调整图片宽度"
                onPointerDown={(event) => beginResize(event, -1)}
              />
            </>
          ) : null}
        </div>
        {caption ? <p className="thought-image-caption">{caption}</p> : null}
      </div>
      {selected && editor.isEditable && url ? (
        <ImageToolbar
          frame={frameRef}
          suspended={cropping}
          width={displayWidth}
          alt={alt}
          caption={caption}
          align={align}
          cropped={!!crop}
          updateAttributes={updateAttributes}
          onCrop={() => setCropping(true)}
          onReset={() => updateAttributes(clearCrop)}
        />
      ) : null}
      {cropping && !originalImage.url ? (
        <LoadingState label="正在加载原图…" progress={originalImage.progress} />
      ) : null}
      {cropping && originalImage.error ? (
        <p role="alert">
          原图加载失败
          <button type="button" onClick={closeCrop}>
            关闭
          </button>
        </p>
      ) : null}
      {cropping && originalImage.url ? (
        <ImageCropDialog
          url={originalImage.url}
          alt={alt || "笔记图片"}
          initial={crop}
          naturalSize={fullSize ?? natural}
          onCancel={closeCrop}
          onConfirm={(next) => {
            updateAttributes(next ?? clearCrop);
            closeCrop();
          }}
        />
      ) : null}
    </NodeViewWrapper>
  );
}
