import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { ImagePreview } from "@shared/ui/ImagePreview";
import { useBackdropDismiss } from "@shared/ui/useBackdropDismiss";
import type { Card } from "./api";
import type { CardImage, CardImageGroup } from "./cardImages";
import { uniqueCardImageCount } from "./cardImages";
import "./card-gallery.css";

function useGalleryDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return dialog;
}

function CardImageViewer({
  card,
  image,
  onClose,
}: {
  card: Card;
  image: CardImage;
  onClose: () => void;
}) {
  const dialog = useGalleryDialog();
  const backdrop = useBackdropDismiss(onClose);
  return (
    <dialog
      ref={dialog}
      {...backdrop}
      className="card-gallery-dialog card-gallery-viewer"
      aria-label={`${card.title}的图片预览`}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="card-gallery-header">
        <div>
          <h2>{card.title}</h2>
          <small>{image.adopted ? "已采用" : "参考图"}</small>
        </div>
        <a
          href={`/v1/files/${image.assetId}/content`}
          target="_blank"
          rel="noreferrer"
        >
          查看原图 <ArrowUpRight size={14} aria-hidden />
        </a>
        <button type="button" aria-label="关闭图片预览" onClick={onClose}>
          <X size={18} aria-hidden />
        </button>
      </header>
      <div className="card-gallery-large-image">
        <ImagePreview
          eager
          size={1280}
          src={`/v1/files/${image.assetId}/content`}
          alt={`${card.title}的${image.adopted ? "采用图" : "参考图"}`}
        />
      </div>
    </dialog>
  );
}

export function CardFamilyGallery({
  root,
  groups,
  loading,
  failed,
  generating,
  onRetry,
  onClose,
  onOpenCard,
}: {
  root: Card;
  groups: CardImageGroup[];
  loading: boolean;
  failed: boolean;
  generating: boolean;
  onRetry: () => void;
  onClose: () => void;
  onOpenCard: (id: string) => void;
}) {
  const dialog = useGalleryDialog();
  const [preview, setPreview] = useState<{ card: Card; image: CardImage }>();
  const backdrop = useBackdropDismiss(onClose);
  const count = uniqueCardImageCount(groups);
  return (
    <>
      <dialog
        ref={dialog}
        {...backdrop}
        className="card-gallery-dialog"
        aria-label={`${root.title}的全部关联图片`}
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <header className="card-gallery-header">
          <div>
            <h2>{root.title} · 全部关联图片</h2>
            <small>{count} 张图片 · 按所属设定卡分组</small>
          </div>
          <button type="button" aria-label="关闭图片总览" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </header>
        <div className="card-gallery-scroll">
          {loading && <p role="status">正在读取候选生成结果…</p>}
          {generating && (
            <p role="status">候选图正在生成，完成后会显示在这里。</p>
          )}
          {failed && (
            <p role="alert">
              部分候选生成结果读取失败，已关联图片仍可查看。
              <button type="button" onClick={onRetry}>
                重试读取候选结果
              </button>
            </p>
          )}
          {!count && !loading && <p>暂无关联图片</p>}
          {[...groups]
            .sort((a, b) =>
              a.card.id === root.id ? -1 : b.card.id === root.id ? 1 : 0,
            )
            .map(({ card, images }) => (
              <section key={card.id} aria-label={`${card.title}的关联图片`}>
                <header className="card-gallery-group-heading">
                  <div>
                    <h3>{card.title}</h3>
                    <small>
                      {card.id === root.id ? "主卡" : "变体"}
                      {card.archived ? " · 已归档" : ""} · {images.length}{" "}
                      张图片
                    </small>
                  </div>
                  <button type="button" onClick={() => onOpenCard(card.id)}>
                    打开设定卡
                  </button>
                </header>
                {!images.length && (
                  <p className="card-gallery-empty">暂无关联图片</p>
                )}
                <div className="card-gallery-grid">
                  {images.map((image, index) => (
                    <figure key={image.assetId}>
                      <div className="card-gallery-thumbnail">
                        <ImagePreview
                          size={320}
                          src={`/v1/files/${image.assetId}/content`}
                          alt={`${card.title}的关联图片 ${index + 1}`}
                          onClick={(event) => {
                            event.currentTarget
                              .closest("figure")
                              ?.querySelector<HTMLButtonElement>(
                                "figcaption button",
                              )
                              ?.focus();
                            setPreview({ card, image });
                          }}
                        />
                      </div>
                      <figcaption>
                        <span
                          className={
                            image.adopted ? "card-gallery-adopted" : undefined
                          }
                        >
                          {image.adopted ? "已采用" : "参考图"}
                        </span>
                        <button
                          type="button"
                          aria-label={`查看大图 ${card.title} ${index + 1}`}
                          onClick={() => setPreview({ card, image })}
                        >
                          查看大图
                        </button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            ))}
        </div>
      </dialog>
      {preview && (
        <CardImageViewer {...preview} onClose={() => setPreview(undefined)} />
      )}
    </>
  );
}
