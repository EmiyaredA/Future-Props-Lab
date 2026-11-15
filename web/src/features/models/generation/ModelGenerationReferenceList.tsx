import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import {
  ArrowDown,
  ArrowUp,
  FileAudio2,
  FileImage,
  FileVideo2,
  X,
} from "lucide-react";
import { formatBytes, type LocalReference } from "./modelGenerationOptions";

export function ModelGenerationReferenceList({
  files,
  onRemove,
  onMoveImage,
}: {
  files: LocalReference[];
  onRemove: (id: string) => void;
  onMoveImage?: (id: string, direction: -1 | 1) => void;
}) {
  if (!files.length) return null;
  const imageIds = files
    .filter((item) => item.kind === "image")
    .map((item) => item.id);
  return (
    <div className="generation-reference-list">
      {files.map((item) => {
        const imagePosition =
          onMoveImage && item.kind === "image" ? imageIds.indexOf(item.id) : -1;
        return (
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
                  ? imagePosition < 0
                    ? "图片"
                    : `图 ${imagePosition + 1}`
                  : item.kind === "video"
                    ? "视频"
                    : "音频"}
                · {formatBytes(item.file.size)}
              </small>
            </span>
            <div className="generation-reference-actions">
              {onMoveImage && imagePosition >= 0 && (
                <>
                  <button
                    type="button"
                    aria-label={`前移 ${item.file.name}`}
                    disabled={imagePosition === 0}
                    onClick={() => onMoveImage(item.id, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`后移 ${item.file.name}`}
                    disabled={imagePosition === imageIds.length - 1}
                    onClick={() => onMoveImage(item.id, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label={`移除参考素材 ${item.file.name}`}
                onClick={() => onRemove(item.id)}
              >
                <X aria-hidden />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
