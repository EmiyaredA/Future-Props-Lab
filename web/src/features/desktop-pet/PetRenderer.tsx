import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Application, Assets, Rectangle, type Texture } from "pixi.js";
import { fetchApiBlob } from "@platform/api/client";
import { createPoseMeshes } from "@shared/live2d/mesh";
import { idlePose } from "@shared/live2d/idle";
import { evaluate, parameterValues } from "@shared/live2d/pose";
import type { CharacterDocument } from "@shared/live2d/types";
import type { PetDocument } from "./api";
import type { PetHitRegion } from "./interaction";
import type { PetGeometry, PetPosePlayback } from "@platform/petMotion";
import {
  live2dPlayback,
  type PetPlaybackMode,
  type PetEvent,
} from "./playback";

export type PetRendererHandle = {
  hitTest: (x: number, y: number) => boolean;
  /** null is a painted miss; undefined/absent only means legacy classification is unsupported. */
  classifyHit?: (x: number, y: number) => PetHitRegion | undefined;
  pointerMove?: (x: number, y: number) => void;
  geometry?: () => PetGeometry | null;
  placementDelta?: () => { x: number; y: number };
  placementGeometry?: () => PetGeometry | null;
  /** Private rendered-world placement latch; token is the host cancellation generation. */
  beginPlacementHandoff?: (token: number) => boolean;
  commitPlacementHandoff?: (token: number) => boolean;
  cancelPlacementHandoff?: () => void;
  /** Last renderer reach/contact failure; the movement owner must cancel its trajectory. */
  motionFailure?: () => string | null;
  motionTransition?: () => PetPosePlayback | null;
  cancelMotionPlayback?: () => void;
};

export const PetRenderer = forwardRef<
  PetRendererHandle,
  {
    document: PetDocument;
    skinId?: string | null;
    eventName?: string;
    reactionKey?: number;
    className?: string;
    playbackMode?: PetPlaybackMode;
  }
>(function PetRenderer(
  {
    document,
    skinId,
    eventName,
    reactionKey = 0,
    className = "",
    playbackMode = "runtime",
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const [error, setError] = useState("");
  const character = document.character as CharacterDocument;
  const skin = document.config.skins?.find((item) => item.id === skinId);
  const replacements = skin?.replacements ?? {};
  const sourceIds = [
    ...new Set((character.parts ?? []).map((part) => part.assetId)),
  ];
  const textureUrls = sourceIds.map(
    (id) => document.assetUrls[replacements[id] ?? id],
  );
  const assetKey = textureUrls.join("|");
  const characterKey = JSON.stringify(character);
  const events = useRef(document.config.events);
  events.current = document.config.events;
  const playback = useRef({
    name: eventName ?? "idle",
    started: performance.now(),
    mode: playbackMode,
  });
  const reactionSignature = JSON.stringify([
    document.config.events?.[eventName as PetEvent],
    document.config.events?.idle,
  ]);

  useEffect(() => {
    playback.current = {
      name: eventName ?? "idle",
      started: performance.now(),
      mode: playbackMode,
    };
  }, [eventName, reactionKey, playbackMode, reactionSignature]);

  useImperativeHandle(ref, () => ({
    hitTest(x, y) {
      const app = appRef.current;
      const rect = host.current?.getBoundingClientRect();
      if (!app || !rect || !app.renderer || rect.width <= 0 || rect.height <= 0)
        return false;
      const px = Math.floor(
        ((x - rect.left) / rect.width) * app.renderer.width,
      );
      const py = Math.floor(
        ((y - rect.top) / rect.height) * app.renderer.height,
      );
      if (
        px < 0 ||
        py < 0 ||
        px >= app.renderer.width ||
        py >= app.renderer.height
      )
        return false;
      try {
        const { pixels } = app.renderer.extract.pixels({
          target: app.stage,
          frame: new Rectangle(px, py, 1, 1),
        });
        return pixels[3] > 24;
      } catch {
        return false;
      }
    },
  }));

  useEffect(() => {
    const element = canvasHost.current;
    if (!element) return;
    const controller = new AbortController();
    const objectUrls: string[] = [];
    let app: Application | null = null;
    let frame = 0;
    let resize: ResizeObserver | null = null;
    let stopped = false;
    setError("");

    void (async () => {
      const textures = new Map<string, Texture>();
      for (let index = 0; index < sourceIds.length; index++) {
        const href = textureUrls[index];
        if (!href) throw new Error("桌宠素材引用缺失");
        const blob = await fetchApiBlob(href, { signal: controller.signal });
        if (stopped) return;
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.push(objectUrl);
        textures.set(
          sourceIds[index],
          await Assets.load<Texture>({ src: objectUrl, parser: "texture" }),
        );
      }
      if (stopped) return;
      const application = new Application();
      await application.init({
        backgroundAlpha: 0,
        antialias: true,
        width: Math.max(1, element.clientWidth),
        height: Math.max(1, element.clientHeight),
        preference: "webgl",
        autoStart: false,
      });
      if (stopped) {
        application.destroy(true, { children: true });
        return;
      }
      app = application;
      appRef.current = application;
      application.ticker.stop();
      application.canvas.setAttribute("aria-hidden", "true");
      element.appendChild(application.canvas);
      const scene = createPoseMeshes(
        evaluate(character, parameterValues(character)).parts,
        textures,
      );
      application.stage.addChild(scene.container);
      const fit = () => {
        if (stopped) return;
        const width = Math.max(1, element.clientWidth);
        const height = Math.max(1, element.clientHeight);
        application.renderer.resize(width, height);
        const camera = character.cameras?.stage ?? {
          x: 0,
          y: 0,
          width: character.width,
          height: character.height,
        };
        const scale = Math.min(width / camera.width, height / camera.height);
        scene.container.scale.set(scale);
        scene.container.position.set(
          (width - camera.width * scale) / 2 - camera.x * scale,
          height - camera.height * scale - camera.y * scale,
        );
      };
      fit();
      playback.current.started = performance.now();
      resize = new ResizeObserver(fit);
      resize.observe(element);
      let last = 0;
      const tick = (now: number) => {
        if (stopped) return;
        frame = requestAnimationFrame(tick);
        if (globalThis.document.hidden || now - last < 1000 / 30) return;
        last = now;
        const active = playback.current;
        const elapsed = Math.max(0, now - active.started);
        const { reaction, clipFrame } = live2dPlayback(
          character,
          events.current,
          active.name,
          active.mode,
          elapsed,
        );
        const base = parameterValues(
          character,
          clipFrame,
          reaction?.motionId ?? undefined,
          reaction?.expressionId ?? undefined,
        );
        const pose = idlePose(
          character,
          base,
          now,
          reaction?.motionId,
          reaction?.expressionId,
        );
        scene.update(evaluate(character, pose.values, pose.rotations).parts);
        application.render();
      };
      frame = requestAnimationFrame(tick);
    })().catch((cause) => {
      if (!stopped && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "桌宠预览无法加载");
    });

    return () => {
      stopped = true;
      controller.abort();
      cancelAnimationFrame(frame);
      resize?.disconnect();
      appRef.current = null;
      if (app?.renderer) app.destroy(true, { children: true });
      for (const url of objectUrls) {
        void Assets.unload(url).catch(() => {});
        URL.revokeObjectURL(url);
      }
    };
    // A saved document is immutable until its revision or selected skin changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterKey, assetKey]);

  return (
    <div
      className={["dp-pet-renderer", className].filter(Boolean).join(" ")}
      ref={host}
    >
      <div className="dp-pet-canvas" ref={canvasHost} />
      {error && (
        <span className="dp-render-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
});
