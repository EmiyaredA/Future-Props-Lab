import { CustomSelect } from "@shared/ui/CustomSelect";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cardsKey, listCards } from "../creative/api";
import {
  creationLinksKey,
  getCreationLinks,
  saveCreationLinks,
} from "../creative/creationLinks";
import { apiErrorMessage } from "@platform/api/errors";
import type { PrevisScene } from "./api";
export function StageObjectBindings({
  project,
  stage,
  cardIds,
  readOnly,
}: {
  project: string;
  stage: PrevisScene;
  cardIds: string[];
  readOnly: boolean;
}) {
  const client = useQueryClient();
  const links = useQuery({
    queryKey: creationLinksKey(project),
    queryFn: ({ signal }) => getCreationLinks(project, signal),
  });
  const cards = useQuery({
    queryKey: cardsKey,
    queryFn: ({ signal }) => listCards(signal),
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const objects = (stage.document.objects ?? []) as {
    id: string;
    name: string;
  }[];
  const options =
    cards.data?.filter(
      (card) =>
        cardIds.includes(card.id) && !card.archived && card.kind !== "scene",
    ) ?? [];
  return (
    <details className="stage-object-bindings">
      <summary>角色 / 道具与白模对象绑定</summary>
      <p>绑定按对象标识保存；移动或重命名对象后仍会保留。</p>
      {objects.map((object) => (
        <label key={object.id}>
          {object.name}
          <CustomSelect
            ariaLabel={`绑定对象 ${object.name}`}
            disabled={readOnly || busy || !links.data}
            value={
              links.data?.objects?.find(
                (row) =>
                  row.previs_scene_id === stage.id &&
                  row.object_id === object.id,
              )?.card_id ?? ""
            }
            onChange={(id) => {
              if (!links.data) return;
              setBusy(true);
              setError("");
              void saveCreationLinks(project, {
                ...links.data,
                objects: [
                  ...(links.data.objects ?? []).filter(
                    (row) =>
                      row.previs_scene_id !== stage.id ||
                      row.object_id !== object.id,
                  ),
                  ...(id
                    ? [
                        {
                          previs_scene_id: stage.id,
                          object_id: object.id,
                          card_id: id,
                        },
                      ]
                    : []),
                ],
              })
                .then((saved) =>
                  client.setQueryData(creationLinksKey(project), saved),
                )
                .catch((failure) => setError(apiErrorMessage(failure)))
                .finally(() => setBusy(false));
            }}
            options={[
              { value: "", label: "未绑定" },
              ...options.map((card) => ({
                value: card.id,
                label: `${card.kind === "character" ? "人设" : "道具"} · ${card.title}`,
              })),
            ]}
          />
        </label>
      ))}
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => void links.refetch()}>重新读取绑定</button>
        </p>
      )}
    </details>
  );
}
