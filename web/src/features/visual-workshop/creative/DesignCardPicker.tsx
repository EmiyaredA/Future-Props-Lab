import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiErrorMessage } from "@platform/api/errors";
import {
  SearchablePickerDialog,
  type PickerItem,
} from "@shared/ui/SearchablePickerDialog";
import {
  cardsKey,
  listCards,
  projectCardsKey,
  listProjectCards,
  type Card,
  type CardKind,
} from "./api";
import { cardKindInfo, cardKinds } from "./cardKinds";
import { cardRoot, groupCards } from "./cardFamilies";

export function DesignCardPicker({
  title,
  onClose,
  onChoose,
  confirmLabel,
  max,
  needsImage,
  exclude = [],
  excludedLabel,
  kind,
  projectId,
}: {
  title: string;
  onClose: () => void;
  onChoose: (cards: Card[]) => void | Promise<void>;
  confirmLabel?: string;
  max?: number;
  needsImage?: boolean;
  exclude?: string[];
  excludedLabel?: string;
  kind?: CardKind;
  projectId?: string;
}) {
  const [category, setCategory] = useState<CardKind | undefined>(kind);
  const query = useQuery({
    queryKey: projectId ? projectCardsKey(projectId) : cardsKey,
    queryFn: ({ signal }) =>
      projectId ? listProjectCards(projectId, signal) : listCards(signal),
    refetchOnMount: "always",
  });
  const byId = new Map((query.data ?? []).map((card) => [card.id, card]));
  const available = (query.data ?? []).filter(
    (card) =>
      !card.archived &&
      (!needsImage || card.adopted_asset_id) &&
      (excludedLabel || !exclude.includes(card.id)) &&
      (!kind || card.kind === kind),
  );
  const items = groupCards(query.data ?? [], available, true)
    .flatMap(({ items }) => items)
    .filter((card) => !category || card.kind === category)
    .map((card): PickerItem => ({
      id: card.id,
      label: card.title,
      detail: [
        cardKindInfo[card.kind].label,
        card.parent_id && "变体",
        card.parent_id && `所属：${cardRoot(card, byId).title}`,
        exclude.includes(card.id) && excludedLabel,
        !card.adopted_asset_id && "待选采用图",
      ]
        .filter(Boolean)
        .join(" · "),
      keywords: `${card.design ?? ""}\n${cardRoot(card, byId).title}`,
      disabled: exclude.includes(card.id),
      icon: "image",
      preview: card.adopted_asset_id
        ? `/v1/files/${card.adopted_asset_id}/thumbnail`
        : undefined,
    }));
  const choose = (selection: PickerItem[]) =>
    onChoose(
      selection.map((item) => {
        const card = available.find(({ id }) => id === item.id);
        if (!card || exclude.includes(card.id))
          throw new Error("所选设定卡已不可用");
        return card;
      }),
    );
  return (
    <SearchablePickerDialog
      gallery
      title={title}
      items={items}
      searchLabel="搜索角色、场景、道具"
      loading={query.isPending}
      error={query.isError ? apiErrorMessage(query.error) : undefined}
      toolbar={
        kind ? undefined : (
          <div
            className="board-tabs design-picker-tabs"
            aria-label="设定卡类型"
          >
            <button
              type="button"
              aria-pressed={!category}
              className={!category ? "active" : ""}
              onClick={() => setCategory(undefined)}
            >
              全部
            </button>
            {cardKinds.map((key) => (
              <button
                type="button"
                key={key}
                aria-pressed={category === key}
                className={category === key ? "active" : ""}
                onClick={() => setCategory(key)}
              >
                {cardKindInfo[key].label}
              </button>
            ))}
          </div>
        )
      }
      onClose={onClose}
      onChoose={(item) => (item && choose([item])) || undefined}
      multi={confirmLabel ? { confirmLabel, max, onChoose: choose } : undefined}
    />
  );
}
