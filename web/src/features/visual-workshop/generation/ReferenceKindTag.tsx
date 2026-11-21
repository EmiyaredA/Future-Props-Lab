import { useQuery } from "@tanstack/react-query";
import { cardsKey, listCards } from "../creative/api";
import "./reference-kind-tag.css";
/** Card identity wins; adopted media is only used when its kind is unambiguous. */
export function ReferenceKindTag({
  assetId,
  cardId,
}: {
  assetId: string;
  cardId?: string;
}) {
  const cards = useQuery({
    queryKey: cardsKey,
    queryFn: ({ signal }) => listCards(signal),
    staleTime: 30_000,
  });
  const matches =
    cards.data?.filter((card) =>
      cardId ? card.id === cardId : card.adopted_asset_id === assetId,
    ) ?? [];
  const kinds = new Set(matches.map((card) => card.kind));
  if (kinds.size !== 1) return null;
  const kind = matches[0].kind;
  return (
    <span className={`reference-kind-tag is-${kind}`}>
      {{ character: "角色", scene: "场景", prop: "道具" }[kind]}
    </span>
  );
}
