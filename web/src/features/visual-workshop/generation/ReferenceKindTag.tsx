import { useQuery } from "@tanstack/react-query";
import { cardsKey, listCards } from "../creative/api";
import "./reference-kind-tag.css";
/** Explicit card links win; exact adopted asset IDs are the only fallback. */
export function ReferenceKindTag({
  assetId,
  cardIds,
}: {
  assetId: string;
  cardIds?: string[];
}) {
  const cards = useQuery({
    queryKey: cardsKey,
    queryFn: ({ signal }) => listCards(signal),
    staleTime: 30_000,
  });
  const ids = cardIds ?? [];
  const explicit = ids.length > 0;
  const matches =
    cards.data?.filter((card) =>
      explicit ? ids.includes(card.id) : card.adopted_asset_id === assetId,
    ) ?? [];
  // Missing or conflicting card identities must never turn into a guessed label.
  if (explicit && ids.some((id) => !matches.some((card) => card.id === id)))
    return null;
  const kinds = new Set(matches.map((card) => card.kind));
  if (kinds.size !== 1) return null;
  const kind = matches[0].kind;
  return (
    <span className={`reference-kind-tag is-${kind}`}>
      {{ character: "角色", scene: "场景", prop: "道具" }[kind]}
    </span>
  );
}
