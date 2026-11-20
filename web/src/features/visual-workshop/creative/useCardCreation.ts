import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@platform/api/errors";
import { cardsKey, createCard, type Card, type CardKind } from "./api";

export function useCardCreation(
  kind: CardKind,
  label: string,
  onOpen: (id: string) => void,
  onCreated?: (card: Card) => Promise<void>,
) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unlinked, setUnlinked] = useState<Card>();
  async function attach(card: Card) {
    try {
      await onCreated?.(card);
      setUnlinked(undefined);
    } catch (failure) {
      setUnlinked(card);
      setError(`设定卡已创建，添加到项目失败：${apiErrorMessage(failure)}`);
    }
  }
  return {
    busy,
    error,
    canRetry: Boolean(unlinked),
    async add(parent?: Card) {
      if (busy) return;
      setBusy(true);
      setError("");
      try {
        const next = await createCard(undefined, {
          kind: parent?.kind ?? kind,
          title: parent
            ? `${parent.title.slice(0, 110)} · 变体`
            : `新建${label}`,
          facts: parent?.facts,
          source: parent?.source,
          parent_id: parent?.id,
          parent_asset_id: parent?.adopted_asset_id,
        });
        client.setQueryData<Card[]>(cardsKey, (old) => [...(old ?? []), next]);
        onOpen(next.id);
        await attach(next);
      } catch (failure) {
        setError(apiErrorMessage(failure));
      } finally {
        setBusy(false);
      }
    },
    async retry() {
      if (!unlinked || busy) return;
      setBusy(true);
      setError("");
      try {
        await attach(unlinked);
      } finally {
        setBusy(false);
      }
    },
  };
}
