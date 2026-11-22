import { useRef } from "react";
import { Music, Upload } from "lucide-react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";

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
  const media = useApiBlobUrl(assetId ? `/v1/files/${assetId}/content` : null);
  return (
    <section className="card-editor-voice" aria-label="角色语音">
      <h4>
        <Music size={16} aria-hidden /> 角色语音
      </h4>
      {media.loading && <p role="status">正在加载角色语音…</p>}
      {media.error && <p role="alert">语音无法读取，请更换音频或重试。</p>}
      {media.url && (
        <audio
          key={assetId}
          controls
          preload="metadata"
          src={media.url}
          aria-label={`${title}的角色语音`}
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
