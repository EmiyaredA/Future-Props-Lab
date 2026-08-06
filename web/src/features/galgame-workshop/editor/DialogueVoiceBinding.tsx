import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  FolderOpen,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import {
  uploadGalgameProjectAsset,
  type GalgameStoryAudioAsset,
  type GalgameStoryBlock,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { stableId, updateBlock } from "@features/galgame-workshop/editor/model";
import {
  StoryAudioPicker,
  type StoryAudioPickerSource,
} from "@features/galgame-workshop/editor/StoryAudioPicker";
import { StoryAudioPreview } from "@features/galgame-workshop/editor/StoryAudioPreview";

function displayLabel(filename: string) {
  return filename.replace(/\.[^.]+$/, "").trim() || "对白配音";
}

export function DialogueVoiceBinding({
  projectId,
  document,
  fragmentId,
  block,
  stale,
  onDocument,
  onFresh,
  onNotice,
}: {
  projectId: string;
  document: GalgameStoryProject;
  fragmentId: string;
  block: Extract<GalgameStoryBlock, { type: "dialogue" }>;
  stale: boolean;
  onDocument: (document: GalgameStoryProject) => void;
  onFresh: () => void;
  onNotice: (message: string) => void;
}) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [source, setSource] = useState<StoryAudioPickerSource>("project");
  const voiceAsset = (document.assets ?? []).find(
    (asset): asset is GalgameStoryAudioAsset =>
      asset.type === "audio" && asset.id === block.voiceAssetId,
  );
  const usedFileIds = new Set(
    (document.assets ?? []).map((asset) => asset.fileId),
  );

  const patchBlock = (
    updater: (
      current: Extract<GalgameStoryBlock, { type: "dialogue" }>,
    ) => Extract<GalgameStoryBlock, { type: "dialogue" }>,
  ) =>
    onDocument(
      updateBlock(document, fragmentId, block.id, (current) =>
        current.type === "dialogue" ? updater(current) : current,
      ),
    );

  const bindFile = (fileId: string, name: string) => {
    let asset = (document.assets ?? []).find(
      (candidate): candidate is GalgameStoryAudioAsset =>
        candidate.type === "audio" &&
        candidate.role === "voiceLine" &&
        candidate.fileId === fileId,
    );
    let next = document;
    if (!asset) {
      asset = {
        id: stableId(),
        type: "audio",
        role: "voiceLine",
        label: displayLabel(name),
        fileId,
        status: "ready",
      };
      next = { ...document, assets: [...(document.assets ?? []), asset] };
    }
    onDocument(
      updateBlock(next, fragmentId, block.id, (current) =>
        current.type === "dialogue"
          ? { ...current, voiceAssetId: asset?.id ?? null, voiceVolume: 100 }
          : current,
      ),
    );
    onFresh();
    setPickerOpen(false);
  };

  const upload = useMutation({
    mutationFn: (file: File) => uploadGalgameProjectAsset(projectId, file),
    onSuccess: (asset) => {
      void client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      });
      bindFile(asset.id, asset.display_name);
    },
    onError: (caught) =>
      onNotice(caught instanceof Error ? caught.message : "对白配音上传失败"),
  });

  return (
    <section className="galgame-dialogue-voice-binding">
      <header>
        <span>
          <Volume2 aria-hidden />
          <strong>对白配音</strong>
        </span>
        <em>{voiceAsset ? "已绑定" : "未绑定"}</em>
      </header>
      {voiceAsset ? (
        <>
          <StoryAudioPreview
            fileId={voiceAsset.fileId}
            label={voiceAsset.label}
            compact
          />
          <label className="galgame-audio-range">
            <span>
              对白音量 <em>{block.voiceVolume}%</em>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              value={block.voiceVolume ?? 100}
              onChange={(event) =>
                patchBlock((current) => ({
                  ...current,
                  voiceVolume: Number(event.target.value),
                }))
              }
            />
          </label>
          {stale ? (
            <p className="galgame-voice-stale">
              <AlertTriangle aria-hidden />{" "}
              配音可能已过期：对白文字在绑定后发生了变化。
            </p>
          ) : null}
        </>
      ) : (
        <p className="galgame-dialogue-voice-empty">为这句对白选择一条配音。</p>
      )}
      <div>
        <button
          type="button"
          onClick={() => {
            setSource("library");
            setPickerOpen(true);
          }}
        >
          <FolderOpen aria-hidden /> 从声音库选择
        </button>
        <button type="button" onClick={() => fileInput.current?.click()}>
          <Upload aria-hidden /> 上传配音
        </button>
        {voiceAsset ? (
          <button
            type="button"
            className="danger"
            aria-label="移除对白配音"
            onClick={() => {
              patchBlock((current) => ({ ...current, voiceAssetId: null }));
              onFresh();
            }}
          >
            <Trash2 aria-hidden />
          </button>
        ) : null}
      </div>
      <input
        ref={fileInput}
        hidden
        type="file"
        accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) upload.mutate(file);
        }}
      />
      {pickerOpen ? (
        <StoryAudioPicker
          projectId={projectId}
          title="选择对白配音"
          source={source}
          usedFileIds={usedFileIds}
          onSource={setSource}
          onChoose={bindFile}
          onUpload={() => fileInput.current?.click()}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </section>
  );
}
