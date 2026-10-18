import { useEffect, useRef } from "react";
import type { Catalog } from "@features/models/api";
import { modelTestMode } from "@features/models/catalog/catalogPresentation";
import type { ModelTestMode } from "@features/models/workspace/ModelTestWorkspaceHeader";

export function availableCatalogModels(catalog?: Catalog) {
  return (catalog?.providers ?? []).flatMap((provider) =>
    provider.enabled
      ? provider.models
          .filter((model) => model.enabled)
          .map((model) => ({
            value: model.id,
            label: model.label || model.slug,
            description: `${provider.name} · ${model.slug}`,
            capabilities: Array.from(
              new Set([...model.capabilities, ...model.categories]),
            ),
            providerKind: provider.kind,
          }))
      : [],
  );
}

export function preferredChatModel(
  catalog: (Catalog & { default_model_ids?: { chat?: string } }) | undefined,
  models: { value: string }[],
) {
  const preferred = catalog?.default_model_ids?.chat;
  return (
    models.find((model) => model.value === preferred)?.value ?? models[0]?.value
  );
}

export function preferredModeModel(
  models: ReturnType<typeof availableCatalogModels>,
  mode: Exclude<ModelTestMode, "chat">,
  remembered: string | undefined,
  defaults?: Partial<Record<string, string>>,
) {
  const capabilities = {
    image: "image_generation",
    video: "video_generation",
    speech: "speech_recognition",
    realtime_voice: "voice",
  };
  const candidates = models.filter((model) => {
    if (mode === "speech")
      return (
        ["openai", "senseaudio_asr", "senseaudio_asr_pro"].includes(
          model.providerKind,
        ) && model.capabilities.includes("speech_recognition")
      );
    if (mode === "realtime_voice")
      return (
        model.providerKind === "senseaudio_realtime" &&
        model.capabilities.includes("voice")
      );
    return (
      mode === "image"
        ? ["senseaudio_image", "volcengine_image"]
        : ["senseaudio_video", "zealman_video", "volcengine_video"]
    ).includes(model.providerKind);
  });
  return (
    candidates.find((model) => model.value === remembered) ??
    candidates.find(
      (model) => model.value === defaults?.[capabilities[mode]],
    ) ??
    candidates[0]
  );
}

export function useInitialCatalogModel({
  modelId,
  catalog,
  onChat,
  onOther,
  onError,
  onHandled,
}: {
  modelId?: string | null;
  catalog?: Catalog;
  onChat: (id: string) => void;
  onOther: (id: string) => void;
  onError: (message: string) => void;
  onHandled?: () => void;
}) {
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!modelId || !catalog || handled.current === modelId) return;
    handled.current = modelId;
    const provider = catalog.providers.find((p) =>
      p.models.some((m) => m.id === modelId),
    );
    const model = provider?.models.find((m) => m.id === modelId);
    if (!provider || !model || !provider.enabled || !model.enabled)
      onError("所选模型已停用或不存在，请重新选择模型。");
    else {
      const mode = modelTestMode(model, provider);
      if (mode === "chat") onChat(modelId);
      else if (mode) onOther(modelId);
      else onError("所选模型暂不支持在此测试。");
    }
    onHandled?.();
  }, [modelId, catalog, onChat, onOther, onError, onHandled]);
}
