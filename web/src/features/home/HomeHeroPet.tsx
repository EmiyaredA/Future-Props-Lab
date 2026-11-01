import { useEffect, useRef, useState } from "react";

const POSTER = "/brand/home/kurisu-idle.png";
const ANIMATION = "/brand/home/kurisu-idle.webm";

export function HomeHeroPet() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReduced(preference.matches);
    preference.addEventListener("change", changed);
    return () => preference.removeEventListener("change", changed);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let active = true;
    const sync = () => {
      if (document.hidden) video.pause();
      else
        void video.play().then(
          () => {
            if (active) setReady(true);
          },
          (error: unknown) => {
            const interrupted =
              error instanceof DOMException && error.name === "AbortError";
            if (active && !document.hidden && !interrupted) setFailed(true);
          },
        );
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", sync);
      video.pause();
    };
  }, [reduced, failed]);

  return (
    <div
      className="home-hero-pet"
      aria-hidden="true"
      data-playing={ready && !reduced && !failed}
    >
      <img src={POSTER} alt="" width="640" height="360" />
      {!reduced && !failed && (
        <video
          ref={videoRef}
          src={ANIMATION}
          poster={POSTER}
          autoPlay={!document.hidden}
          muted
          loop
          playsInline
          preload="auto"
          width="640"
          height="360"
          data-ready={ready}
          onLoadedData={() => setReady(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
