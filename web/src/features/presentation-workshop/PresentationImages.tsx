import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { listImages } from "./api";
import { presentationKeys } from "./queryKeys";
import { newElement } from "./templates";
import { ElementImage } from "./SlideSurface";

export function PresentationImages({
  onClose,
  onChoose,
}: {
  onClose: () => void;
  onChoose: (id: string) => void;
}) {
  const root = useDrawerFocus<HTMLDivElement>(onClose, true, false);
  const images = useQuery({
    queryKey: presentationKeys.images,
    queryFn: ({ signal }) => listImages(signal),
  });
  return (
    <div
      className="presentation-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={root}
        className="presentation-image-library"
        role="dialog"
        aria-modal="true"
        aria-label="选择文件库图片"
      >
        <header>
          <h3>文件库图片</h3>
          <button
            className="icon-btn"
            aria-label="关闭图片选择"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {images.isPending ? (
          <p role="status">加载图片…</p>
        ) : images.isError ? (
          <p role="alert">
            图片加载失败{" "}
            <button className="btn" onClick={() => void images.refetch()}>
              重试
            </button>
          </p>
        ) : null}
        <div className="presentation-image-grid">
          {images.data?.items.map((image) => (
            <button
              key={image.id}
              onClick={() => onChoose(image.id)}
              aria-label={`插入 ${image.display_name || image.original_filename}`}
            >
              <div>
                <ElementImage
                  contain
                  element={newElement("image", { asset_id: image.id })}
                />
              </div>
              <span>{image.display_name || image.original_filename}</span>
            </button>
          ))}
        </div>
        {images.data?.items.length === 0 ? (
          <p>文件库中还没有图片，可返回编辑器上传。</p>
        ) : null}
      </div>
    </div>
  );
}
