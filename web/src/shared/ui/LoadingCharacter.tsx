import { useEffect, useRef, useState } from "react";

const POSTER = "/brand/loading/kurisu-run.png";
const WEBP_POSTER = "/brand/loading/kurisu-run.webp";
const ANIMATION = "/brand/loading/kurisu-run.webm";
const MOTION_PREFERENCE = "(prefers-reduced-motion: reduce)";

function CharacterPoster() {
  return (
    <picture>
      <source srcSet={WEBP_POSTER} type="image/webp" />
      <img src={POSTER} alt="" width={150} height={192} />
    </picture>
  );
}

function AnimatedCharacter({
  onFailure,
  paused,
}: {
  onFailure: (failed: boolean) => void;
  paused: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.defaultMuted = true;
    let current = true;
    const sync = () => {
      if (document.hidden || paused) {
        if (!video.paused) video.pause();
      } else {
        void video.play().catch((error: unknown) => {
          const interrupted =
            error instanceof DOMException && error.name === "AbortError";
          if (current && !document.hidden && !paused && !interrupted)
            onFailure(true);
        });
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      current = false;
      document.removeEventListener("visibilitychange", sync);
      if (!video.paused) video.pause();
    };
  }, [onFailure, paused]);

  return (
    <span
      className="fpl-loading-character"
      aria-hidden="true"
      data-playing={playing}
    >
      <CharacterPoster />
      <video
        ref={videoRef}
        src={ANIMATION}
        poster={WEBP_POSTER}
        width={150}
        height={192}
        muted
        autoPlay={!paused}
        loop
        playsInline
        preload="auto"
        onPlaying={() => setPlaying(true)}
        onWaiting={() => setPlaying(false)}
        onError={() => onFailure(true)}
      />
    </span>
  );
}

/** Decorative loading art; request and task state remain with the caller. */
export function LoadingCharacter({
  active,
  paused = false,
}: {
  active: boolean;
  paused?: boolean;
}) {
  const [reduced, setReduced] = useState(
    () => window.matchMedia(MOTION_PREFERENCE).matches,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia(MOTION_PREFERENCE);
    const changed = () => setReduced(preference.matches);
    preference.addEventListener("change", changed);
    return () => preference.removeEventListener("change", changed);
  }, []);

  return active && !reduced && !failed ? (
    <AnimatedCharacter onFailure={setFailed} paused={paused} />
  ) : (
    <span className="fpl-loading-character" aria-hidden="true">
      <CharacterPoster />
    </span>
  );
}
