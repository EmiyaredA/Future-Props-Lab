import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { PetPreviewDelivery, PetPreviewDraft } from "@platform/petPreview";
import { getDocument, type PetDocument } from "./api";
import { expressionSupported } from "./playback";
import { sequenceDemoUnavailable } from "./locomotion/motionAvailability";

export function validatePreview(
  document: PetDocument,
  draft: PetPreviewDraft,
): PetDocument {
  if (document.revision !== draft.baseRevision)
    throw new Error("项目版本已变化，请重新加载编辑器后联动");
  if (draft.motionDemo && document.sourceType !== "coopanion-whale")
    throw new Error("当前角色不支持桌面运动姿态");
  if (draft.motionDemo) {
    const unavailable = sequenceDemoUnavailable(
      document.whaleModel,
      draft.motionDemo,
    );
    if (unavailable) throw new Error(unavailable);
  }
  const config = { ...document.config, ...draft.config };
  const schemes = (document.whaleModel?.schemes ?? []) as { id: string }[];
  if (document.sourceType === "coopanion-whale") {
    if (
      draft.skinId !== null &&
      !schemes.some((scheme) => scheme.id === draft.skinId)
    )
      throw new Error("预览配色不存在");
    if (
      config.schemeId &&
      !schemes.some((scheme) => scheme.id === config.schemeId)
    )
      throw new Error("预览默认配色不存在");
  } else if (
    draft.skinId !== null &&
    !config.skins?.some((skin) => skin.id === draft.skinId)
  )
    throw new Error("预览皮肤不存在");
  const sources = new Set(
    document.character?.parts?.map((part) => part.assetId) ?? [],
  );
  for (const skin of config.skins ?? [])
    for (const [source, target] of Object.entries(skin.replacements ?? {})) {
      if (!sources.has(source) || !Object.hasOwn(document.assetUrls, target))
        throw new Error("预览贴图不属于当前项目");
    }
  for (const reaction of Object.values(config.events ?? {})) {
    if (document.sourceType === "live2d") {
      if (
        reaction.motionId &&
        !document.character?.motions?.some(
          (motion) => motion.id === reaction.motionId,
        )
      )
        throw new Error("预览动作不存在");
      if (
        reaction.expressionId &&
        !document.character?.expressions?.some(
          (expression) => expression.id === reaction.expressionId,
        )
      )
        throw new Error("预览表情不存在");
    } else {
      if (
        reaction.motionId &&
        ![
          "stand",
          "jump",
          "hop",
          "look",
          "turn",
          "nod",
          "shake",
          "spin",
          "sit",
          "sleep",
          "dizzy",
          "walk",
          "run",
        ].includes(reaction.motionId)
      )
        throw new Error("预览动作不存在");
      if (
        reaction.expressionId &&
        (![
          "neutral",
          "happy",
          "wink",
          "love",
          "shy",
          "surprised",
          "angry",
          "sad",
          "sleepy",
          "thinking",
        ].includes(reaction.expressionId) ||
          !expressionSupported(document, reaction.expressionId))
      )
        throw new Error("当前角色不支持该预览表情");
    }
  }
  return { ...document, config };
}

export function usePetPreview(
  projectId: string,
  setBaseline: Dispatch<SetStateAction<PetDocument | null>>,
) {
  const [linked, setLinked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [display, setDisplay] = useState<{
    document: PetDocument;
    draft: PetPreviewDraft;
  } | null>(null);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  useEffect(() => {
    let alive = true;
    const initialEpoch = epoch.current;
    const receive = async (delivery: PetPreviewDelivery) => {
      const request = ++epoch.current;
      setLinked(Boolean(delivery));
      setPaused(delivery?.paused ?? false);
      if (!delivery) setDisplay(null);
      try {
        const baseline = await getDocument(projectId);
        if (!alive || request !== epoch.current) return;
        setBaseline(baseline);
        if (!delivery) {
          setError("");
          return;
        }
        if (delivery.draft.projectId !== projectId)
          throw new Error("预览项目不匹配");
        const document = validatePreview(baseline, delivery.draft);
        setDisplay({ document, draft: delivery.draft });
        setError("");
      } catch (cause) {
        if (!alive || request !== epoch.current) return;
        const message =
          cause instanceof Error ? cause.message : "无法校验预览配置";
        setDisplay(null);
        setError(message);
        if (delivery)
          void window.futurePropsDesktop
            ?.reportPetPreview?.({
              sessionId: delivery.draft.sessionId,
              sequence: delivery.draft.sequence,
              state: "error",
              message,
            })
            .catch(() => undefined);
      }
    };
    const off = window.futurePropsDesktop?.onPetPreview?.((value) => {
      void receive(value);
    });
    if (off)
      void window.futurePropsDesktop
        ?.currentPetPreview?.()
        .then((value) => {
          if (alive && epoch.current === initialEpoch && value)
            void receive(value);
        })
        .catch(() => undefined);
    // A new generation invalidates pending fetches on cleanup; no late draft can revive a lease.
    return () => {
      alive = false;
      epoch.current += 1;
      off?.();
    };
  }, [projectId, setBaseline]);
  return { linked, paused, display: paused ? null : display, error };
}
