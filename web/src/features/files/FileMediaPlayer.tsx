import { useRef, useState } from "react";
import { Maximize, Pause, Play, Volume2 } from "lucide-react";
import type { ManagedFile } from "./api";
import { FileThumbnail } from "./FileThumbnail";
import { previewTime } from "./filePreview";

export function FileMediaPlayer({
  file,
  source,
  onError,
}: {
  file: ManagedFile;
  source: string;
  onError: () => void;
}) {
  const media = useRef<HTMLMediaElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [message, setMessage] = useState("");
  const video = file.media_kind === "video";
  const events = {
    src: source,
    preload: "metadata",
    onLoadedMetadata: () =>
      setDuration(
        Number.isFinite(media.current?.duration) ? media.current!.duration : 0,
      ),
    onDurationChange: () =>
      setDuration(
        Number.isFinite(media.current?.duration) ? media.current!.duration : 0,
      ),
    onTimeUpdate: () => setTime(media.current?.currentTime ?? 0),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onError,
  };
  const toggle = async () => {
    if (!media.current) return;
    if (!media.current.paused) {
      media.current.pause();
      return;
    }
    try {
      await media.current.play();
      setMessage("");
    } catch {
      setMessage("暂时无法播放，请重试或下载文件。");
    }
  };
  return (
    <div className="file-media-player" ref={stage}>
      {video ? (
        <video
          {...events}
          ref={(node) => {
            media.current = node;
          }}
          playsInline
          aria-label={file.display_name}
        />
      ) : (
        <>
          <div className="file-player-waveform">
            <FileThumbnail file={file} />
          </div>
          <audio
            {...events}
            ref={(node) => {
              media.current = node;
            }}
          />
        </>
      )}
      <div className="file-player-controls">
        <button
          type="button"
          onClick={() => void toggle()}
          aria-label={playing ? "暂停" : "播放"}
        >
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </button>
        <output aria-label="播放时间">
          {previewTime(time)} / {previewTime(duration)}
        </output>
        <label className="file-player-seek">
          <span className="sr-only">播放进度</span>
          <input
            type="range"
            min="0"
            max={duration || 1}
            step="0.1"
            value={Math.min(time, duration || 1)}
            disabled={!duration}
            onChange={(event) => {
              if (media.current)
                media.current.currentTime = Number(event.target.value);
              setTime(Number(event.target.value));
            }}
          />
        </label>
        <label className="file-player-volume">
          <Volume2 aria-hidden />
          <span className="sr-only">音量</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(event) => {
              const value = Number(event.target.value);
              setVolume(value);
              if (media.current) media.current.volume = value;
            }}
          />
        </label>
        {video && (
          <button
            type="button"
            aria-label="全屏"
            onClick={() => {
              if (!stage.current?.requestFullscreen) {
                setMessage("当前浏览器不支持全屏，请在当前窗口播放。");
                return;
              }
              void stage.current
                .requestFullscreen()
                .catch(() => setMessage("无法进入全屏，请在当前窗口播放。"));
            }}
          >
            <Maximize aria-hidden />
          </button>
        )}
      </div>
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
