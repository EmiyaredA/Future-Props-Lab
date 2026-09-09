import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Crop,
  ImageIcon,
  RotateCcw,
} from "lucide-react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { NodeSelection, Selection } from "@tiptap/pm/state";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { ImageCropDialog, type CropRect } from "./ImageCropDialog";

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
  const { url, error } = useApiBlobUrl(
    `/v1/files/${encodeURIComponent(String(node.attrs.assetId))}/content`,
  );
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [cropping, setCropping] = useState(false);
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
    const dismissFromOutside = (event: MouseEvent) => {
      const target = event.target;
      const root = rootRef.current;
      if (!(target instanceof Element) || !root) return;
      const interactiveImageArea = target.closest(
        ".thought-image-figure, .thought-image-controls",
      );
      if (interactiveImageArea && root.contains(interactiveImageArea)) return;
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
    document.addEventListener("click", dismissFromOutside);
    return () => document.removeEventListener("click", dismissFromOutside);
  }, [cropping, editor, getPos, node.nodeSize, selected]);

  const beginResize = (event: ReactPointerEvent, direction: 1 | -1) => {
    event.preventDefault();
    event.stopPropagation();
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
        {editor.isEditable && url ? (
          <div
            className="thought-image-toolbar"
            contentEditable={false}
            role="toolbar"
            aria-label="图片操作"
          >
            {(
              [
                ["left", "图片左对齐", AlignLeft],
                ["center", "图片居中", AlignCenter],
                ["right", "图片右对齐", AlignRight],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                className="icon-btn"
                aria-label={label}
                aria-pressed={align === value}
                onClick={() => updateAttributes({ align: value })}
              >
                <Icon aria-hidden />
              </button>
            ))}
            <span className="thought-image-toolbar-divider" aria-hidden />
            <button
              type="button"
              className="btn"
              onClick={() => setCropping(true)}
            >
              <Crop aria-hidden />
              裁剪
            </button>
            {crop ? (
              <button
                type="button"
                className="btn"
                onClick={() => updateAttributes(clearCrop)}
              >
                <RotateCcw aria-hidden />
                重置裁剪
              </button>
            ) : null}
          </div>
        ) : null}
        <div ref={frameRef} className="thought-image-frame">
          {url ? (
            crop && cropAspect ? (
              <div
                className="thought-image-crop-viewport"
                style={{ aspectRatio: String(cropAspect) }}
              >
                <img
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
              <img
                src={url}
                alt={alt || "笔记图片"}
                draggable={false}
                onLoad={(event) => recordNaturalSize(event.currentTarget)}
              />
            )
          ) : (
            <span>{error ? "图片读取失败" : "图片加载中…"}</span>
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
      {selected && editor.isEditable ? (
        <div
          className="thought-image-controls"
          contentEditable={false}
          role="group"
          aria-label="图片设置"
        >
          <div className="thought-image-controls-heading">
            <span className="thought-image-controls-icon" aria-hidden>
              <ImageIcon />
            </span>
            <span>
              <strong>图片设置</strong>
              <small>调整显示尺寸和图片说明</small>
            </span>
          </div>
          <div className="thought-image-fields">
            <label className="thought-image-width-field">
              <span>显示宽度</span>
              <span className="thought-image-width-input">
                <input
                  aria-label="图片宽度"
                  type="number"
                  min={40}
                  max={2000}
                  value={displayWidth}
                  onChange={(event) =>
                    updateAttributes({
                      width: clampWidth(Number(event.target.value)),
                    })
                  }
                />
                <span aria-hidden>px</span>
              </span>
            </label>
            <label className="thought-image-alt-field">
              <span>替代文字</span>
              <input
                aria-label="图片替代文字"
                value={alt}
                placeholder="简要描述图片内容"
                onChange={(event) =>
                  updateAttributes({ alt: event.target.value })
                }
              />
            </label>
            <label className="thought-image-caption-field">
              <span>图注</span>
              <input
                aria-label="图片图注"
                value={caption}
                placeholder="添加图片说明（可选）"
                onChange={(event) =>
                  updateAttributes({ caption: event.target.value })
                }
              />
            </label>
          </div>
        </div>
      ) : null}
      {cropping && url ? (
        <ImageCropDialog
          url={url}
          alt={alt || "笔记图片"}
          initial={crop}
          naturalSize={natural}
          onCancel={() => setCropping(false)}
          onConfirm={(next) => {
            updateAttributes(next ?? clearCrop);
            setCropping(false);
          }}
        />
      ) : null}
    </NodeViewWrapper>
  );
}
