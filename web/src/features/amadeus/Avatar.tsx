import { useEffect, useRef, useState } from "react";
import { Application, Assets, type Texture } from "pixi.js";
import {
  AMADEUS_PACKAGE_URL,
  AMADEUS_POSTER_URL,
  AMADEUS_STAGE_POSTER_URL,
} from "@shared/live2d/bundled";
import { renderStaticPose } from "@shared/live2d/fallback";
import { idlePose } from "@shared/live2d/idle";
import { createPoseMeshes } from "@shared/live2d/mesh";
import { evaluate, parameterValues } from "@shared/live2d/pose";
import type { Camera, CharacterDocument } from "@shared/live2d/types";
import { boundPose, loadCharacterModel } from "./avatarModel";
import { avatarStateLabels, type AvatarState } from "./protocol";

type Playback = {
  state: AvatarState;
  elapsed: number;
  transition: number;
  from: Record<string, number> | null;
};

function viewCamera(
  model: CharacterDocument,
  name: "avatar" | "stage",
  width: number,
  height: number,
): Camera {
  const camera = model.cameras?.[name] ?? {
    x: 0,
    y: 0,
    width: model.width,
    height: model.height,
  };
  if (name === "avatar") return camera;
  const ratio = width / height;
  if (ratio < camera.width / camera.height) {
    const cropWidth = camera.height * ratio;
    return {
      ...camera,
      x: camera.x + (camera.width - cropWidth) / 2,
      width: cropWidth,
    };
  }
  const cropHeight = camera.width / ratio;
  return {
    ...camera,
    y: camera.y + camera.height - cropHeight,
    height: cropHeight,
  };
}

function statePose(
  model: CharacterDocument,
  state: AvatarState,
  elapsedMs: number,
  still: boolean,
) {
  const { motion, expressionId } = boundPose(model, state);
  const once = model.stateBindings[state]?.playback === "onceHold";
  const frame = still
    ? once
      ? motion.duration
      : 0
    : once
      ? Math.min(motion.duration, (elapsedMs * motion.fps) / 1000)
      : ((elapsedMs * motion.fps) / 1000) % motion.loopEnd;
  const base = parameterValues(model, frame, motion.id, expressionId);
  return still
    ? { values: base, rotations: {} as Record<string, number> }
    : idlePose(model, base, performance.now(), motion.id, expressionId);
}

export function AmadeusAvatar({
  state,
  camera = "avatar",
  sourceUrl = AMADEUS_PACKAGE_URL,
}: {
  state: AvatarState;
  camera?: "avatar" | "stage";
  sourceUrl?: string;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const canvasHost = useRef<HTMLSpanElement>(null);
  const playback = useRef<Playback>({
    state,
    elapsed: 0,
    transition: 0,
    from: null,
  });
  const lastValues = useRef<Record<string, number> | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fallback, setFallback] = useState(
    camera === "avatar" ? AMADEUS_POSTER_URL : AMADEUS_STAGE_POSTER_URL,
  );
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = () => setReduced(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  useEffect(() => {
    if (playback.current.state === state) return;
    playback.current = {
      state,
      elapsed: 0,
      transition: 0,
      from: lastValues.current ? { ...lastValues.current } : null,
    };
    if (reduced || failed)
      void loadCharacterModel(sourceUrl)
        .then(async ({ document: model, urls }) => {
          const { motion, expressionId } = boundPose(model, state);
          const frame =
            model.stateBindings[state]?.playback === "onceHold"
              ? motion.duration
              : 0;
          const pose = evaluate(
            model,
            parameterValues(model, frame, motion.id, expressionId),
          );
          const width = camera === "avatar" ? 256 : 360;
          const height = camera === "avatar" ? 256 : 720;
          setFallback(
            await renderStaticPose(
              pose.parts,
              urls,
              viewCamera(model, camera, width, height),
              width,
              height,
            ),
          );
        })
        .catch(() => {});
  }, [state, reduced, failed, sourceUrl, camera]);

  useEffect(() => {
    const element = canvasHost.current;
    const frame = host.current;
    if (!element || !frame) return;
    let stopped = false;
    let animation = 0;
    let app: Application | null = null;
    let resize: ResizeObserver | null = null;
    let lastTick = performance.now();
    let lastRender = 0;
    let intersecting = true;
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            intersecting = entry.isIntersecting;
          });
    observer?.observe(frame);
    setReady(false);
    setFailed(false);
    setFallback(
      camera === "avatar" ? AMADEUS_POSTER_URL : AMADEUS_STAGE_POSTER_URL,
    );

    void (async () => {
      const { document: model, urls } = await loadCharacterModel(sourceUrl);
      if (stopped) return;
      const fallbackWidth = camera === "avatar" ? 256 : 360;
      const fallbackHeight = camera === "avatar" ? 256 : 720;
      const stillPose = statePose(model, playback.current.state, 0, true);
      const stillImage = await renderStaticPose(
        evaluate(model, stillPose.values).parts,
        urls,
        viewCamera(model, camera, fallbackWidth, fallbackHeight),
        fallbackWidth,
        fallbackHeight,
      );
      if (stopped) return;
      setFallback(stillImage);
      if (reduced) return;

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
      const scene = createPoseMeshes(
        evaluate(model, parameterValues(model)).parts,
        textures,
      );
      application.stage.addChild(scene.container);
      const fit = () => {
        if (!app || stopped) return;
        const width =
          camera === "avatar" ? 256 : Math.max(1, element.clientWidth);
        const height =
          camera === "avatar" ? 256 : Math.max(1, element.clientHeight);
        application.renderer.resize(width, height);
        const crop = viewCamera(model, camera, width, height);
        scene.container.scale.set(width / crop.width, height / crop.height);
        scene.container.position.set(
          (-crop.x * width) / crop.width,
          (-crop.y * height) / crop.height,
        );
      };
      fit();
      resize = new ResizeObserver(fit);
      resize.observe(element);
      let shown = false;
      const tick = (now: number) => {
        if (stopped) return;
        const delta = Math.min(100, Math.max(0, now - lastTick));
        lastTick = now;
        animation = requestAnimationFrame(tick);
        if (document.hidden || !intersecting || now - lastRender < 1000 / 30)
          return;
        lastRender = now;
        const current = playback.current;
        current.elapsed += delta;
        current.transition += delta;
        const target = statePose(model, current.state, current.elapsed, false);
        const blend = Math.min(1, current.transition / 180);
        const values =
          current.from && blend < 1
            ? Object.fromEntries(
                Object.entries(target.values).map(([key, value]) => [
                  key,
                  (current.from?.[key] ?? value) * (1 - blend) + value * blend,
                ]),
              )
            : target.values;
        lastValues.current = values;
        scene.update(evaluate(model, values, target.rotations).parts);
        application.render();
        if (!shown) {
          shown = true;
          setReady(true);
        }
      };
      animation = requestAnimationFrame(tick);
    })().catch(() => {
      if (!stopped) setFailed(true);
    });

    return () => {
      stopped = true;
      cancelAnimationFrame(animation);
      resize?.disconnect();
      observer?.disconnect();
      if (app?.renderer) app.destroy(true, { children: true });
      element.replaceChildren();
    };
  }, [sourceUrl, camera, reduced]);

  const visible = ready && !failed && !reduced;
  return (
    <span
      ref={host}
      className={`amadeus-avatar${visible ? " amadeus-avatar-ready" : ""}`}
      role="img"
      aria-label={`Amadeus：${avatarStateLabels[state]}`}
      data-avatar-state={state}
      data-avatar-camera={camera}
      data-avatar-renderer={
        visible ? "model" : failed || reduced ? "poster" : "loading"
      }
    >
      <img src={fallback} alt="" className="amadeus-avatar-poster" />
      <span
        ref={canvasHost}
        className="amadeus-avatar-canvas"
        aria-hidden="true"
      />
    </span>
  );
}
