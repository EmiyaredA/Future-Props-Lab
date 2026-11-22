import { useRef, useState } from "react";
import { Music, Upload } from "lucide-react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";

function VoiceAudio({
  assetId,
  title,
  onRetry,
}: {
  assetId: string;
  title: string;
  onRetry: () => void;
}) {
  const media = useApiBlobUrl(`/v1/files/${assetId}/content`);
  const [decodeError, setDecodeError] = useState(false);
  if (media.loading) return <p role="status">正在加载角色语音…</p>;
  if (media.error || decodeError)
    return (
      <div>
        <p role="alert">语音无法读取，请重试或更换音频。</p>
        <button type="button" className="creative-quiet" onClick={onRetry}>
          重试语音
        </button>
      </div>
    );
  return media.url ? (
    <audio
      controls
      preload="metadata"
      src={media.url}
      aria-label={`${title}的角色语音`}
      onError={() => setDecodeError(true)}
    />
  ) : null;
}

export function CardVoice({
  assetId,
  title,
  readOnly,
  busy,
  onChoose,
  onUpload,
  onRemove,
}: {
  assetId?: string | null;
  title: string;
  readOnly: boolean;
  busy: boolean;
  onChoose: () => void;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [attempt, setAttempt] = useState(0);
  return (
    <section className="card-editor-voice" aria-label="角色语音">
      <h4>
        <Music size={16} aria-hidden /> 角色语音
      </h4>
      {assetId && (
        <VoiceAudio
          key={`${assetId}:${attempt}`}
          assetId={assetId}
          title={title}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      )}
      {!assetId && <p>尚未绑定角色语音</p>}
      {!readOnly && (
        <div className="card-editor-voice-actions">
          <button
            type="button"
            className="creative-quiet"
            disabled={busy}
            onClick={onChoose}
          >
            选择角色语音
          </button>
          <button
            type="button"
            className="creative-quiet"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Upload size={14} aria-hidden /> 上传语音
          </button>
          {assetId && (
            <button
              type="button"
              className="creative-quiet"
              disabled={busy}
              onClick={onRemove}
            >
              解除语音绑定
            </button>
          )}
          <input
            ref={input}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
            hidden
            aria-label="上传角色语音"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onUpload(file);
            }}
          />
        </div>
      )}
    </section>
  );
}
