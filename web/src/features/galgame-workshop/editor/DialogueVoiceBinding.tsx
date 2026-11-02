import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Mic, Sparkles, Trash2, Upload } from "lucide-react";
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
import { invalidateGalgameAssetQueries } from "@features/galgame-workshop/queryKeys";

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
  onAutoMatchVoice,
}: {
  projectId: string;
  document: GalgameStoryProject;
  fragmentId: string;
  block: Extract<GalgameStoryBlock, { type: "dialogue" }>;
  stale: boolean;
  onDocument: (document: GalgameStoryProject) => void;
  onFresh: () => void;
  onNotice: (message: string) => void;
  onAutoMatchVoice: (blockId: string) => Promise<boolean>;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [matching, setMatching] = useState(false);
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
    mutationFn: (file: File) =>
      runTransfer((onProgress) =>
        uploadGalgameProjectAsset(projectId, file, undefined, { onProgress }),
      ),
    onSuccess: (asset) => {
      void invalidateGalgameAssetQueries(client, projectId);
      bindFile(asset.id, asset.display_name);
    },
    onError: (caught) =>
      onNotice(caught instanceof Error ? caught.message : "对白配音上传失败"),
  });

  return (
    <section className="galgame-dialogue-voice-binding">
      <TransferFeedback progress={activeTransferProgress} />

      <header>
        <strong>语音</strong>
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
        <p className="galgame-dialogue-voice-empty">（未选择语音）</p>
      )}
      <div className="galgame-dialogue-voice-actions">
        <button
          type="button"
          disabled={matching}
          onClick={async () => {
            setMatching(true);
            try {
              if (await onAutoMatchVoice(block.id)) onFresh();
            } finally {
              setMatching(false);
            }
          }}
        >
          <Sparkles aria-hidden /> {matching ? "正在匹配…" : "自动匹配"}
        </button>
        <button
          type="button"
          onClick={() => {
            setSource("project");
            setPickerOpen(true);
          }}
        >
          <Mic aria-hidden /> 手动选择…
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
      <details className="galgame-dialogue-voice-more">
        <summary>更多语音设置</summary>
        <button type="button" onClick={() => fileInput.current?.click()}>
          <Upload aria-hidden /> 上传配音
        </button>
      </details>
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
