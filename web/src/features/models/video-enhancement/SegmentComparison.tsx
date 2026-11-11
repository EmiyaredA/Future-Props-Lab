import { useRef, useState } from "react";

export function SegmentComparison({
  original,
  enhanced,
  enhancedLabel,
}: {
  original: string;
  enhanced: string;
  enhancedLabel: string;
}) {
  const left = useRef<HTMLVideoElement>(null);
  const right = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState({ left: false, right: false });
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");

  function pause() {
    left.current?.pause();
    right.current?.pause();
    setPlaying(false);
  }

  async function toggle() {
    const a = left.current;
    const b = right.current;
    if (!a || !b) return;
    if (playing) {
      pause();
      return;
    }
    if (a.ended) a.currentTime = 0;
    b.currentTime = a.currentTime;
    try {
      await Promise.all([a.play(), b.play()]);
      setPlaying(true);
    } catch {
      pause();
      setError("无法播放对比视频");
    }
  }

  function failed() {
    pause();
    setError("无法加载对比视频");
  }

  return (
    <section className="video-enhancement-comparison" aria-label="提升前后对比">
      <div className="video-enhancement-players">
        <figure>
          <figcaption>原片等比缩放</figcaption>
          <video
            ref={left}
            src={original}
            preload="metadata"
            playsInline
            onError={failed}
            onLoadedMetadata={(event) => {
              setDuration(event.currentTarget.duration);
              setReady((value) => ({ ...value, left: true }));
            }}
            onEnded={pause}
            onTimeUpdate={(event) => {
              const current = event.currentTarget.currentTime;
              setTime(current);
              if (
                right.current &&
                Math.abs(right.current.currentTime - current) > 0.08
              )
                right.current.currentTime = current;
            }}
          />
        </figure>
        <figure>
          <figcaption>{enhancedLabel}</figcaption>
          <video
            ref={right}
            src={enhanced}
            preload="metadata"
            muted
            playsInline
            onError={failed}
            onLoadedMetadata={() =>
              setReady((value) => ({ ...value, right: true }))
            }
          />
        </figure>
      </div>
      <div className="video-enhancement-controls">
        <button
          className="btn"
          type="button"
          disabled={!ready.left || !ready.right || !!error}
          onClick={() => void toggle()}
        >
          {playing ? "暂停对比" : "播放对比"}
        </button>
        <input
          aria-label="对比播放进度"
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={time}
          disabled={!ready.left || !ready.right}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            setTime(value);
            if (left.current) left.current.currentTime = value;
            if (right.current) right.current.currentTime = value;
          }}
        />
        {error && <span role="alert">{error}</span>}
      </div>
    </section>
  );
}
