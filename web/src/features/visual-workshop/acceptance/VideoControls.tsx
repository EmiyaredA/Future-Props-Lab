import { Maximize, Pause, Play, Volume2 } from "lucide-react";
import { formatMediaTime, type AcceptancePlayback } from "./useVideoPlayback";
export function VideoControls({
  playback,
  comparing,
  issue,
}: {
  playback: AcceptancePlayback;
  comparing: boolean;
  issue?: number | null;
}) {
  return (
    <div className="acceptance-player-controls">
      <div className="acceptance-playback-row">
        <button
          aria-label={playback.playing ? "暂停视频" : "播放视频"}
          disabled={!playback.duration}
          onClick={() => void playback.toggle()}
        >
          {playback.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        {comparing && (
          <label className="acceptance-check-label">
            <input
              type="checkbox"
              checked={playback.sync}
              onChange={(event) => playback.setSync(event.target.checked)}
            />
            同步播放
          </label>
        )}
        <span className="acceptance-player-time">
          {formatMediaTime(playback.time)} /{" "}
          {formatMediaTime(playback.duration)}
        </span>
        {issue != null && (
          <button
            className="acceptance-text-button"
            onClick={() => playback.seek(issue / 1000)}
          >
            定位问题 {formatMediaTime(issue / 1000)}
          </button>
        )}
        <label className="acceptance-volume">
          <Volume2 size={16} />
          <span className="sr-only">视频音量</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={playback.volume}
            onChange={(event) => playback.setVolume(Number(event.target.value))}
          />
        </label>
        <button
          onClick={() => void playback.fullscreen()}
          aria-label="全屏预览"
        >
          <Maximize size={16} />
        </button>
      </div>
      <input
        className="acceptance-seek"
        aria-label="视频播放位置"
        type="range"
        min={0}
        max={playback.duration || 1}
        step={0.01}
        value={Math.min(playback.time, playback.duration || 0)}
        disabled={!playback.duration}
        onChange={(event) => playback.seek(Number(event.target.value))}
      />
      {playback.error && (
        <p role="alert" className="acceptance-error">
          {playback.error}
        </p>
      )}
    </div>
  );
}
