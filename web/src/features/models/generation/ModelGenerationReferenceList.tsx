import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { FileAudio2, FileImage, FileVideo2, X } from "lucide-react";
import { formatBytes, type LocalReference } from "./modelGenerationOptions";

export function ModelGenerationReferenceList({
  files,
  onRemove,
}: {
  files: LocalReference[];
  onRemove: (id: string) => void;
}) {
  if (!files.length) return null;
  return (
    <div className="generation-reference-list">
      {files.map((item) => (
        <div className="generation-reference-item" key={item.id}>
          <div className={`generation-reference-preview ${item.kind}`}>
            {item.kind === "image" ? (
              <ResponsiveImage src={item.previewUrl} alt="" />
            ) : null}
            {item.kind === "video" ? (
              <video src={item.previewUrl} muted preload="metadata" />
            ) : null}
            {item.kind === "audio" ? <FileAudio2 aria-hidden /> : null}
          </div>
          <span>
            <strong>{item.file.name}</strong>
            <small>
              {item.kind === "image" ? (
                <FileImage aria-hidden />
              ) : item.kind === "video" ? (
                <FileVideo2 aria-hidden />
              ) : (
                <FileAudio2 aria-hidden />
              )}
              {item.kind === "image"
                ? "图片"
                : item.kind === "video"
                  ? "视频"
                  : "音频"}
              · {formatBytes(item.file.size)}
            </small>
          </span>
          <button
            type="button"
            aria-label={`移除参考素材 ${item.file.name}`}
            onClick={() => onRemove(item.id)}
          >
            <X aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
