import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownAZ, ChevronRight, Plus } from "lucide-react";
import { DesignCardRow } from "./DesignCardRow";
import {
  cardMatches,
  cardRowLabel,
  groupCards,
} from "../creative/cardFamilies";
import { useCardNameSort } from "../creative/useCardNameSort";
import { BoardMenu } from "./BoardMenu";
import type { VisualCanvasNode } from "../api";
import { cardsKey, listCards, type Card, type CardKind } from "../creative/api";
import { cardKindInfo, cardKinds } from "../creative/cardKinds";

const labels = { character: "人设", scene: "场景", prop: "道具" };

export function CommonDesignCards({
  projectId,
  ids,
  search,
  canUse,
  disabled,
  onAdd,
  onCreate,
  onUse,
  onCanvas,
  onView,
  onRemove,
  sources,
  onSource,
}: {
  projectId: string;
  ids: string[];
  search: string;
  canUse: boolean;
  disabled?: boolean;
  onAdd: (kind: CardKind) => void;
  onCreate: (kind: CardKind) => void;
  onUse: (card: Card) => void;
  onCanvas: (card: Card) => void;
  onView: (card: Card) => void;
  onRemove: (card: Card) => void;
  sources: VisualCanvasNode[];
  onSource: (id: string) => void;
}) {
  const sectionId = useId();
  const sorting = useCardNameSort(`project:${projectId}`);
  const [expanded, setExpanded] = useState<Partial<Record<CardKind, boolean>>>(
    {},
  );
  const query = useQuery({
    queryKey: cardsKey,
    queryFn: ({ signal }) => listCards(signal),
  });
  const all = query.data ?? [];
  const term = search.trim().toLocaleLowerCase();
  const byId = new Map(all.map((card) => [card.id, card]));
  const cards = [...new Set(ids)].flatMap((id) =>
    byId.has(id) ? [byId.get(id)!] : [],
  );
  return (
    <div className="board-design-cards" aria-label="项目设定卡">
      {query.isPending && <p role="status">正在读取设定卡…</p>}
      {query.isError && (
        <button type="button" onClick={() => void query.refetch()}>
          读取设定卡失败，重试
        </button>
      )}
      {cardKinds.map((kind) => {
        const entries = cards.filter((card) => card.kind === kind);
        const ordered = sorting.sorted(kind)
          ? groupCards(all, entries, true).flatMap(({ items }) => items)
          : entries;
        const visible = ordered.filter((card) => cardMatches(card, term));
        const open = Boolean(term) || (expanded[kind] ?? entries.length <= 6);
        const { icon: KindIcon } = cardKindInfo[kind];
        return (
          <section key={kind} aria-label={labels[kind]}>
            <div className="board-design-heading">
              <h3>
                <button
                  type="button"
                  className="board-design-toggle"
                  aria-expanded={open}
                  aria-controls={`${sectionId}-${kind}`}
                  onClick={() =>
                    setExpanded((previous) => ({ ...previous, [kind]: !open }))
                  }
                >
                  <ChevronRight
                    className={open ? "is-open" : ""}
                    size={12}
                    aria-hidden
                  />
                  <KindIcon size={15} aria-hidden />
                  {labels[kind]}
                  <small>{entries.length}</small>
                </button>
              </h3>
              <button
                type="button"
                className="board-card-sort"
                aria-label={`${labels[kind]}按名称排序`}
                title="按名称排序"
                aria-pressed={sorting.sorted(kind)}
                disabled={entries.length < 2}
                onClick={() => sorting.sort(kind)}
              >
                <ArrowDownAZ size={15} aria-hidden />
              </button>
              <BoardMenu
                label={`添加${labels[kind]}卡`}
                triggerIcon={<Plus size={15} aria-hidden />}
                items={[
                  {
                    label: `新建${labels[kind]}卡`,
                    disabled,
                    onSelect: () => onCreate(kind),
                  },
                  {
                    label: "从设定库添加",
                    disabled,
                    onSelect: () => onAdd(kind),
                  },
                ]}
              />
            </div>
            <div id={`${sectionId}-${kind}`} hidden={!open}>
              {query.isSuccess && !visible.length && (
                <p className="board-design-empty">
                  {term
                    ? "没有匹配的设定卡"
                    : `暂无${labels[kind]}，点击 + 添加`}
                </p>
              )}
              {visible.map((card) => (
                <DesignCardRow
                  key={card.id}
                  card={card}
                  label={cardRowLabel(card, byId)}
                  canUse={canUse}
                  disabled={disabled}
                  sources={sources}
                  onView={onView}
                  onUse={onUse}
                  onCanvas={onCanvas}
                  onRemove={onRemove}
                  onSource={onSource}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
