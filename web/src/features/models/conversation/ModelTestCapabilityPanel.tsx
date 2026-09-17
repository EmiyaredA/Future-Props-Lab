import { ModelGenerationTestPanel } from "@features/models/generation/ModelGenerationTestPanel";
import { ModelTranscriptionTestPanel } from "@features/models/generation/ModelTranscriptionTestPanel";
import { ModelRealtimeVoiceTestPanel } from "@features/models/realtime/ModelRealtimeVoiceTestPanel";
import type { ModelTestMode } from "@features/models/workspace/ModelTestWorkspaceHeader";

export type CapabilityTestModel = {
  value: string;
  label: string;
  description: string;
  capabilities: string[];
  providerKind: string;
};

export function ModelTestCapabilityPanel({
  models,
  modelId,
  onSelectMode,
  onSelectModel,
  onOpenAudioAnnotation,
}: {
  models: CapabilityTestModel[];
  modelId: string;
  onSelectMode: (mode: ModelTestMode) => void;
  onSelectModel: (
    modelId: string,
    mode: Exclude<ModelTestMode, "chat">,
  ) => void;
  onOpenAudioAnnotation: (projectId: string) => void;
}) {
  const model = models.find((item) => item.value === modelId);
  if (model?.capabilities.includes("voice")) {
    return (
      <ModelRealtimeVoiceTestPanel
        models={models}
        modelId={modelId}
        onSelectMode={onSelectMode}
        onSelectModel={(id) => onSelectModel(id, "realtime_voice")}
      />
    );
  }
  if (
    model &&
    ["openai", "senseaudio_asr", "senseaudio_asr_pro"].includes(model.providerKind) &&
    model.capabilities.includes("speech_recognition")
  ) {
    return (
      <ModelTranscriptionTestPanel
        models={models}
        modelId={modelId}
        onOpenAudioAnnotation={onOpenAudioAnnotation}
        onSelectMode={onSelectMode}
        onSelectModel={(id) => onSelectModel(id, "speech")}
      />
    );
  }
  if (
    model &&
    ["senseaudio_image", "senseaudio_video"].includes(model.providerKind)
  ) {
    const mode = model.providerKind === "senseaudio_image" ? "image" : "video";
    return (
      <ModelGenerationTestPanel
        models={models}
        modelId={modelId}
        onSelectMode={onSelectMode}
        onSelectModel={(id) => onSelectModel(id, mode)}
      />
    );
  }
  return null;
}
