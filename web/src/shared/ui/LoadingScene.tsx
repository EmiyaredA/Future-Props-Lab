import { useEffect, useRef, useState } from "react";
import { LoadingCharacter } from "./LoadingCharacter";
import "./loading-scene.css";

const ART = "/brand/loading/";
const PROPS = [
  "phonewave",
  "pocket-watch",
  "metal-upa",
  "divergence-meter",
  "flip-phone",
  "gel-banana",
  "dr-pepper",
  "time-machine",
];

/** Decorative only: callers own request state, task progress and announcements. */
export function LoadingScene({
  variant = "inline",
  active = true,
  paused = false,
}: {
  variant?: "page" | "region" | "inline";
  active?: boolean;
  paused?: boolean;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const changed = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "64px" },
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const props = variant === "inline" ? [] : PROPS;
  return (
    <span
      ref={root}
      className={`fpl-loading-scene fpl-loading-scene--${variant}`}
      aria-hidden="true"
      data-paused={!active || paused || hidden || !inView}
    >
      {variant !== "inline" ? (
        <>
          <span className="fpl-loading-halo" />
          <span className="fpl-loading-radar" />
        </>
      ) : null}
      <svg className="fpl-loading-dial" viewBox="0 0 320 320" fill="none">
        <use
          className="fpl-dial-base"
          href={`${ART}loading-dial.svg#${variant === "inline" ? "compact" : "base"}`}
        />
        <g className="fpl-dial-sweep">
          <use href={`${ART}loading-dial.svg#sweep`} />
        </g>
        {variant !== "inline" ? (
          <>
            <g className="fpl-dial-tracers">
              <use href={`${ART}loading-dial.svg#tracers`} />
            </g>
            <g className="fpl-dial-comet">
              <use href={`${ART}loading-dial.svg#comet`} />
            </g>
            <g className="fpl-dial-energy">
              <use href={`${ART}loading-dial.svg#energy`} />
            </g>
            <g className="fpl-dial-particles">
              <use href={`${ART}loading-dial.svg#particles`} />
            </g>
            <use
              className="fpl-dial-scan"
              href={`${ART}loading-dial.svg#scan`}
            />
            <use
              className="fpl-dial-speed"
              href={`${ART}loading-dial.svg#speed`}
            />
          </>
        ) : null}
      </svg>
      <span className="fpl-scene-runner">
        <LoadingCharacter active={active} paused={paused || !inView} />
      </span>
      {props.map((name) => (
        <span className={`fpl-scene-prop fpl-scene-prop--${name}`} key={name}>
          <img
            src={`${ART}${name}.webp`}
            alt=""
            width={256}
            height={256}
            decoding="async"
          />
        </span>
      ))}
    </span>
  );
}
