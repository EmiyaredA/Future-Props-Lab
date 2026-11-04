import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { LoadingState } from "@shared/ui/LoadingState";
import { useState } from "react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { imagePreviewSource } from "@shared/lib/imageSources";
import { visualAssetDownloadPath } from "../api";
import type { Run, Result } from "./api";
import { useVideoPlayback, formatMediaTime } from "./useVideoPlayback";
import { VideoControls } from "./VideoControls";
import { AcceptanceThumbnail } from "./ReferenceMaterials";
export function AssetFrame({
  assetId,
  position,
  onClick,
}: {
  assetId: string;
  position?: number | null;
  onClick?: () => void;
}) {
  const blob = useApiBlobUrl(
    imagePreviewSource(visualAssetDownloadPath(assetId), 320),
  );
  return (
    <button
      className="acceptance-frame"
      onClick={onClick}
      disabled={!onClick}
      aria-label={position != null ? `查看 ${position} 毫秒证据` : "参考图片"}
    >
      {blob.url ? (
        <ResponsiveImage src={blob.url} alt="验收证据帧" />
      ) : (
        <span>
          {blob.error ? (
            "证据不可用"
          ) : (
            <LoadingState variant="inline" label="正在加载" />
          )}
        </span>
      )}
      {position != null && <small>{formatMediaTime(position / 1000)}</small>}
    </button>
  );
}
export function EvidenceViewer({
  run,
  previous,
  selected,
}: {
  run: Run;
  previous?: Run;
  selected?: Result;
}) {
  const current = run.snapshot.output,
    prior = previous?.snapshot.output;
  const source = useApiBlobUrl(
    current.asset_id
      ? current.kind === "image"
        ? imagePreviewSource(visualAssetDownloadPath(current.asset_id), 1280)
        : visualAssetDownloadPath(current.asset_id)
      : undefined,
  );
  const old = useApiBlobUrl(
    prior?.asset_id
      ? prior.kind === "image"
        ? imagePreviewSource(visualAssetDownloadPath(prior.asset_id), 1280)
        : visualAssetDownloadPath(prior.asset_id)
      : undefined,
  );
  const playback = useVideoPlayback(
    current.kind === "video" ? source.url : undefined,
    prior?.kind === "video" ? old.url : undefined,
  );
  const [ratio, setRatio] = useState(16 / 9);
  const frames = run.evidence
    .filter(
      (item) =>
        item.source_asset_id === current.asset_id && item.position_ms != null,
    )
    .sort((a, b) => a.position_ms! - b.position_ms!);
  const references = [
    ...new Set(
      run.snapshot.criteria.flatMap((item) => item.reference_asset_ids ?? []),
    ),
  ];
  const evidenceById = new Map(run.evidence.map((item) => [item.id, item]));
  const selectedFrames = (selected?.evidence_ids ?? []).flatMap((id) =>
    evidenceById.get(id) ? [evidenceById.get(id)!] : [],
  );
  const referenceKind = (id: string) =>
    run.evidence.some(
      (item) => item.source_asset_id === id && item.position_ms != null,
    )
      ? "video"
      : undefined;
  return (
    <div className="acceptance-evidence">
      <div
        ref={playback.stage}
        className="acceptance-video-group"
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).closest("button,input,textarea,a"))
            return;
          if (event.code === "Space") {
            event.preventDefault();
            void playback.toggle();
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            playback.seek(playback.time + (event.key === "ArrowLeft" ? -5 : 5));
          }
        }}
      >
        <div
          className={`acceptance-comparison ${previous ? "is-comparing" : ""}`}
        >
          {previous && (
            <div>
              <strong>v{prior!.version} · 返修前</strong>
              <div className="acceptance-media-stage">
                {prior?.kind === "video" ? (
                  <video
                    ref={playback.before}
                    src={old.url || undefined}
                    muted
                    preload="metadata"
                    playsInline
                    aria-label="返修前视频"
                    onLoadedMetadata={playback.oldLoaded}
                    onError={playback.failed}
                  />
                ) : prior?.kind === "image" && old.url ? (
                  <ResponsiveImage src={old.url} alt="返修前输出" />
                ) : prior?.kind === "text" ? (
                  <pre>{prior.text}</pre>
                ) : (
                  <p>{old.error ? "旧版本加载失败" : "旧版本预览不可用"}</p>
                )}
              </div>
            </div>
          )}
          <div>
            <strong>
              v{current.version} · {previous ? "返修后" : "当前输出"}
            </strong>
            <div
              className="acceptance-media-stage"
              style={
                current.kind === "image"
                  ? { aspectRatio: ratio, width: `min(100%, ${ratio * 48}vh)` }
                  : undefined
              }
            >
              {current.kind === "video" ? (
                <video
                  ref={playback.player}
                  src={source.url || undefined}
                  preload="metadata"
                  playsInline
                  tabIndex={0}
                  aria-label="验收视频"
                  onLoadedMetadata={playback.loaded}
                  onPlay={playback.onPlay}
                  onPause={playback.onPause}
                  onEnded={playback.onPause}
                  onTimeUpdate={playback.update}
                  onError={playback.failed}
                />
              ) : current.kind === "image" && source.url ? (
                <ResponsiveImage
                  src={source.url}
                  alt="当前验收输出"
                  onLoad={(event) =>
                    setRatio(
                      event.currentTarget.naturalWidth /
                        event.currentTarget.naturalHeight,
                    )
                  }
                />
              ) : current.kind === "audio" ? (
                <audio
                  src={source.url || undefined}
                  controls
                  aria-label="验收音频"
                />
              ) : (
                <pre>
                  {current.text ??
                    (source.error ? (
                      "素材加载失败"
                    ) : (
                      <LoadingState label="正在加载素材…" />
                    ))}
                </pre>
              )}
              {current.kind === "image" && selected?.region && (
                <div
                  className="acceptance-region"
                  style={{
                    left: `${selected.region[0] * 100}%`,
                    top: `${selected.region[1] * 100}%`,
                    width: `${selected.region[2] * 100}%`,
                    height: `${selected.region[3] * 100}%`,
                  }}
                />
              )}
            </div>
          </div>
        </div>
        {current.kind === "video" && (
          <VideoControls
            playback={playback}
            comparing={prior?.kind === "video"}
            issue={selected?.start_ms}
          />
        )}
      </div>
      {source.error && (
        <p className="acceptance-error" role="alert">
          素材加载失败：{source.error.message}
        </p>
      )}
      {!!frames.length && (
        <div className="acceptance-filmstrip" aria-label="输出取样帧">
          {frames.map((item) => (
            <AssetFrame
              key={item.id}
              assetId={item.asset_id}
              position={item.position_ms}
              onClick={() => playback.seek(item.position_ms! / 1000)}
            />
          ))}
        </div>
      )}
      <p className="acceptance-coverage">{run.snapshot.coverage}</p>
      {!!selectedFrames.length && (
        <details className="acceptance-evidence-disclosure">
          <summary>当前问题证据（{selectedFrames.length}）</summary>
          <div className="acceptance-filmstrip">
            {selectedFrames.map((item) => (
              <AssetFrame
                key={item.id}
                assetId={item.asset_id}
                position={item.position_ms}
                onClick={
                  item.source_asset_id === current.asset_id &&
                  item.position_ms != null
                    ? () => playback.seek(item.position_ms! / 1000)
                    : undefined
                }
              />
            ))}
          </div>
        </details>
      )}
      {!!references.length && (
        <details open className="acceptance-evidence-disclosure">
          <summary>验收依据（{references.length}）</summary>
          <div className="acceptance-reference-strip">
            {references.map((id) => (
              <div key={id}>
                <AcceptanceThumbnail assetId={id} kind={referenceKind(id)} />
                <span>
                  {run.snapshot.criteria.find((item) =>
                    item.reference_asset_ids?.includes(id),
                  )?.reference_label || "参考素材"}
                  <small>固定素材</small>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
