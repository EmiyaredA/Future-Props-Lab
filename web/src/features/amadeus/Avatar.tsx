import { useEffect, useRef, useState } from "react";
import { Application, Assets, type Texture } from "pixi.js";
import { createPoseMeshes } from "@shared/live2d/mesh";
import { evaluate, parameterValues } from "@shared/live2d/pose";
import { AMADEUS_POSTER_URL } from "@shared/live2d/bundled";
import { boundPose, loadAmadeusModel } from "./avatarModel";
import { avatarStateLabels, type AvatarState } from "./protocol";

type Playback = {
  state: AvatarState;
  elapsed: number;
  transition: number;
  from: Record<string, number> | null;
  dirty: boolean;
};

const ONE_SHOT = new Set<AvatarState>(["success", "error", "paused"]);

export function AmadeusAvatar({ state }: { state: AvatarState }) {
  const host = useRef<HTMLSpanElement>(null);
  const canvasHost = useRef<HTMLSpanElement>(null);
  const playback = useRef<Playback>({
    state,
    elapsed: 0,
    transition: 0,
    from: null,
    dirty: true,
  });
  const lastValues = useRef<Record<string, number> | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const previous = playback.current;
    if (previous.state === state) return;
    playback.current = {
      state,
      elapsed: 0,
      transition: 0,
      from: lastValues.current ? { ...lastValues.current } : null,
      dirty: true,
    };
  }, [state]);

  useEffect(() => {
    const element = canvasHost.current;
    const frame = host.current;
    if (!element || !frame) return;
    let stopped = false;
    let animation = 0;
    let app: Application | null = null;
    let lastTick = performance.now();
    let lastRender = 0;
    let intersecting = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            intersecting = entry.isIntersecting;
          });
    observer?.observe(frame);
    const onMotion = () => {
      playback.current.dirty = true;
    };
    reduced.addEventListener("change", onMotion);

    void (async () => {
      const { document: model, urls } = await loadAmadeusModel();
      if (stopped) return;
      const application = new Application();
      app = application;
      await application.init({
        backgroundAlpha: 0,
        antialias: true,
        width: 256,
        height: 256,
        preference: "webgl",
        autoStart: false,
      });
      if (stopped) {
        application.destroy(true, { children: true });
        return;
      }
      application.ticker.stop();
      application.canvas.setAttribute("aria-hidden", "true");
      element.appendChild(application.canvas);
      const textures = new Map<string, Texture>();
      for (const [assetId, url] of urls) {
        textures.set(
          assetId,
          await Assets.load<Texture>({ src: url, parser: "texture" }),
        );
        if (stopped) return;
      }
      const initial = evaluate(model, parameterValues(model));
      const scene = createPoseMeshes(initial.parts, textures);
      scene.container.scale.set(256 / model.width, 256 / model.height);
      application.stage.addChild(scene.container);
      let shown = false;

      const tick = (now: number) => {
        if (stopped) return;
        const delta = Math.min(100, Math.max(0, now - lastTick));
        lastTick = now;
        const active = !window.document.hidden && intersecting;
        const still = reduced.matches;
        const request = () => {
          animation = requestAnimationFrame(tick);
        };
        if (
          !active ||
          (still && !playback.current.dirty) ||
          (!still && now - lastRender < 1000 / 30)
        ) {
          request();
          return;
        }
        lastRender = now;
        const current = playback.current;
        if (!still) {
          current.elapsed += delta;
          current.transition += delta;
        }
        const { motion, expressionId } = boundPose(model, current.state);
        const frameNumber = still
          ? ONE_SHOT.has(current.state)
            ? motion.duration
            : 0
          : ONE_SHOT.has(current.state)
            ? Math.min(motion.duration, (current.elapsed * motion.fps) / 1000)
            : ((current.elapsed * motion.fps) / 1000) % motion.loopEnd;
        const target = parameterValues(
          model,
          frameNumber,
          motion.id,
          expressionId,
        );
        const blend = still ? 1 : Math.min(1, current.transition / 180);
        const values =
          current.from && blend < 1
            ? Object.fromEntries(
                Object.entries(target).map(([key, value]) => [
                  key,
                  (current.from?.[key] ?? value) * (1 - blend) + value * blend,
                ]),
              )
            : target;
        lastValues.current = values;
        current.dirty = false;
        scene.update(evaluate(model, values).parts);
        application.render();
        if (!shown) {
          shown = true;
          setReady(true);
        }
        request();
      };
      animation = requestAnimationFrame(tick);
    })().catch(() => {
      if (!stopped) setFailed(true);
    });

    return () => {
      stopped = true;
      cancelAnimationFrame(animation);
      observer?.disconnect();
      reduced.removeEventListener("change", onMotion);
      if (app?.renderer) app.destroy(true, { children: true });
    };
  }, []);

  return (
    <span
      ref={host}
      className={`amadeus-avatar${ready && !failed ? " amadeus-avatar-ready" : ""}`}
      role="img"
      aria-label={`Amadeus：${avatarStateLabels[state]}`}
      data-avatar-state={state}
      data-avatar-renderer={failed ? "poster" : ready ? "model" : "loading"}
    >
      <img src={AMADEUS_POSTER_URL} alt="" className="amadeus-avatar-poster" />
      <span
        ref={canvasHost}
        className="amadeus-avatar-canvas"
        aria-hidden="true"
      />
    </span>
  );
}
