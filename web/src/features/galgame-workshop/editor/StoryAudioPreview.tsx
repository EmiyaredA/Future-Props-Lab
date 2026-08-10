import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2 } from "lucide-react";
import { fetchApiBlob } from "@platform/api/client";

function durationLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)
    .toString()
    .padStart(2, "0")}:${(whole % 60).toString().padStart(2, "0")}`;
}

export function StoryAudioPreview({
  fileId,
  label,
  compact = false,
  onDurationMs,
}: {
  fileId?: string;
  label: string;
  compact?: boolean;
  onDurationMs?: (durationMs: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onDurationMsRef = useRef(onDurationMs);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    onDurationMsRef.current = onDurationMs;
  }, [onDurationMs]);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;
    const loaded = () => {
      if (!active) return;
      setDuration(audio.duration);
      onDurationMsRef.current?.(Math.round(audio.duration * 1000));
      setReady(true);
    };
    const ended = () => active && setPlaying(false);
    const failed = () => active && setError("音频无法读取");
    audio.addEventListener("loadedmetadata", loaded);
    audio.addEventListener("ended", ended);
    audio.addEventListener("error", failed);
    setPlaying(false);
    setDuration(0);
    setReady(false);
    setError("");
    if (fileId)
      void fetchApiBlob(`/v1/files/${fileId}/content`)
        .then((blob) => {
          if (!active) return;
          objectUrl = URL.createObjectURL(blob);
          audio.src = objectUrl;
          audio.load();
        })
        .catch(() => active && setError("音频无法读取"));
    return () => {
      active = false;
      audio.pause();
      audio.removeEventListener("loadedmetadata", loaded);
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("error", failed);
      audio.removeAttribute("src");
      audio.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [fileId]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !ready) return;
    if (!audio.paused) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
      setError("");
    } catch {
      setPlaying(false);
      setError("浏览器阻止了试听，请再次点击");
    }
  };

  return (
    <div className={`galgame-audio-preview ${compact ? "compact" : ""}`}>
      <button
        type="button"
        aria-label={`${playing ? "暂停" : "试听"}${label}`}
        disabled={!ready}
        onClick={() => void toggle()}
      >
        {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      </button>
      <span className="galgame-audio-wave" aria-hidden>
        {Array.from({ length: compact ? 9 : 16 }, (_, index) => (
          <i key={index} style={{ height: `${8 + ((index * 11) % 19)}px` }} />
        ))}
      </span>
      <span>
        <strong>{label}</strong>
        <small>{error || durationLabel(duration)}</small>
      </span>
      {!compact ? <Volume2 aria-hidden /> : null}
    </div>
  );
}
