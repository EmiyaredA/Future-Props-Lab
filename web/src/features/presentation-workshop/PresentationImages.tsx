import { containDialogComposition } from "./dialogKeyboard";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Search, Upload } from "lucide-react";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { listImages } from "./api";
import { presentationKeys } from "./queryKeys";
import { newElement } from "./templates";
import { ElementImage } from "./SlideSurface";
import { SvgImport } from "./SvgImport";

export function PresentationImages({
  onClose,
  onChoose,
  onUpload,
  initialTab = "文件库",
  initialFile,
  busy = false,
  error = "",
  title = "图片与矢量素材",
  chooseLabel = "插入",
  uploadHint = "选择图片，插入后可裁剪与调整样式",
}: {
  onClose: () => void;
  onChoose: (id: string) => void;
  onUpload?: (file: File) => Promise<void>;
  initialTab?: string;
  initialFile?: File;
  busy?: boolean;
  error?: string;
  title?: string;
  chooseLabel?: string;
  uploadHint?: string;
}) {
  const root = useDrawerFocus<HTMLDivElement>(onClose, true, false);
  const [tab, setTab] = useState(initialTab),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const images = useQuery({
    queryKey: presentationKeys.imageSearch(query),
    queryFn: ({ signal }) => listImages(signal, query),
  });
  const items = images.data?.items ?? [],
    total = Math.max(1, Math.ceil(items.length / 24));
  return (
    <div
      className="presentation-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        onKeyDownCapture={containDialogComposition}
        ref={root}
        className="presentation-dialog presentation-dialog-large presentation-image-library presentation-media-picker"
        role="dialog"
        aria-modal="true"
        aria-label={title === "图片与矢量素材" ? "选择文件库图片" : title}
      >
        <header>
          <h3>{title}</h3>
          <button
            className="icon-btn"
            aria-label="关闭图片选择"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div
          className="presentation-media-tabs"
          role="tablist"
          aria-label="素材来源"
        >
          {["文件库", "上传图片", "SVG"].map((value) => (
            <button
              key={value}
              role="tab"
              aria-selected={value === tab}
              onClick={() => setTab(value)}
            >
              {value}
            </button>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
        {tab === "文件库" ? (
          <>
            <label className="presentation-media-search">
              <Search size={16} />
              <input
                aria-label="搜索素材"
                value={query}
                placeholder="搜索文件名称…"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </label>
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
            <div className="presentation-image-grid presentation-dialog-body">
              {items.slice(page * 24, (page + 1) * 24).map((image) => (
                <button
                  key={image.id}
                  disabled={busy}
                  onClick={() => onChoose(image.id)}
                  aria-label={`${chooseLabel} ${image.display_name || image.original_filename}`}
                >
                  <div>
                    <ElementImage
                      contain
                      element={newElement(
                        image.mime_type === "image/svg+xml"
                          ? "vector"
                          : "image",
                        { asset_id: image.id },
                      )}
                    />
                  </div>
                  <span>{image.display_name || image.original_filename}</span>
                  {image.mime_type === "image/svg+xml" && <small>SVG</small>}
                </button>
              ))}
            </div>
            {!images.isPending && !images.isError && !items.length && (
              <p>
                {query
                  ? "没有匹配的素材"
                  : "文件库中还没有图片，可上传图片或导入 SVG。"}
              </p>
            )}
            <footer>
              <button
                className="btn"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </button>
              <span>
                {page + 1} / {total}
              </span>
              <button
                className="btn"
                disabled={page + 1 >= total}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </button>
            </footer>
          </>
        ) : tab === "SVG" ? (
          <SvgImport
            initialFile={initialFile}
            busy={busy}
            onConfirm={async (file) => {
              await onUpload?.(file);
            }}
          />
        ) : (
          <div className="presentation-upload-zone presentation-dialog-body">
            <Upload size={32} />
            <p>{uploadHint}</p>
            {initialFile && (
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void onUpload?.(initialFile)}
              >
                插入{initialFile.name || "图片"}
              </button>
            )}
            <label className="btn presentation-file-input">
              选择图片
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onUpload?.(file);
                }}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
