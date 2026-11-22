import { useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Images, Plus } from "lucide-react";
import { ImagePreview } from "@shared/ui/ImagePreview";
import type { Card } from "./api";
import type { CardFamily } from "./cardFamilies";
import { cardKindInfo } from "./cardKinds";
import { VariantStrip } from "./VariantStrip";
import { CardFamilyGallery } from "./CardFamilyGallery";
import { useCardFamilyImages } from "./useCardFamilyImages";

function status(card: Card) {
  return card.archived
    ? "已归档"
    : card.adopted_asset_id
      ? "已采用图片"
      : "待确认";
}
function Picture({ card }: { card: Card }) {
  const Icon = cardKindInfo[card.kind].icon;
  return card.adopted_asset_id ? (
    <ImagePreview
      interactive={false}
      size={640}
      src={`/v1/files/${card.adopted_asset_id}/thumbnail`}
    />
  ) : (
    <Icon size={26} aria-hidden />
  );
}

function Family({
  family: { root, items },
  galleryItems,
  onOpen,
  onVariant,
  readOnly,
  busy,
}: {
  family: CardFamily;
  galleryItems: Card[];
  onOpen: (id: string) => void;
  onVariant: (card: Card) => void;
  readOnly: boolean;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<string>();
  const [galleryOpen, setGalleryOpen] = useState(false);
  const images = useCardFamilyImages(galleryItems, galleryOpen);
  const preview = items.find(({ id }) => id === root.id) ?? items[0]!;
  const variants = items.filter(({ id }) => id !== preview.id);
  const open = (card: Card) => {
    setSelected(card.id);
    onOpen(card.id);
  };
  return (
    <article
      className="creative-design-card card-library-family"
      role="group"
      aria-label={`${root.title}设定组`}
    >
      {preview.id !== root.id && (
        <p className="card-family-context">
          {root.title}
          {root.archived ? " · 主卡已归档" : ""}
        </p>
      )}
      <button
        className="card-family-main"
        type="button"
        aria-label={`${preview.title} ${status(preview)}`}
        onClick={() => open(preview)}
      >
        <span className="creative-card-cover">
          <Picture card={preview} />
        </span>
      </button>
      <div className="card-family-summary">
        <button
          type="button"
          className="card-family-title"
          title={preview.title}
          aria-label={`${readOnly ? "查看" : "编辑"}${preview.title}`}
          onClick={() => open(preview)}
        >
          <strong>{preview.title}</strong>
        </button>
        <small className="card-family-status" title={status(preview)}>
          {status(preview).replace("图片", "")}
        </small>
        <small className="card-family-variant-count">
          {items.filter(({ id }) => id !== root.id).length} 变体
        </small>
        {!readOnly && (
          <button
            type="button"
            className="card-family-add-variant"
            aria-label={`为${root.title}创建变体`}
            title="创建变体"
            disabled={busy || root.archived || !root.adopted_asset_id}
            onClick={() => onVariant(root)}
          >
            <Plus size={13} aria-hidden />
          </button>
        )}
      </div>
      <button
        type="button"
        className="card-family-gallery-button"
        aria-label={`查看${root.title}的全部关联图片`}
        title={images.incomplete ? "打开后读取更多候选生成结果" : undefined}
        onClick={() => setGalleryOpen(true)}
      >
        <Images size={14} aria-hidden />
        查看全部图片（{images.count}
        {images.incomplete ? "+" : ""}）
      </button>
      {variants.length > 0 && (
        <Tooltip.Provider delayDuration={350}>
          <VariantStrip
            key={variants.map(({ id }) => id).join(":")}
            label={`${root.title}的变体`}
            onKeyDown={(event) => {
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  ".card-variant-select",
                ),
              ];
              const index = buttons.indexOf(event.target as HTMLButtonElement);
              if (index < 0) return;
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : event.key === "ArrowRight"
                      ? (index + 1) % buttons.length
                      : event.key === "ArrowLeft"
                        ? (index + buttons.length - 1) % buttons.length
                        : -1;
              if (next >= 0) {
                event.preventDefault();
                buttons[next]?.focus();
              }
            }}
          >
            {variants.map((card) => {
              const prefix = `${root.title} · `;
              const title = card.title.startsWith(prefix)
                ? card.title.slice(prefix.length)
                : card.title;
              return (
                <div className="card-variant-tile" key={card.id}>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <button
                        type="button"
                        className="card-variant-select"
                        aria-label={`查看变体 ${card.title}`}
                        aria-pressed={selected === card.id}
                        onClick={() => open(card)}
                      >
                        <span className="card-variant-thumb">
                          <Picture card={card} />
                        </span>
                        <span className="card-variant-caption">{title}</span>
                        <small className="card-variant-image-count">
                          {images.groups.find(
                            (group) => group.card.id === card.id,
                          )?.images.length ?? 0}
                          {images.incompleteCards.has(card.id) ? "+" : ""}{" "}
                          张图片
                        </small>
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        className="card-variant-tooltip"
                        side="top"
                        sideOffset={6}
                      >
                        {card.title} · {status(card)}
                        <Tooltip.Arrow />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </div>
              );
            })}
          </VariantStrip>
        </Tooltip.Provider>
      )}
      {galleryOpen && (
        <CardFamilyGallery
          root={root}
          groups={images.groups}
          loading={images.loading}
          failed={images.failed}
          generating={images.generating}
          onRetry={images.retry}
          onClose={() => setGalleryOpen(false)}
          onOpenCard={(id) => {
            setGalleryOpen(false);
            setSelected(id);
            onOpen(id);
          }}
        />
      )}
    </article>
  );
}

export function CardLibraryGroups({
  families,
  galleryFamilies = families,
  ...props
}: {
  families: CardFamily[];
  galleryFamilies?: CardFamily[];
  onOpen: (id: string) => void;
  onVariant: (card: Card) => void;
  readOnly: boolean;
  busy: boolean;
}) {
  return (
    <div className="creative-card-grid card-library-grid">
      {families.map((family) => (
        <Family
          key={family.root.id}
          family={family}
          galleryItems={
            galleryFamilies.find(({ root }) => root.id === family.root.id)
              ?.items ?? family.items
          }
          {...props}
        />
      ))}
    </div>
  );
}
