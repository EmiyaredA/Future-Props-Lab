import { useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Plus } from "lucide-react";
import { ImagePreview } from "@shared/ui/ImagePreview";
import type { Card } from "./api";
import type { CardFamily } from "./cardFamilies";
import { cardKindInfo } from "./cardKinds";
import { VariantStrip } from "./VariantStrip";

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
  onOpen,
  onVariant,
  readOnly,
  busy,
}: {
  family: CardFamily;
  onOpen: (id: string) => void;
  onVariant: (card: Card) => void;
  readOnly: boolean;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<string>();
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
        <strong title={preview.title}>{preview.title}</strong>
        <small>{status(preview)}</small>
      </button>
      <div className="card-family-actions">
        <small>{items.filter(({ id }) => id !== root.id).length} 款变体</small>
        {!readOnly && (
          <button
            type="button"
            aria-label={`为${root.title}创建变体`}
            disabled={busy || root.archived || !root.adopted_asset_id}
            onClick={() => onVariant(root)}
          >
            <Plus size={13} aria-hidden />
            创建变体
          </button>
        )}
      </div>
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
    </article>
  );
}

export function CardLibraryGroups({
  families,
  ...props
}: {
  families: CardFamily[];
  onOpen: (id: string) => void;
  onVariant: (card: Card) => void;
  readOnly: boolean;
  busy: boolean;
}) {
  return (
    <div className="creative-card-grid card-library-grid">
      {families.map((family) => (
        <Family key={family.root.id} family={family} {...props} />
      ))}
    </div>
  );
}
