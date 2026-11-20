import { useQuery } from "@tanstack/react-query";
import { apiErrorMessage } from "@platform/api/errors";
import { SearchablePickerDialog } from "@shared/ui/SearchablePickerDialog";
import { cardsKey, listCards } from "./api";
import { cardKindInfo } from "./cardKinds";
import { placeCardImage } from "./cardMedia";

export function CardReferencePicker({
  project,
  onClose,
  onChoose,
}: {
  project: string;
  onClose: () => void;
  onChoose: (asset: string) => void;
}) {
  const query = useQuery({
    queryKey: cardsKey,
    queryFn: ({ signal }) => listCards(signal),
  });
  const cards =
    query.data?.filter((card) => card.adopted_asset_id && !card.archived) ?? [];
  return (
    <SearchablePickerDialog
      title="引用设定卡"
      searchLabel="搜索设定卡"
      items={cards.map((card) => ({
        id: card.id,
        label: card.title,
        detail: cardKindInfo[card.kind].label,
        keywords: card.design,
        preview: `/v1/files/${card.adopted_asset_id}/thumbnail`,
      }))}
      loading={query.isPending}
      error={query.isError ? apiErrorMessage(query.error) : undefined}
      onClose={onClose}
      onChoose={async (item) => {
        const card = cards.find(({ id }) => id === item?.id);
        const asset = card?.adopted_asset_id;
        if (!asset) throw new Error("此设定卡的采用图已不可用。");
        onChoose(
          await placeCardImage(project, asset, card.media_projects?.[asset]),
        );
      }}
    />
  );
}
