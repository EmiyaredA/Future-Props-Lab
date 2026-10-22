import { useEffect, useRef, useState } from "react";
export function formatMediaTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${(safe % 60).toFixed(2).padStart(5, "0")}`;
}
export function useVideoPlayback(source?: string, previousSource?: string) {
  const player = useRef<HTMLVideoElement>(null),
    before = useRef<HTMLVideoElement>(null),
    stage = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false),
    [sync, setSync] = useState(true);
  const [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [volume, setVolume] = useState(1),
    [error, setError] = useState("");
  const attempt = useRef(0),
    oldStarting = useRef(false);
  const pause = () => {
    attempt.current++;
    player.current?.pause();
    before.current?.pause();
    setPlaying(false);
  };
  const alignOld = (position: number) => {
    const old = before.current;
    if (!old || !Number.isFinite(old.duration) || old.readyState < 1) return;
    const target = Math.min(position, old.duration);
    if (Math.abs(old.currentTime - target) > 0.15) old.currentTime = target;
    if (position >= old.duration) old.pause();
  };
  const playOld = async () => {
    const old = before.current;
    if (
      !old ||
      !old.paused ||
      oldStarting.current ||
      old.readyState < 1 ||
      (player.current?.currentTime ?? 0) >= old.duration
    )
      return;
    oldStarting.current = true;
    try {
      await old.play();
    } finally {
      oldStarting.current = false;
    }
  };
  const toggle = async () => {
    const video = player.current;
    if (!video) return;
    if (!video.paused) {
      pause();
      return;
    }
    setError("");
    const token = ++attempt.current;
    try {
      if (sync) alignOld(video.currentTime);
      await Promise.all([
        video.play(),
        ...(sync && previousSource ? [playOld()] : []),
      ]);
      if (token !== attempt.current) {
        video.pause();
        before.current?.pause();
      }
    } catch {
      if (token === attempt.current) {
        pause();
        setError("播放失败，请重新播放或关闭同步后重试。");
      }
    }
  };
  const seek = (position: number) => {
    if (!player.current || player.current.readyState < 1) return;
    const target = Math.max(
      0,
      Math.min(position, player.current.duration || 0),
    );
    player.current.currentTime = target;
    setTime(target);
    if (sync) alignOld(target);
  };
  const update = () => {
    const video = player.current;
    if (!video) return;
    setTime(video.currentTime);
    if (sync) {
      alignOld(video.currentTime);
      if (!video.paused)
        void playOld().catch(() => {
          pause();
          setError("返修前视频播放失败，请关闭同步后重试。");
        });
    }
  };
  useEffect(() => {
    const current = player.current,
      old = before.current;
    const lifecycle = attempt;
    setPlaying(false);
    setTime(current?.currentTime || 0);
    setDuration(
      current && Number.isFinite(current.duration) ? current.duration : 0,
    );
    setError("");
    return () => {
      lifecycle.current++;
      current?.pause();
      old?.pause();
    };
  }, [source, previousSource]);
  return {
    player,
    before,
    stage,
    playing,
    sync,
    time,
    duration,
    volume,
    error,
    toggle,
    seek,
    update,
    loaded: () => {
      const value = player.current?.duration ?? 0;
      setDuration(Number.isFinite(value) ? value : 0);
    },
    oldLoaded: () => {
      if (sync) {
        alignOld(player.current?.currentTime ?? 0);
        if (player.current && !player.current.paused)
          void playOld().catch(() => {
            pause();
            setError("返修前视频播放失败，请关闭同步后重试。");
          });
      }
    },
    onPlay: () => setPlaying(true),
    onPause: () => {
      setPlaying(false);
      before.current?.pause();
    },
    failed: () => {
      pause();
      setError("视频加载失败，请检查素材后重试。");
    },
    setSync: (enabled: boolean) => {
      setSync(enabled);
      if (!enabled) before.current?.pause();
      else {
        alignOld(player.current?.currentTime ?? 0);
        if (player.current && !player.current.paused)
          void playOld().catch(() => {
            pause();
            setError("返修前视频播放失败，请关闭同步后重试。");
          });
      }
    },
    setVolume: (value: number) => {
      const next = Math.max(0, Math.min(1, value));
      setVolume(next);
      if (player.current) player.current.volume = next;
    },
    fullscreen: async () => {
      try {
        if (!stage.current?.requestFullscreen) throw Error();
        await stage.current.requestFullscreen();
      } catch {
        setError("当前环境无法进入全屏。");
      }
    },
  };
}
export type AcceptancePlayback = ReturnType<typeof useVideoPlayback>;
