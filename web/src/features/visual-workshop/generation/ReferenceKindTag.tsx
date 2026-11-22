import { useQuery } from "@tanstack/react-query";
import { projectCardsKey, listProjectCards } from "../creative/api";
import "./reference-kind-tag.css";
import { referenceContentCardIds } from "./referenceContentLinks";
/** Explicit associations win; verified file equivalents may recover imported links. */
export function ReferenceKindTag({
  assetId,
  projectId,
  cardIds,
}: {
  assetId: string;
  projectId?: string;
  cardIds?: string[];
}) {
  const cards = useQuery({
    queryKey: projectCardsKey(projectId ?? ""),
    queryFn: ({ signal }) => listProjectCards(projectId!, signal),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
  const ids = cardIds ?? [];
  const explicit = ids.length > 0;
  const exactMatches =
    cards.data?.filter(
      (card) =>
        !card.archived &&
        (explicit ? ids.includes(card.id) : card.adopted_asset_id === assetId),
    ) ?? [];
  const contentLinks = useQuery({
    queryKey: ["reference-content-card-links", assetId],
    queryFn: () => referenceContentCardIds(assetId),
    enabled: cards.isSuccess && !explicit && exactMatches.length === 0,
    staleTime: 30_000,
    retry: false,
  });
  const matches =
    exactMatches.length || explicit
      ? exactMatches
      : (cards.data?.filter(
          (card) => !card.archived && contentLinks.data?.includes(card.id),
        ) ?? []);
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
