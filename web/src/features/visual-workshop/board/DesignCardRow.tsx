import { ImageIcon } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ImagePreview } from "@shared/ui/ImagePreview";
import type { VisualCanvasNode } from "../api";
import type { Card } from "../creative/api";
import { BoardMenu } from "./BoardMenu";

export function DesignCardRow({
  card,
  label,
  ...actions
}: {
  card: Card;
  label: { name: string; variant?: string };
  canUse: boolean;
  disabled?: boolean;
  sources: VisualCanvasNode[];
  onUse: (card: Card) => void;
  onCanvas: (card: Card) => void;
  onView: (card: Card) => void;
  onRemove: (card: Card) => void;
  onSource: (id: string) => void;
}) {
  function menu() {
    const unavailable =
      actions.disabled || card.archived || !card.adopted_asset_id;
    return (
      <BoardMenu
        label={`${card.title} 操作`}
        items={[
          {
            label: "用于当前镜头",
            disabled: unavailable || !actions.canUse,
            onSelect: () => actions.onUse(card),
          },
          {
            label: "添加到画布",
            disabled: unavailable,
            onSelect: () => actions.onCanvas(card),
          },
          { label: "查看设定卡", onSelect: () => actions.onView(card) },
          ...actions.sources
            .filter(
              (node) =>
                node.kind === "image" && node.design_card_id === card.id,
            )
            .map((node) => ({
              label: `来源：${node.title}`,
              onSelect: () => actions.onSource(node.id),
            })),
          {
            label: "从项目移除",
            disabled: actions.disabled,
            onSelect: () => actions.onRemove(card),
          },
        ]}
      />
    );
  }
  const trigger = (
    <button
      type="button"
      className="board-design-card-open"
      aria-label={`查看设定卡 ${card.title}`}
      onClick={() => actions.onView(card)}
    >
      <span className="board-design-card-thumb">
        {card.adopted_asset_id ? (
          <ImagePreview
            src={`/v1/files/${card.adopted_asset_id}/thumbnail`}
            size={320}
            interactive={false}
          />
        ) : (
          <ImageIcon size={16} aria-hidden />
        )}
      </span>
      <span className="board-design-card-name">
        <span className="board-design-card-title">
          <strong title={label.variant ? undefined : label.name}>
            {label.name}
          </strong>
          {label.variant && (
            <span className="board-design-card-variant">{label.variant}</span>
          )}
        </span>
        {(card.archived || !card.adopted_asset_id) && (
          <small>{card.archived ? "已归档" : "待选采用图"}</small>
        )}
      </span>
    </button>
  );
  return (
    <div className="board-design-card">
      {label.variant ? (
        <Tooltip.Provider delayDuration={350}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>{trigger}</Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="board-design-card-tooltip"
                side="right"
                sideOffset={6}
              >
                {label.name} · {label.variant}
                <Tooltip.Arrow />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      ) : (
        trigger
      )}
      {menu()}
    </div>
  );
}
