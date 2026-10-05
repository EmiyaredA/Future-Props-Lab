import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useId,
  useRef,
  useState,
} from "react";
import { createPet, type WhaleController } from "./whale-vendor/pet-core.js";
import {
  createWhaleFigure,
  type WhaleFigure,
  type LoadedWhaleFigure,
} from "./whale-vendor/whale/figure.js";
import type { PetDocument } from "./api";
import type { PetRendererHandle } from "./PetRenderer";
import { createHumanFigure, type HumanModel } from "./humanFigure";
import {
  MOTION_LABELS,
  reactionFor,
  reactionMotionUnavailable,
  type PetEvent,
  type PetPlaybackMode,
} from "./playback";
import { modelSequences } from "./sequences/capabilities";
import {
  unshiftGeometry,
  type PetMotionFrame,
  type PetGeometry,
} from "@platform/petMotion";
import { createFigureGeometrySampler } from "./locomotion/measure";
import { demoMotion, type MotionDemo } from "./locomotion/demo";
import { readFrameSequences } from "./sequences/validation";
import { createSequenceFigure } from "./sequences/figure";

type Props = {
  document: PetDocument;
  skinId?: string | null;
  eventName?: string;
  reactionKey?: number;
  view?: "center" | "floor";
  dragged?: boolean;
  playbackMode?: PetPlaybackMode;
  locomotion?: PetMotionFrame | null;
  motionDemo?: MotionDemo | null;
};

type ReactionInput = {
  key: number;
  event: string;
  mode: PetPlaybackMode;
  signature: string;
};

/** UI playback keys and inspect edits are intent; runtime activity is not. */
function explicitAssetRetry(previous: ReactionInput, current: ReactionInput) {
  const newKey = current.key !== previous.key;
  if (current.mode === "runtime")
    return newKey && ["click", "pet", "grab", "drop"].includes(current.event);
  if (current.mode === "inspect")
    return (
      newKey ||
      current.event !== previous.event ||
      current.mode !== previous.mode ||
      current.signature !== previous.signature
    );
  return (
    newKey ||
    (current.event === previous.event &&
      current.signature !== previous.signature)
  );
}

function applyReaction(
  pet: WhaleController,
  name: string,
  document: PetDocument,
  mode: PetPlaybackMode,
  retryAssetLoad?: () => void,
) {
  const reaction =
    name === "chatThinking"
      ? { motionId: "look", expressionId: "thinking" }
      : name === "chatSpeaking"
        ? { motionId: "nod", expressionId: "happy" }
        : reactionFor(document, name as PetEvent);
  const motion = reaction.motionId ?? null;
  const resource = modelSequences(document.whaleModel);
  // Classification is structural, never inferred from a translated reason.
  const rejection =
    resource.kind === "invalid"
      ? "invalid-motion-resource"
      : motion && !Object.hasOwn(MOTION_LABELS, motion)
        ? "unknown-motion-resource"
        : reactionMotionUnavailable(document, motion)
          ? "unsupported-motion-resource"
          : null;
  const hold =
    name === "chatThinking" || name === "chatSpeaking"
      ? false
      : mode === "inspect" || name === "idle";
  if (rejection)
    pet.replaceRejectedReaction(
      motion,
      reaction.expressionId ?? null,
      hold,
      rejection,
    );
  else {
    retryAssetLoad?.();
    pet.replaceReaction(motion, reaction.expressionId ?? null, hold);
  }
}

export const WhaleRenderer = forwardRef<PetRendererHandle, Props>(
  function WhaleRenderer(
    {
      document,
      skinId,
      eventName = "idle",
      reactionKey = 0,
      view = "floor",
      dragged = false,
      playbackMode = "runtime",
      locomotion = null,
      motionDemo = null,
    },
    ref,
  ) {
    const host = useRef<HTMLDivElement>(null);
    const petGroup = useRef<SVGGElement>(null);
    const shadow = useRef<SVGEllipseElement>(null);
    const shadowId = `pet-shadow-${useId().replaceAll(":", "")}`;
    const effects = useRef<SVGGElement>(null);
    const controller = useRef<WhaleController | null>(null);
    const figure = useRef<WhaleFigure | null>(null);
    const [error, setError] = useState("");
    const [schemeError, setSchemeError] = useState("");
    const [assetError, setAssetError] = useState("");
    const [geometrySampler] = useState(createFigureGeometrySampler);
    useEffect(() => () => geometrySampler.dispose(), [geometrySampler]);
    const schemeSelection = useRef({ generation: 0 });
    const assetMap = document.whaleAssets ?? {};
    const assetUrls = document.assetUrls;
    const reactionSignature = JSON.stringify([
      document.config.events?.[eventName as PetEvent],
      document.config.events?.idle,
    ]);
    const previousReactionInput = useRef<ReactionInput>({
      key: reactionKey,
      event: eventName,
      mode: playbackMode,
      signature: reactionSignature,
    });
    const resourceKey = JSON.stringify([
      document.whaleModel,
      assetMap,
      assetUrls,
    ]);
    const scheme = skinId || document.config.schemeId || "deepseek";
    const latest = useRef({
      scheme,
      eventName,
      document,
      playbackMode,
      resourceKey,
    });
    latest.current = { scheme, eventName, document, playbackMode, resourceKey };
    const changeScheme = useCallback((target: WhaleFigure, id: string) => {
      const generation = ++schemeSelection.current.generation;
      const resource = latest.current.resourceKey;
      const isCurrent = () =>
        generation === schemeSelection.current.generation &&
        figure.current === target &&
        latest.current.scheme === id &&
        latest.current.resourceKey === resource;
      void (async () => {
        await target.setScheme(id, { fade: 0.35 });
        if (isCurrent()) setSchemeError("");
      })().catch((cause: unknown) => {
        if (isCurrent())
          setSchemeError(
            cause instanceof Error ? cause.message : "桌宠换装失败",
          );
      });
    }, []);
    const finishAt = useRef(Infinity);
    const movement = useRef(locomotion);
    movement.current = locomotion;
    const demo = useRef({ name: motionDemo, started: performance.now() });
    useEffect(() => {
      demo.current = { name: motionDemo, started: performance.now() };
    }, [motionDemo, reactionKey]);
    const measured = useRef<{
      at: number;
      value: PetGeometry | null;
    }>({ at: 0, value: null });
    const neutral = useRef<PetGeometry | null>(null);

    useImperativeHandle(ref, () => ({
      motionFailure() {
        return (
          figure.current?.getMotionFailure?.() ??
          controller.current?.getReactionFailure?.() ??
          null
        );
      },
      motionTransition() {
        return figure.current?.getMotionTransition?.() ?? null;
      },
      cancelMotionPlayback() {
        if (controller.current?.cancelPlacementHandoff?.())
          movement.current = null;
        measured.current = { at: 0, value: null };
        figure.current?.cancelMotionPlayback?.();
      },
      beginPlacementHandoff(token) {
        const started =
          controller.current?.beginPlacementHandoff?.(token) ?? false;
        if (started) measured.current = { at: 0, value: null };
        return started;
      },
      commitPlacementHandoff(token) {
        const committed =
          controller.current?.commitPlacementHandoff?.(token) ?? false;
        if (committed) measured.current = { at: 0, value: null };
        return committed;
      },
      cancelPlacementHandoff() {
        if (controller.current?.cancelPlacementHandoff?.())
          movement.current = null;
        measured.current = { at: 0, value: null };
      },
      placementDelta() {
        return controller.current?.placementDelta() ?? { x: 0, y: 0 };
      },
      placementGeometry() {
        const origin = host.current?.getBoundingClientRect();
        return neutral.current && origin
          ? unshiftGeometry(neutral.current, {
              x: -origin.left,
              y: -origin.top,
            })
          : null;
      },
      geometry() {
        if (!petGroup.current) return null;
        if (
          performance.now() - measured.current.at >= 16 ||
          !measured.current.value
        )
          measured.current = {
            at: performance.now(),
            value: geometrySampler.measure(petGroup.current),
          };
        const shape = measured.current.value;
        if (
          shape &&
          movement.current?.state === "idle" &&
          !petGroup.current.hasAttribute("data-pet-edges")
        ) {
          const origin = host.current!.getBoundingClientRect();
          neutral.current = unshiftGeometry(shape, {
            x: origin.left,
            y: origin.top,
          });
        }
        return shape;
      },
      hitTest(x, y) {
        const bounds = host.current?.getBoundingClientRect();
        return Boolean(
          bounds &&
          controller.current?.hitPet({ x: x - bounds.left, y: y - bounds.top }),
        );
      },
      pointerMove(x, y) {
        const bounds = host.current?.getBoundingClientRect();
        if (bounds)
          controller.current?.pointerMove({
            x: x - bounds.left,
            y: y - bounds.top,
          });
      },
    }));

    useEffect(() => {
      const element = host.current;
      if (
        !element ||
        !petGroup.current ||
        !shadow.current ||
        !effects.current ||
        !document.whaleModel
      )
        return;
      let stopped = false;
      let frame = 0;
      let observer: ResizeObserver | null = null;
      const selection = schemeSelection.current;
      const group = petGroup.current;
      neutral.current = null;
      const fx = effects.current;
      setError("");
      setSchemeError("");
      setAssetError("");
      void (async () => {
        const options = {
          model: document.whaleModel as Record<string, unknown>,
          scheme,
          asset: (path: string) => {
            const id = assetMap[path];
            const url = id && assetUrls[id];
            if (!url) throw new Error(`桌宠贴图缺失：${path}`);
            return url;
          },
        };
        const sequences = readFrameSequences(options.model.frameSequences);
        const original =
          options.model.rigProfile === "human-chibi"
            ? await createHumanFigure({
                ...options,
                model: options.model as unknown as HumanModel,
              })
            : await createWhaleFigure(undefined, options);
        const schemes = options.model.schemes as { id: string }[];
        let whale: WhaleFigure & Pick<LoadedWhaleFigure, "draw"> = original;
        if (sequences) {
          try {
            whale = createSequenceFigure({
              base: original,
              sequences,
              scheme,
              defaultScheme: schemes[0].id,
              asset: options.asset,
            });
          } catch (cause) {
            // Until wrapping succeeds, this initializer owns the loaded base.
            original.dispose?.();
            throw cause;
          }
        }
        if (stopped) {
          whale.dispose?.();
          return;
        }
        figure.current = whale;
        const silent = new Proxy({}, { get: () => () => undefined });
        const pet = createPet(
          { petG: group, shadowEl: shadow.current!, fxG: fx },
          {
            figure: whale,
            sfx: silent,
            roam: "off",
            walkInPlace: true,
            startX: element.clientWidth / 2,
            // AX/AY and this viewport origin are DIP. The figure's model scale
            // is already inside its SVG transform and must not scale screen deltas.
            viewportOrigin: () => {
              const rect = element.getBoundingClientRect();
              return {
                x: window.screenX + rect.left,
                y: window.screenY + rect.top,
              };
            },
            bounds: () => {
              const width = element.clientWidth;
              const height = element.clientHeight;
              const scale = Math.min(
                1.8,
                Math.min(width / 260, height / 320) * 1.25,
              );
              return {
                W: width,
                H: height,
                floorY:
                  view === "center" ? height / 2 + 128 * scale : height - 8,
                S: scale,
              };
            },
          },
        );
        controller.current = pet;
        const current = latest.current;
        if (current.scheme !== scheme) changeScheme(whale, current.scheme);
        applyReaction(
          pet,
          current.eventName,
          current.document,
          current.playbackMode,
        );
        finishAt.current =
          current.playbackMode === "event" && current.eventName !== "idle"
            ? performance.now() + 1800
            : Infinity;
        observer = new ResizeObserver(() => {
          if (pet.cancelPlacementHandoff?.()) movement.current = null;
          pet.resize();
        });
        observer.observe(element);
        let last = performance.now();
        let lastAssetError: string | null = null;
        const tick = (now: number) => {
          if (stopped) return;
          frame = requestAnimationFrame(tick);
          if (globalThis.document.hidden) {
            last = now;
            return;
          }
          const physical = movement.current
            ? movement.current
            : demo.current.name
              ? demoMotion(
                  demo.current.name,
                  (now - demo.current.started) / 1000,
                  measured.current.value?.strideLength,
                )
              : movement.current;
          const origin = element.getBoundingClientRect();
          pet.setLocomotion(
            physical?.grip
              ? {
                  ...physical,
                  grip: {
                    x: physical.grip.x - origin.left,
                    y: physical.grip.y - origin.top,
                  },
                }
              : physical?.state === "held"
                ? {
                    ...physical,
                    grip: {
                      x: element.clientWidth * 0.6,
                      y: element.clientHeight * 0.45,
                    },
                  }
                : physical,
          );
          pet.step(Math.min(0.05, (now - last) / 1000));
          if (now >= finishAt.current) {
            finishAt.current = Infinity;
            applyReaction(pet, "idle", latest.current.document, "runtime");
          }
          last = now;
          pet.render();
          const loadError = whale.getAssetFailure?.() ?? null;
          if (loadError !== lastAssetError) {
            lastAssetError = loadError;
            setAssetError(loadError ?? "");
          }
          // Even within the 16ms readback window the actual CTM may have
          // changed through placement compensation or resize since the last read.
          measured.current = { at: 0, value: null };
          if (demo.current.name && petGroup.current)
            measured.current = {
              at: now,
              value: geometrySampler.measure(petGroup.current),
            };
        };
        frame = requestAnimationFrame(tick);
      })().catch((cause) => {
        if (!stopped)
          setError(cause instanceof Error ? cause.message : "桌宠无法加载");
      });
      return () => {
        stopped = true;
        selection.generation++;
        cancelAnimationFrame(frame);
        observer?.disconnect();
        controller.current?.cancelPlacementHandoff?.();
        controller.current = null;
        figure.current?.dispose?.();
        figure.current = null;
        for (const canvas of group.querySelectorAll("canvas")) {
          canvas
            .getContext("webgl2")
            ?.getExtension("WEBGL_lose_context")
            ?.loseContext();
        }
        group.replaceChildren();
        fx.replaceChildren();
      };
      // The imported snapshot is immutable until its project revision changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resourceKey, view, changeScheme]);

    useEffect(() => {
      if (figure.current) changeScheme(figure.current, scheme);
    }, [scheme, changeScheme]);

    useEffect(() => {
      const input: ReactionInput = {
        key: reactionKey,
        event: eventName,
        mode: playbackMode,
        signature: reactionSignature,
      };
      const retry = explicitAssetRetry(previousReactionInput.current, input);
      previousReactionInput.current = input;
      const pet = controller.current;
      if (pet) {
        const current = latest.current;
        applyReaction(
          pet,
          current.eventName,
          current.document,
          current.playbackMode,
          retry ? () => figure.current?.retryAssetLoad?.() : undefined,
        );
        finishAt.current =
          current.playbackMode === "event" && current.eventName !== "idle"
            ? performance.now() + 1800
            : Infinity;
      }
    }, [reactionSignature, eventName, reactionKey, playbackMode]);

    return (
      <div className="dp-pet-renderer dp-whale-renderer" ref={host}>
        <svg aria-hidden="true" width="100%" height="100%">
          <defs>
            <radialGradient id={shadowId}>
              <stop offset="0" stopColor="#192027" />
              <stop offset="0.45" stopColor="#192027" stopOpacity="0.55" />
              <stop offset="1" stopColor="#192027" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g
            opacity={
              dragged ||
              motionDemo ||
              eventName === "grab" ||
              (locomotion &&
                ["held", "climb", "glide"].includes(locomotion.state))
                ? 0
                : 1
            }
            data-contact-shadow
          >
            <ellipse ref={shadow} fill={`url(#${shadowId})`} opacity="0.12" />
          </g>
          <g ref={petGroup} />
          <g ref={effects} />
        </svg>
        {(error || schemeError || assetError) && (
          <span className="dp-render-error" role="alert">
            {error || schemeError || assetError}
          </span>
        )}
      </div>
    );
  },
);
