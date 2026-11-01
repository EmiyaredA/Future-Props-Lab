import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Maximize } from "lucide-react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { getVideoMediaInfo, visualAssetDownloadPath } from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import "./output-preview.css";
import "./video-output-preview.css";

const COLORS = [
  ["黑", "#000000"],
  ["白", "#FFFFFF"],
  ["灰", "#808080"],
  ["绿", "#00FF00"],
  ["洋红", "#FF00FF"],
] as const;

function MediaInfo({
  assetId,
  label,
}: {
  assetId?: string | null;
  label: string;
}) {
  const info = useQuery({
    queryKey: visualWorkshopQueryKeys.videoMediaInfo(assetId ?? ""),
    queryFn: () => getVideoMediaInfo(assetId!),
    enabled: !!assetId,
    staleTime: 60_000,
    retry: false,
  });
  if (!assetId) return null;
  const data = info.data;
  return (
    <p className="board-video-info" role="status">
      {label}：
      {data
        ? [
            data.container ?? "格式未知",
            data.codec?.toUpperCase() ?? "编码未知",
            {
              present: "含透明通道",
              absent: "无透明通道",
              unknown: "透明通道未知",
            }[data.alpha_channel],
          ].join(" · ")
        : info.isError
          ? "格式信息暂不可用 · 透明通道未知"
          : "正在读取格式…"}
      {info.isError && (
        <button type="button" onClick={() => void info.refetch()}>
          重试
        </button>
      )}
    </p>
  );
}

export function VideoOutputPreview({
  assetId,
  inspectionAssetId,
  background,
  onBackgroundChange,
}: {
  assetId?: string | null;
  inspectionAssetId?: string | null;
  background: string;
  onBackgroundChange: (color: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [original, setOriginal] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const activeId = original ? assetId : (inspectionAssetId ?? assetId);
  const blob = useApiBlobUrl(
    activeId ? visualAssetDownloadPath(activeId) : undefined,
  );
  const failed = playbackError || !!blob.error;
  const inspection = !!inspectionAssetId && !original;
  return (
    <div
      ref={root}
      className="board-video-preview"
      style={{ backgroundColor: background }}
    >
      <div className="board-video-tools" role="group" aria-label="视频预览背景">
        <span>预览背景</span>
        {COLORS.map(([name, color]) => (
          <button
            key={color}
            type="button"
            aria-label={`${name}色背景`}
            aria-pressed={background === color}
            onClick={() => onBackgroundChange(color)}
          >
            <i style={{ backgroundColor: color }} aria-hidden />
            {name}
          </button>
        ))}
        <CustomColorPicker
          value={background}
          onChange={onBackgroundChange}
          ariaLabel="自定义预览背景"
          compact
          colors={COLORS.map(([, color]) => color)}
        />
        <button
          type="button"
          aria-label="全屏预览"
          disabled={!blob.url || failed}
          onClick={() => {
            setFullscreenError(false);
            const request = document.fullscreenElement
              ? document.exitFullscreen()
              : root.current?.requestFullscreen();
            void request?.catch(() => setFullscreenError(true));
          }}
        >
          <Maximize size={15} />
        </button>
      </div>
      <div className="board-video-description">
        <MediaInfo
          assetId={activeId}
          label={inspection ? "检查视频" : "视频格式"}
        />
        {inspection && <MediaInfo assetId={assetId} label="原输出" />}
        <p>
          背景仅显示在透明区域；旧 GIF 黑底 MP4 需重新上传原 GIF
          才能检查透明边缘。
        </p>
      </div>
      <div className="board-large-preview" style={{ background: background }}>
        {failed ? (
          <div className="board-video-error" role="alert">
            <span>{inspection ? "透明检查视频不可播放" : "视频不可播放"}</span>
            {inspection && (
              <button
                type="button"
                onClick={() => {
                  setOriginal(true);
                  setPlaybackError(false);
                }}
              >
                查看原输出 MP4
              </button>
            )}
          </div>
        ) : blob.url ? (
          <video
            src={blob.url}
            controls
            controlsList="nofullscreen"
            preload="metadata"
            style={{ backgroundColor: background }}
            aria-label="输出视频预览"
            onError={() => setPlaybackError(true)}
          />
        ) : (
          <div className="board-preview-placeholder">
            {activeId ? "加载素材…" : "暂无输出"}
          </div>
        )}
      </div>
      {fullscreenError && <p role="alert">暂时无法进入全屏，请重试。</p>}
    </div>
  );
}
