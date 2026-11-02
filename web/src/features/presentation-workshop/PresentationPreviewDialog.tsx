import { LoadingState } from "@shared/ui/LoadingState";
import { keepDialogEscapeLocal } from "./dialogKeyboard";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { SlidePreview } from "./SlideSurface";
import type { PageSize, Slide } from "./types";

export function PresentationPreviewDialog({
  size,
  assetUrls,
  title,
  slides,
  loading,
  failed,
  retry,
  actionLabel,
  onUse,
  onClose,
  returnFocus,
}: {
  size?: PageSize;
  assetUrls?: Record<string, string>;
  title: string;
  slides?: Slide[];
  loading: boolean;
  failed: boolean;
  retry: () => void;
  actionLabel: string;
  onUse: () => void;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const [index, setIndex] = useState(0);
  const total = slides?.length ?? 0;
  const current = Math.min(index, Math.max(0, total - 1));
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        !total
      )
        return;
      const direction = {
        ArrowLeft: -1,
        PageUp: -1,
        ArrowRight: 1,
        PageDown: 1,
      }[event.key];
      if (
        direction === undefined &&
        event.key !== "Home" &&
        event.key !== "End"
      )
        return;
      event.preventDefault();
      setIndex((page) =>
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? total - 1
            : Math.max(0, Math.min(total - 1, page + direction!)),
      );
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [total]);
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="presentation-preview-backdrop" />
        <Dialog.Content
          onEscapeKeyDown={keepDialogEscapeLocal}
          className="presentation-dialog presentation-preview-dialog presentation-dialog-floating"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus();
          }}
        >
          <header>
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                使用方向键翻页，按 Escape 关闭预览。
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn" aria-label="关闭预览">
              <X size={20} aria-hidden />
            </Dialog.Close>
          </header>
          <div className="presentation-dialog-body">
            {failed ? (
              <div className="presentation-preview-status" role="alert">
                <p>预览加载失败，请重试。</p>
                <button className="btn" onClick={retry}>
                  重试
                </button>
              </div>
            ) : loading || !slides?.length ? (
              <LoadingState
                label="正在加载预览…"
                variant="region"
                className="presentation-preview-status"
              />
            ) : (
              <>
                <div
                  className="presentation-preview-stage"
                  aria-label={`第 ${current + 1} 页完整预览`}
                >
                  <SlidePreview
                    slide={slides[current]}
                    size={size}
                    assetUrls={assetUrls}
                  />
                </div>
                <nav
                  className="presentation-preview-filmstrip"
                  aria-label="预览页面"
                >
                  {slides.map((slide, page) => (
                    <button
                      key={slide.id}
                      aria-label={`查看第 ${page + 1} 页`}
                      aria-current={page === current ? "page" : undefined}
                      onClick={() => setIndex(page)}
                    >
                      <SlidePreview
                        slide={slide}
                        size={size}
                        assetUrls={assetUrls}
                      />
                      <span>{page + 1}</span>
                    </button>
                  ))}
                </nav>
              </>
            )}
          </div>
          <footer>
            <nav aria-label="预览翻页">
              <button
                className="btn"
                aria-label="上一页"
                disabled={!total || current === 0 || loading || failed}
                onClick={() => setIndex(current - 1)}
              >
                <ChevronLeft size={18} aria-hidden />
              </button>
              <span role="status">
                {total ? `${current + 1} / ${total}` : "—"}
              </span>
              <button
                className="btn"
                aria-label="下一页"
                disabled={!total || current === total - 1 || loading || failed}
                onClick={() => setIndex(current + 1)}
              >
                <ChevronRight size={18} aria-hidden />
              </button>
            </nav>
            <button className="btn primary" onClick={onUse}>
              {actionLabel}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
