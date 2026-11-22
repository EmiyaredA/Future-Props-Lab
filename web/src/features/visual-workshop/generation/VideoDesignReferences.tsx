import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Plus, X } from "lucide-react";
import { apiErrorMessage } from "@platform/api/errors";
import { ImagePreview } from "@shared/ui/ImagePreview";
import { resolveDesignImage } from "../creative/cardMedia";
import { projectCardsKey, listProjectCards, type Card } from "../creative/api";
import { DesignCardPicker } from "../creative/DesignCardPicker";
import type { useGenerationDrawerController } from "./useGenerationDrawerController";

export function VideoDesignReferences({
  controller,
  children,
}: {
  controller: ReturnType<typeof useGenerationDrawerController>;
  children?: (controls: {
    open: () => void;
    details: (assetId: string) => ReactNode;
  }) => ReactNode;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const processing =
    useRef<typeof controller.designReferenceRequest>(undefined);
  const request = controller.designReferenceRequest;
  const {
    designReferences,
    references,
    linkedAssetIds,
    projectId,
    referenceLimits,
    videoCapabilities,
    persistDraft,
    setReferences,
    setVideoMode,
  } = controller;
  const supported =
    !videoCapabilities?.supported_modes?.length ||
    videoCapabilities.supported_modes.includes("reference");
  const available = Math.max(
    0,
    referenceLimits.image -
      new Set([...references, ...linkedAssetIds.image]).size,
  );
  const cards = useQuery({
    queryKey: projectCardsKey(projectId),
    queryFn: ({ signal }) => listProjectCards(projectId, signal),
    enabled: designReferences.length > 0,
  });

  const add = useCallback(
    async (chosen: Card[], replace?: string) => {
      if (!supported) throw new Error("当前模型不支持全能参考");
      const projectCards = await client.fetchQuery({
        queryKey: projectCardsKey(projectId),
        queryFn: ({ signal }) => listProjectCards(projectId, signal),
        staleTime: 0,
      });
      if (
        chosen.some(
          (card) =>
            !projectCards.some((item) => item.id === card.id && !item.archived),
        )
      )
        throw new Error("请先将设定卡收录到当前项目");
      const selected = chosen.filter(
        (card) =>
          !designReferences.some(
            (entry) =>
              entry.card_id === card.id &&
              (!replace || entry.card_revision === card.revision),
          ),
      );
      if (!selected.length) return;
      if (selected.length > available + Number(Boolean(replace))) {
        throw new Error(`当前最多还可添加 ${available} 张参考图`);
      }
      const next: typeof designReferences = [];
      for (const card of selected) {
        const assetId = await resolveDesignImage(client, projectId, card);
        next.push({
          asset_id: assetId,
          card_id: card.id,
          card_revision: card.revision,
          title: card.title,
        });
      }
      const ids = [
        ...new Set([
          ...references.map((id) => (id === replace ? next[0].asset_id : id)),
          ...next.map(({ asset_id }) => asset_id),
        ]),
      ];
      setReferences(ids);
      setVideoMode("reference");
      persistDraft(
        {
          ...(replace
            ? {
                reference_order: controller.referenceOrder.map((key) =>
                  key === `asset:${replace}`
                    ? `asset:${next[0].asset_id}`
                    : key,
                ),
              }
            : {}),
          ...(replace && controller.referenceSubjects
            ? {
                reference_subjects: Object.fromEntries(
                  Object.entries(controller.referenceSubjects).map(
                    ([key, value]) => [
                      key === `asset:${replace}`
                        ? `asset:${next[0].asset_id}`
                        : key,
                      value,
                    ],
                  ),
                ),
              }
            : {}),
          mode: "reference",
          reference_asset_ids: ids,
          design_references: [
            ...designReferences.filter(
              (entry) =>
                entry.asset_id !== replace &&
                !next.some(({ asset_id }) => asset_id === entry.asset_id),
            ),
            ...next.filter(
              (entry, index) =>
                next.findIndex(
                  ({ asset_id }) => asset_id === entry.asset_id,
                ) === index,
            ),
          ],
        },
        true,
      );
    },
    [
      available,
      client,
      designReferences,
      persistDraft,
      projectId,
      references,
      setReferences,
      setVideoMode,
      supported,
      controller.referenceSubjects,
      controller.referenceOrder,
    ],
  );

  const run = useCallback(
    async (chosen: Card[], replacement?: string) => {
      setError("");
      setPending(true);
      try {
        await add(chosen, replacement);
      } catch (failure) {
        setError(apiErrorMessage(failure));
      } finally {
        setPending(false);
      }
    },
    [add],
  );

  useEffect(() => {
    if (
      !request ||
      controller.options.isPending ||
      processing.current?.card === request.card ||
      pending
    )
      return;
    processing.current = request;
    void run([request.card]).finally(() => {
      processing.current = undefined;
      request.handled();
    });
  }, [controller.options.isPending, pending, request, run]);

  if (
    !children &&
    controller.videoMode !== "reference" &&
    !error &&
    !pending &&
    !request
  )
    return null;
  return (
    <section
      className={children ? "video-design-inline" : "video-design-references"}
      aria-label="设定参考"
    >
      {children ? (
        children({
          open: () => setOpen(true),
          details: (assetId) => {
            const reference = designReferences.find(
              (item) => item.asset_id === assetId,
            );
            const latest = cards.data?.find(
              (card) => card.id === reference?.card_id,
            );
            return (
              reference && (
                <>
                  <small>
                    设定卡：{reference.title} · r{reference.card_revision}
                  </small>
                  {latest &&
                    !latest.archived &&
                    latest.adopted_asset_id &&
                    latest.revision !== reference.card_revision && (
                      <Menu.Item asChild>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => void run([latest], assetId)}
                        >
                          更新采用图
                        </button>
                      </Menu.Item>
                    )}
                </>
              )
            );
          },
        })
      ) : (
        <>
          <div>
            <strong>设定参考</strong>
            <button
              type="button"
              disabled={!available || pending || !supported}
              onClick={() => setOpen(true)}
            >
              <Plus size={14} aria-hidden /> 添加设定参考
            </button>
          </div>
          {designReferences.length > 0 && (
            <ul>
              {designReferences.map((reference) => {
                const latest = cards.data?.find(
                  (card) => card.id === reference.card_id,
                );
                return (
                  <li key={reference.asset_id}>
                    <ImagePreview
                      src={`/v1/files/${reference.asset_id}/thumbnail`}
                      size={128}
                      interactive={false}
                    />
                    <span>{reference.title}</span>
                    {latest &&
                      !latest.archived &&
                      latest.adopted_asset_id &&
                      latest.revision !== reference.card_revision && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => void run([latest], reference.asset_id)}
                        >
                          更新采用图
                        </button>
                      )}
                    <button
                      type="button"
                      aria-label={`移除设定参考 ${reference.title}`}
                      disabled={pending}
                      onClick={() => {
                        const ids = references.filter(
                          (id) => id !== reference.asset_id,
                        );
                        setReferences(ids);
                        persistDraft({ reference_asset_ids: ids }, true);
                      }}
                    >
                      <X size={13} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {pending && <small role="status">正在加入设定参考…</small>}
      {error && <small role="alert">{error}</small>}
      {open && (
        <DesignCardPicker
          projectId={projectId}
          title="添加设定参考"
          needsImage
          max={available}
          exclude={designReferences.map(({ card_id }) => card_id)}
          confirmLabel="添加到当前镜头"
          onClose={() => setOpen(false)}
          onChoose={add}
        />
      )}
    </section>
  );
}
