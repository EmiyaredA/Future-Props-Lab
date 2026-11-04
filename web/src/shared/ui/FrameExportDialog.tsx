import { LoadingScene } from "@shared/ui/LoadingScene";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Download, ImageDown, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  buildFrameFileName,
  downloadFrameBlob,
  encodeFrameSnapshot,
  FRAME_FORMAT_OPTIONS,
  formatFramePlaybackTime,
  MIME_BY_FRAME_FORMAT,
  sanitizeExportBaseName,
  type FrameSnapshot,
  type ImageFormat,
} from "@shared/media/videoFrameExport";
import { CustomSelect } from "@shared/ui/CustomSelect";
import "@shared/ui/frame-export-dialog.css";

export function FrameExportDialog({
  baseName,
  destination,
  initialTime,
  maxTime,
  step,
  loadSnapshot,
  onClose,
  onSave,
}: {
  baseName: string;
  destination: string;
  initialTime: number;
  maxTime: number;
  step: number;
  loadSnapshot: (
    capturedAt: number,
    signal: AbortSignal,
  ) => Promise<FrameSnapshot>;
  onClose: () => void;
  onSave: (file: File) => Promise<void>;
}) {
  const upperTime = Math.max(0, maxTime);
  const safeStep = Math.max(0.001, step);
  const clampTime = (value: number) => Math.min(Math.max(0, value), upperTime);
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const loadSnapshotRef = useRef(loadSnapshot);
  const onCloseRef = useRef(onClose);
  const selectedTimeRef = useRef(clampTime(initialTime));
  const loadTimerRef = useRef<number | undefined>(undefined);
  const loadControllerRef = useRef<AbortController | undefined>(undefined);
  const loadRequestRef = useRef(0);
  const scheduleLoadRef = useRef<(capturedAt: number, delay: number) => void>(
    () => undefined,
  );
  const pendingRef = useRef(false);
  const [snapshot, setSnapshot] = useState<FrameSnapshot>();
  const [loadedTime, setLoadedTime] = useState<number>();
  const [previewUrl, setPreviewUrl] = useState("");
  const [selectedTime, setSelectedTime] = useState(selectedTimeRef.current);
  const [format, setFormat] = useState<ImageFormat>("png");
  const [quality, setQuality] = useState(92);
  const [name, setName] = useState(() => sanitizeExportBaseName(baseName));
  const [includeTimestamp, setIncludeTimestamp] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  loadSnapshotRef.current = loadSnapshot;
  onCloseRef.current = onClose;
  pendingRef.current = saving;

  useEffect(() => {
    const requestSnapshot = (capturedAt: number, delay: number) => {
      if (loadTimerRef.current !== undefined)
        window.clearTimeout(loadTimerRef.current);
      loadControllerRef.current?.abort();
      const requestId = ++loadRequestRef.current;
      setLoading(true);
      setError("");
      loadTimerRef.current = window.setTimeout(() => {
        loadTimerRef.current = undefined;
        const controller = new AbortController();
        loadControllerRef.current = controller;
        void loadSnapshotRef
          .current(capturedAt, controller.signal)
          .then((next) => {
            if (
              !controller.signal.aborted &&
              loadRequestRef.current === requestId
            ) {
              setSnapshot(next);
              setLoadedTime(capturedAt);
            }
          })
          .catch((caught: unknown) => {
            if (
              controller.signal.aborted ||
              loadRequestRef.current !== requestId
            )
              return;
            setError(
              caught instanceof Error ? caught.message : "当前视频帧读取失败。",
            );
          })
          .finally(() => {
            if (loadRequestRef.current === requestId) setLoading(false);
          });
      }, delay);
    };
    scheduleLoadRef.current = requestSnapshot;
    requestSnapshot(selectedTimeRef.current, 0);
    return () => {
      if (loadTimerRef.current !== undefined)
        window.clearTimeout(loadTimerRef.current);
      loadControllerRef.current?.abort();
      loadRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const url = URL.createObjectURL(snapshot.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [snapshot]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingRef.current) onCloseRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => closeButton.current?.focus());
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const filename = useMemo(
    () => buildFrameFileName(name, format, selectedTime, includeTimestamp),
    [format, includeTimestamp, name, selectedTime],
  );

  const selectTime = (value: number, delay = 180) => {
    const next = clampTime(value);
    selectedTimeRef.current = next;
    setSelectedTime(next);
    scheduleLoadRef.current(next, delay);
  };
  const snapshotIsCurrent =
    snapshot !== undefined &&
    loadedTime !== undefined &&
    Math.abs(loadedTime - selectedTime) <= Math.max(0.0005, safeStep / 2);

  const exportFrame = async () => {
    if (!snapshot || !snapshotIsCurrent || loading || saving) return;
    setSaving(true);
    setError("");
    try {
      const blob = await encodeFrameSnapshot(snapshot, format, quality);
      const file = new File([blob], filename, {
        type: MIME_BY_FRAME_FORMAT[format],
      });
      await onSave(file);
      downloadFrameBlob(blob, filename);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "视频帧导出失败。");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="frame-export-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pendingRef.current)
          onClose();
      }}
    >
      <section
        className="frame-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            <span className="frame-export-heading-icon">
              <ImageDown aria-hidden />
            </span>
            <div>
              <h2 id={titleId}>导出当前视频帧</h2>
              <p>{destination}</p>
            </div>
          </div>
          <button
            ref={closeButton}
            type="button"
            aria-label="关闭视频帧导出设置"
            disabled={saving}
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </header>

        <div className="frame-export-body">
          <div className="frame-export-viewer">
            <div className="frame-export-preview">
              {loading && !previewUrl ? (
                <span className="frame-export-loading">
                  <LoadingScene /> 正在锁定当前画面…
                </span>
              ) : previewUrl && snapshot ? (
                <>
                  <ResponsiveImage src={previewUrl} alt="当前导出视频帧预览" />
                  <span className="frame-export-preview-details">
                    {snapshot.width} × {snapshot.height} ·{" "}
                    {formatFramePlaybackTime(snapshot.capturedAt)}
                  </span>
                </>
              ) : (
                <span className="frame-export-loading">当前画面无法预览</span>
              )}
              {loading && previewUrl ? (
                <span className="frame-export-refreshing">
                  <LoadingScene /> 正在刷新所选画面…
                </span>
              ) : null}
            </div>
            <div className="frame-export-scrubber">
              <label>
                <span className="frame-export-sr-only">导出视频帧时间点</span>
                <input
                  type="range"
                  min="0"
                  max={upperTime}
                  step={safeStep}
                  value={selectedTime}
                  disabled={upperTime <= 0 || saving}
                  aria-label="导出视频帧时间点"
                  aria-valuetext={formatFramePlaybackTime(selectedTime)}
                  onChange={(event) =>
                    selectTime(Number(event.currentTarget.value))
                  }
                  onPointerUp={() => selectTime(selectedTimeRef.current, 0)}
                  onPointerCancel={() => selectTime(selectedTimeRef.current, 0)}
                  style={
                    {
                      "--frame-export-progress": `${upperTime ? (selectedTime / upperTime) * 100 : 0}%`,
                    } as CSSProperties
                  }
                />
              </label>
              <span>
                <strong>{formatFramePlaybackTime(selectedTime)}</strong>
                <i>/ {formatFramePlaybackTime(upperTime)}</i>
              </span>
            </div>
          </div>

          <div className="frame-export-settings" aria-label="视频帧导出设置">
            <label>
              <span>图片格式</span>
              <CustomSelect
                ariaLabel="选择视频帧图片格式"
                value={format}
                options={FRAME_FORMAT_OPTIONS}
                onChange={(value) => setFormat(value as ImageFormat)}
              />
            </label>
            {format !== "png" ? (
              <label>
                <span>
                  图片质量 <strong>{quality}%</strong>
                </span>
                <input
                  aria-label="视频帧图片质量"
                  type="range"
                  min="10"
                  max="100"
                  value={quality}
                  onChange={(event) => setQuality(Number(event.target.value))}
                />
              </label>
            ) : null}
            <label>
              <span>文件名</span>
              <input
                aria-label="视频帧文件名"
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="frame-export-timestamp">
              <input
                type="checkbox"
                checked={includeTimestamp}
                onChange={(event) => setIncludeTimestamp(event.target.checked)}
              />
              <span>在文件名中包含当前时间点</span>
            </label>
            <output aria-label="视频帧输出文件名">{filename}</output>
          </div>
        </div>

        {error ? (
          <p className="frame-export-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              disabled={saving}
              onClick={() => selectTime(selectedTimeRef.current, 0)}
            >
              重试此帧
            </button>
          </p>
        ) : null}

        <footer>
          <button type="button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={!snapshotIsCurrent || loading || saving || !name.trim()}
            onClick={() => void exportFrame()}
          >
            {saving ? (
              <>
                <LoadingScene /> 正在导出…
              </>
            ) : (
              <>
                <Download aria-hidden /> 导出并保存
              </>
            )}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
