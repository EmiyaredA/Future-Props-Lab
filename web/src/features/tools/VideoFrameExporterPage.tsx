import { LoadingState } from "@shared/ui/LoadingState";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileVideo,
  Image as ImageIcon,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  buildFrameFileName,
  canvasToBlob,
  FRAME_FORMAT_OPTIONS,
  frameBaseNameFromFile,
  isAcceptedVideoFile,
  MIME_BY_FRAME_FORMAT,
  sanitizeExportBaseName,
  type ImageFormat,
} from "@shared/media/videoFrameExport";
import "@features/tools/video-frame-exporter.css";

type FramePreview = {
  url: string;
  format: ImageFormat;
  capturedAt: number;
  width: number;
  height: number;
};

const FRAME_STEP = 1 / 30;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function formatPlaybackTime(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const prefix = hours ? `${pad(hours)}:` : "";
  return `${prefix}${pad(minutes)}:${pad(wholeSeconds)}.${pad(milliseconds, 3)}`;
}

export function VideoFrameExporterPage({ onBack }: { onBack: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [format, setFormat] = useState<ImageFormat>("png");
  const [quality, setQuality] = useState(92);
  const [baseName, setBaseName] = useState("video-frame");
  const [includeTimestamp, setIncludeTimestamp] = useState(true);
  const [preview, setPreview] = useState<FramePreview | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) {
      setSourceUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const outputFileName = useMemo(
    () => buildFrameFileName(baseName, format, currentTime, includeTimestamp),
    [baseName, currentTime, format, includeTimestamp],
  );

  const markPreviewStale = () => {
    if (preview) setPreviewStale(true);
    setMessage("");
  };

  const replaceFile = (nextFile: File) => {
    if (!isAcceptedVideoFile(nextFile)) {
      setError("请选择常见视频文件，例如 MP4、MOV、WebM 或 OGG。");
      return;
    }
    videoRef.current?.pause();
    setFile(nextFile);
    setReady(false);
    setPlaying(false);
    setSeeking(false);
    setDuration(0);
    setCurrentTime(0);
    setDimensions({ width: 0, height: 0 });
    setBaseName(frameBaseNameFromFile(nextFile.name));
    setMessage("");
    setError("");
    setPreviewStale(false);
    setPreview(null);
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    if (nextFile) replaceFile(nextFile);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    const nextFile = event.dataTransfer.files[0];
    if (nextFile) replaceFile(nextFile);
  };

  const seekTo = (value: number) => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const nextTime = clamp(value, 0, duration);
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
    markPreviewStale();
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video || !ready) return;
    setError("");
    if (!video.paused) {
      video.pause();
      setPlaying(false);
      return;
    }
    try {
      await video.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      setError("浏览器暂时无法播放该视频，请尝试拖动时间轴定位。 ");
    }
  };

  const generatePreview = async () => {
    const video = videoRef.current;
    if (!video || !ready || seeking || !video.videoWidth || !video.videoHeight)
      return;
    setGenerating(true);
    setMessage("");
    setError("");
    try {
      video.pause();
      setPlaying(false);
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法创建图片画布。 ");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const mimeType = MIME_BY_FRAME_FORMAT[format];
      const blob = await canvasToBlob(canvas, mimeType, quality / 100);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreview({
        url,
        format,
        capturedAt: currentTime,
        width: canvas.width,
        height: canvas.height,
      });
      setPreviewStale(false);
      setMessage("当前视频帧已生成，可以确认后下载。 ");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "视频帧生成失败，请重试。",
      );
    } finally {
      setGenerating(false);
    }
  };

  const downloadPreview = () => {
    if (!preview || previewStale) return;
    const anchor = document.createElement("a");
    anchor.href = preview.url;
    anchor.download = outputFileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setMessage(`已下载 ${outputFileName}`);
  };

  const reset = () => {
    videoRef.current?.pause();
    setFile(null);
    setReady(false);
    setPlaying(false);
    setSeeking(false);
    setDuration(0);
    setCurrentTime(0);
    setDimensions({ width: 0, height: 0 });
    setPreview(null);
    setPreviewStale(false);
    setMessage("");
    setError("");
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  };

  return (
    <section className="page video-frame-page">
      <header className="video-frame-header">
        <button type="button" className="video-frame-back" onClick={onBack}>
          <ArrowLeft aria-hidden />
          返回工具导航
        </button>
        <div>
          <span className="eyebrow">本地媒体工具</span>
          <h1>视频帧导出</h1>
          <p>拖动时间轴定位画面，并以原始分辨率导出图片。</p>
        </div>
        <span className="video-frame-local-badge">
          <ShieldCheck aria-hidden />
          视频仅在本地处理
        </span>
      </header>

      {!file ? (
        <div className="video-frame-welcome">
          <input
            ref={fileInputRef}
            className="video-frame-file-input"
            type="file"
            accept="video/*,.m4v,.mov,.ogv"
            onChange={handleFileInput}
            aria-label="选择视频文件"
          />
          <button
            type="button"
            className={`video-frame-dropzone${dragging ? " is-dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <span className="video-frame-upload-icon">
              <Upload aria-hidden />
            </span>
            <strong>上传一个视频开始截帧</strong>
            <span>点击选择或将视频拖放到这里</span>
            <small>支持浏览器可播放的 MP4、MOV、WebM、OGG 等格式</small>
          </button>
          {error ? (
            <div className="video-frame-alert is-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="video-frame-workspace">
          <div className="video-frame-main">
            <section className="card video-frame-player-card">
              <header className="video-frame-section-heading">
                <div>
                  <span className="video-frame-section-icon">
                    <FileVideo aria-hidden />
                  </span>
                  <div>
                    <h2>{file.name}</h2>
                    <p>
                      {ready ? (
                        `${formatPlaybackTime(duration)} · ${dimensions.width} × ${dimensions.height}`
                      ) : (
                        <LoadingState
                          variant="inline"
                          label="正在读取视频信息…"
                        />
                      )}
                    </p>
                  </div>
                </div>
                <button type="button" className="btn" onClick={reset}>
                  <RotateCcw aria-hidden />
                  更换视频
                </button>
              </header>

              <div className="video-frame-stage">
                <video
                  ref={videoRef}
                  src={sourceUrl || undefined}
                  preload="metadata"
                  playsInline
                  onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    if (!Number.isFinite(video.duration) || !video.videoWidth) {
                      setError("无法读取该视频，请确认编码受当前浏览器支持。");
                      return;
                    }
                    setDuration(video.duration);
                    setDimensions({
                      width: video.videoWidth,
                      height: video.videoHeight,
                    });
                    setCurrentTime(0);
                    setReady(true);
                    setError("");
                  }}
                  onTimeUpdate={(event) => {
                    setCurrentTime(event.currentTarget.currentTime);
                    markPreviewStale();
                  }}
                  onSeeking={() => setSeeking(true)}
                  onSeeked={(event) => {
                    setSeeking(false);
                    setCurrentTime(event.currentTarget.currentTime);
                  }}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onError={() => {
                    setReady(false);
                    setError(
                      "浏览器无法解析该视频，请尝试其他文件或编码格式。",
                    );
                  }}
                />
                {!ready ? (
                  <LoadingState
                    label="正在准备视频…"
                    variant="region"
                    className="video-frame-loading"
                  />
                ) : null}
              </div>

              <div className="video-frame-controls">
                <div className="video-frame-transport">
                  <button
                    type="button"
                    onClick={() => seekTo(currentTime - FRAME_STEP)}
                    disabled={!ready || currentTime <= 0}
                    aria-label="后退一帧"
                  >
                    <ChevronLeft aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="video-frame-play"
                    onClick={() => void togglePlayback()}
                    disabled={!ready}
                    aria-label={playing ? "暂停视频" : "播放视频"}
                  >
                    {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
                  </button>
                  <button
                    type="button"
                    onClick={() => seekTo(currentTime + FRAME_STEP)}
                    disabled={!ready || currentTime >= duration}
                    aria-label="前进一帧"
                  >
                    <ChevronRight aria-hidden />
                  </button>
                </div>
                <label className="video-frame-timeline">
                  <span className="video-frame-sr-only">视频时间点</span>
                  <input
                    type="range"
                    min="0"
                    max={duration || 0}
                    step="0.001"
                    value={Math.min(currentTime, duration || 0)}
                    disabled={!ready}
                    onChange={(event) => seekTo(Number(event.target.value))}
                    aria-valuetext={formatPlaybackTime(currentTime)}
                    style={
                      {
                        "--frame-progress": `${duration ? (currentTime / duration) * 100 : 0}%`,
                      } as React.CSSProperties
                    }
                  />
                </label>
                <span className="video-frame-time" aria-live="off">
                  <strong>{formatPlaybackTime(currentTime)}</strong>
                  <span>/ {formatPlaybackTime(duration)}</span>
                </span>
              </div>
              <p className="video-frame-step-hint">
                逐帧按钮按约 30 FPS 微调，最终图片以当前视频画面为准。
              </p>
            </section>

            <section className="card video-frame-preview-card">
              <header className="video-frame-section-heading">
                <div>
                  <span className="video-frame-section-icon">
                    <ImageIcon aria-hidden />
                  </span>
                  <div>
                    <h2>导出预览</h2>
                    <p>确认画面和文件信息后再下载</p>
                  </div>
                </div>
              </header>
              {preview ? (
                <div className="video-frame-preview">
                  <div className="video-frame-preview-image">
                    <ResponsiveImage
                      src={preview.url}
                      alt="当前导出视频帧预览"
                    />
                    {previewStale ? (
                      <div className="video-frame-preview-stale">
                        <RotateCcw aria-hidden />
                        设置或时间点已变化，请重新生成预览
                      </div>
                    ) : (
                      <span className="video-frame-preview-ready">
                        <Check aria-hidden /> 已生成
                      </span>
                    )}
                  </div>
                  <div className="video-frame-preview-meta">
                    <span>{preview.format.toUpperCase()}</span>
                    <span>
                      {preview.width} × {preview.height}
                    </span>
                    <span>{formatPlaybackTime(preview.capturedAt)}</span>
                  </div>
                </div>
              ) : (
                <div className="video-frame-preview-empty">
                  <ImageIcon aria-hidden />
                  <strong>还没有生成预览</strong>
                  <span>定位画面并完成导出设置后，点击“生成预览”。</span>
                </div>
              )}
            </section>
          </div>

          <aside className="card video-frame-settings" aria-label="导出设置">
            <header>
              <span className="eyebrow">导出设置</span>
              <h2>图片文件</h2>
              <p>图片保持视频的原始画面尺寸。</p>
            </header>

            <label className="video-frame-field">
              <span>图片格式</span>
              <CustomSelect
                value={format}
                options={FRAME_FORMAT_OPTIONS}
                ariaLabel="选择图片格式"
                onChange={(value) => {
                  setFormat(value as ImageFormat);
                  markPreviewStale();
                }}
              />
            </label>

            {format !== "png" ? (
              <label className="video-frame-field video-frame-quality">
                <span>
                  图片质量 <strong>{quality}%</strong>
                </span>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="1"
                  value={quality}
                  onChange={(event) => {
                    setQuality(Number(event.target.value));
                    markPreviewStale();
                  }}
                  aria-label="图片质量"
                  style={
                    {
                      "--frame-progress": `${quality}%`,
                    } as React.CSSProperties
                  }
                />
              </label>
            ) : null}

            <label className="video-frame-field">
              <span>基础文件名</span>
              <input
                type="text"
                value={baseName}
                maxLength={120}
                onChange={(event) => setBaseName(event.target.value)}
                onBlur={() => setBaseName(sanitizeExportBaseName(baseName))}
                aria-label="基础文件名"
                spellCheck={false}
              />
            </label>

            <button
              type="button"
              role="switch"
              aria-checked={includeTimestamp}
              className="video-frame-switch-row"
              onClick={() => setIncludeTimestamp((current) => !current)}
            >
              <span>
                <strong>追加视频时间点</strong>
                <small>避免同名文件互相覆盖</small>
              </span>
              <span className="video-frame-switch" aria-hidden>
                <span />
              </span>
            </button>

            <div className="video-frame-file-name">
              <span>最终文件名</span>
              <strong title={outputFileName}>{outputFileName}</strong>
            </div>

            {error ? (
              <div className="video-frame-alert is-error" role="alert">
                {error}
              </div>
            ) : null}
            {message ? (
              <div className="video-frame-alert is-success" role="status">
                {message}
              </div>
            ) : null}

            <div className="video-frame-actions">
              <button
                type="button"
                className="video-frame-generate"
                disabled={!ready || seeking || generating}
                onClick={() => void generatePreview()}
              >
                <ImageIcon aria-hidden />
                {generating ? (
                  <LoadingState variant="inline" label="正在生成…" />
                ) : (
                  "生成预览"
                )}
              </button>
              <button
                type="button"
                className="video-frame-download"
                disabled={!preview || previewStale}
                onClick={downloadPreview}
              >
                <Download aria-hidden />
                下载图片
              </button>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
