import { useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { visualAssetDownloadPath } from "../api";
import type { Run, Result } from "./api";
export function AssetFrame({
  assetId,
  position,
  onClick,
}: {
  assetId: string;
  position?: number | null;
  onClick?: () => void;
}) {
  const blob = useApiBlobUrl(visualAssetDownloadPath(assetId));
  return (
    <button
      className="acceptance-frame"
      onClick={onClick}
      disabled={!onClick}
      aria-label={position != null ? `查看 ${position} 毫秒证据` : "参考图片"}
    >
      {blob.url ? (
        <img src={blob.url} alt="验收证据帧" />
      ) : (
        <span>{blob.error ? "证据不可用" : "正在加载"}</span>
      )}
      {position != null && <small>{(position / 1000).toFixed(2)}s</small>}
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
  const current = run.snapshot.output as {
    asset_id?: string;
    kind: string;
    text?: string;
  };
  const prior = previous?.snapshot.output as
    { asset_id?: string; kind: string } | undefined;
  const source = useApiBlobUrl(
    current.asset_id ? visualAssetDownloadPath(current.asset_id) : undefined,
  );
  const old = useApiBlobUrl(
    prior?.asset_id ? visualAssetDownloadPath(prior.asset_id) : undefined,
  );
  const player = useRef<HTMLVideoElement>(null),
    before = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [sync, setSync] = useState(true);
  const seek = (position: number) => {
    if (player.current) player.current.currentTime = position / 1000;
    if (before.current && sync) before.current.currentTime = position / 1000;
  };
  const toggle = () => {
    if (playing) {
      player.current?.pause();
      before.current?.pause();
    } else {
      void player.current?.play().catch(() => setPlaying(false));
      if (sync) void before.current?.play().catch(() => {});
    }
    setPlaying(!playing);
  };
  return (
    <div className="acceptance-evidence">
      <div
        className={`acceptance-comparison ${previous ? "is-comparing" : ""}`}
      >
        {previous && (
          <div>
            <strong>
              v{previous.snapshot.output.version as number} · 返修前
            </strong>
            {prior?.kind === "video" ? (
              <video
                ref={before}
                src={old.url || undefined}
                controls
                muted
                preload="metadata"
                aria-label="返修前视频"
              />
            ) : old.url ? (
              <img src={old.url} alt="返修前输出" />
            ) : (
              <p>旧版本不可用</p>
            )}
          </div>
        )}
        <div>
          <strong>
            v{run.snapshot.output.version as number} ·{" "}
            {previous ? "返修后" : "当前输出"}
          </strong>
          <div className="acceptance-media-stage">
            {current.kind === "video" ? (
              <video
                ref={player}
                src={source.url || undefined}
                controls
                preload="metadata"
                aria-label="验收视频"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={() => {
                  if (
                    sync &&
                    before.current &&
                    player.current &&
                    Math.abs(
                      before.current.currentTime - player.current.currentTime,
                    ) > 0.2
                  )
                    before.current.currentTime = player.current.currentTime;
                }}
              />
            ) : current.kind === "image" && source.url ? (
              <img src={source.url} alt="当前验收输出" />
            ) : current.kind === "audio" ? (
              <audio
                src={source.url || undefined}
                controls
                aria-label="验收音频"
              />
            ) : (
              <pre>
                {current.text ??
                  (source.error ? "素材加载失败" : "正在加载素材…")}
              </pre>
            )}
            {selected?.region && (
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
        <div className="acceptance-actions">
          <button onClick={toggle}>
            {playing ? <Pause size={15} /> : <Play size={15} />}{" "}
            {playing ? "暂停" : "播放"}
          </button>
          {previous && (
            <label>
              <input
                type="checkbox"
                checked={sync}
                onChange={(e) => setSync(e.target.checked)}
              />{" "}
              同步播放
            </label>
          )}
          {selected?.start_ms != null && (
            <button onClick={() => seek(selected.start_ms!)}>
              定位问题 {(selected.start_ms / 1000).toFixed(2)}s
            </button>
          )}
        </div>
      )}
      <p className="acceptance-muted">{run.snapshot.coverage as string}</p>
      <div className="acceptance-filmstrip">
        {run.evidence.map((item) => (
          <AssetFrame
            key={item.id}
            assetId={item.asset_id}
            position={item.position_ms}
            onClick={
              item.source_asset_id === current.asset_id &&
              item.position_ms != null
                ? () => seek(item.position_ms!)
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
