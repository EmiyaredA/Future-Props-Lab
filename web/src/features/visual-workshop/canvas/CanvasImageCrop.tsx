import { LoadingState } from "@shared/ui/LoadingState";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  uploadManagedFile,
  invalidateFileScope,
  type ManagedFile,
} from "@features/files";
import { useQueryClient } from "@tanstack/react-query";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { fitCrop, pixelCrop, type CropRect } from "./imageCropGeometry";
import { exportImageCrop } from "./imageCropExport";
import { ImageCropSurface } from "./ImageCropSurface";

const RATIOS = [
  { value: "free", label: "自由裁剪" },
  { value: "original", label: "原比例" },
  { value: "1", label: "1:1" },
  { value: "16/9", label: "16:9" },
  { value: "9/16", label: "9:16" },
  { value: "4/3", label: "4:3" },
  { value: "3/4", label: "3:4" },
];

export function CanvasImageCrop({
  projectId,
  assetId,
  title,
  onCancel,
  onSaved,
  onAdd,
}: {
  projectId: string;
  assetId: string;
  title: string;
  onCancel: () => void;
  onSaved: () => void;
  onAdd: (asset: ManagedFile) => Promise<void>;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const { url, error: loadError } = useApiBlobUrl(
    `/v1/files/${encodeURIComponent(assetId)}/content`,
  );
  const client = useQueryClient();
  const [image, setImage] = useState<ImageBitmap>();
  const [rect, setRect] = useState<CropRect>();
  const [preset, setPreset] = useState("free");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [decodeAttempt, setDecodeAttempt] = useState(0);
  const saving = useRef(false);
  const savedAsset = useRef<ManagedFile | undefined>(undefined);
  const mounted = useRef(true);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mounted.current = true;
    cancelButton.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!url) return;
    let disposed = false;
    let bitmap: ImageBitmap | undefined;
    const source = new Image();
    source.src = url;
    setError("");
    void source
      .decode()
      .then(() => createImageBitmap(source))
      .then((result) => {
        bitmap = result;
        if (disposed) {
          result.close();
          return;
        }
        if (!result.width || !result.height) throw new Error("图片尺寸无效。");
        setImage(result);
        setRect(fitCrop(result, null));
      })
      .catch(() => {
        if (!disposed) setError("图片无法解码，请重试或选择其他图片。");
      });
    return () => {
      disposed = true;
      bitmap?.close();
    };
  }, [url, decodeAttempt]);
  const ratio =
    preset === "free" || !image
      ? null
      : preset === "original"
        ? image.width / image.height
        : preset
            .split("/")
            .map(Number)
            .reduce((a, b) => a / b);
  const pixels = image && rect ? pixelCrop(rect, image) : undefined;
  const save = async () => {
    if (!image || !rect || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (!savedAsset.current) {
        const file = await exportImageCrop(image, image, rect, title);
        savedAsset.current = await runTransfer((onProgress) =>
          uploadManagedFile(file, projectId, undefined, undefined, {
            onProgress,
          }),
        );
        if (mounted.current) setUploaded(true);
        void invalidateFileScope(client, projectId);
      }
      await onAdd(savedAsset.current);
      if (mounted.current) onSaved();
    } catch (caught) {
      if (mounted.current)
        setError(
          caught instanceof Error ? caught.message : "裁剪保存失败，请重试。",
        );
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div
      className="canvas-image-crop"
      aria-label="图片裁剪"
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          if (!saving.current) onCancel();
        }
      }}
    >
      <TransferFeedback progress={activeTransferProgress} />

      <div
        className="image-crop-toolbar"
        role="toolbar"
        aria-label="裁剪工具栏"
      >
        <CustomSelect
          ariaLabel="裁剪比例"
          value={preset}
          options={RATIOS}
          disabled={busy || uploaded || !image}
          onChange={(value) => {
            setPreset(value);
            const nextRatio =
              value === "free"
                ? null
                : value === "original"
                  ? image!.width / image!.height
                  : value
                      .split("/")
                      .map(Number)
                      .reduce((a, b) => a / b);
            if (value !== "free") setRect(fitCrop(image!, nextRatio));
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={busy || uploaded || !image}
          onClick={() => {
            setPreset("free");
            setRect(fitCrop(image!, null));
          }}
        >
          <RotateCcw size={16} />
          重置
        </button>
        <output aria-label="裁剪尺寸">
          {pixels ? (
            `${pixels.width} × ${pixels.height} 像素`
          ) : (
            <LoadingState variant="inline" label="正在读取图片…" />
          )}
        </output>
      </div>
      {image && rect ? (
        <ImageCropSurface
          image={image}
          rect={rect}
          ratio={ratio}
          disabled={busy || uploaded}
          onChange={setRect}
        />
      ) : (
        <div className="image-crop-loading">
          {!error && !loadError ? (
            <LoadingState label="正在加载原图…" />
          ) : (
            <span>无法加载裁剪图片</span>
          )}
        </div>
      )}
      <footer className="image-crop-footer">
        <div>
          {loadError || error ? (
            <p role="alert">{loadError?.message ?? error}</p>
          ) : null}
          {error && !image && url ? (
            <button
              className="btn"
              onClick={() => setDecodeAttempt((value) => value + 1)}
            >
              重新加载
            </button>
          ) : null}
          <p>
            {uploaded
              ? "图片已保存到项目素材；重试会继续保存同一个画布节点。"
              : "拖动框选或调整边缘；方向键微调，Shift 加速。另存为静态 PNG，原图保留。"}
          </p>
        </div>
        <button
          ref={cancelButton}
          type="button"
          className="btn"
          disabled={busy}
          onClick={onCancel}
        >
          {uploaded ? "返回预览" : "取消"}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !image || !rect || Boolean(loadError)}
          onClick={() => void save()}
        >
          {busy ? null : null}
          {busy ? (
            <LoadingState variant="inline" label="正在保存…" />
          ) : uploaded ? (
            "重试保存到画布"
          ) : (
            "裁剪并添加到画布"
          )}
        </button>
      </footer>
    </div>
  );
}
