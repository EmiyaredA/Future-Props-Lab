import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPet, type WhaleController } from "./whale-vendor/pet-core.js";
import {
  createWhaleFigure,
  type WhaleFigure,
} from "./whale-vendor/whale/figure.js";
import type { PetDocument } from "./api";
import type { PetRendererHandle } from "./PetRenderer";

type Props = {
  document: PetDocument;
  skinId?: string | null;
  eventName?: string;
  reactionKey?: number;
  view?: "center" | "floor";
};

function applyReaction(
  pet: WhaleController,
  name: string,
  events: PetDocument["config"]["events"],
) {
  if (name === "idle") return;
  if (name === "chatThinking") {
    pet.act("look");
    pet.setExpr("thinking", 2);
    return;
  }
  if (name === "chatSpeaking") {
    pet.act("nod");
    pet.setExpr("happy", 2);
    return;
  }
  const reaction = events?.[name as keyof typeof events];
  const defaults: Record<string, string> = {
    click: "hop",
    pet: "nod",
    grab: "look",
    drop: "stand",
    roam: "walk",
  };
  const motion = reaction?.motionId || defaults[name];
  if (motion) pet.act(motion);
  if (reaction?.expressionId) pet.setExpr(reaction.expressionId, 2);
}

export const WhaleRenderer = forwardRef<PetRendererHandle, Props>(
  function WhaleRenderer(
    { document, skinId, eventName = "idle", reactionKey = 0, view = "floor" },
    ref,
  ) {
    const host = useRef<HTMLDivElement>(null);
    const petGroup = useRef<SVGGElement>(null);
    const shadow = useRef<SVGEllipseElement>(null);
    const effects = useRef<SVGGElement>(null);
    const controller = useRef<WhaleController | null>(null);
    const figure = useRef<WhaleFigure | null>(null);
    const [error, setError] = useState("");
    const assetMap = document.whaleAssets ?? {};
    const assetUrls = document.assetUrls;
    const events = document.config.events;
    const scheme = skinId || document.config.schemeId || "deepseek";
    const latest = useRef({ scheme, eventName, events });
    latest.current = { scheme, eventName, events };

    useImperativeHandle(ref, () => ({
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
      const group = petGroup.current;
      const fx = effects.current;
      setError("");
      void (async () => {
        const whale = await createWhaleFigure(undefined, {
          model: document.whaleModel as Record<string, unknown>,
          scheme,
          asset: (path) => {
            const id = assetMap[path];
            const url = id && assetUrls[id];
            if (!url) throw new Error(`鲸鱼娘贴图缺失：${path}`);
            return url;
          },
        });
        if (stopped) return;
        figure.current = whale;
        const silent = new Proxy({}, { get: () => () => undefined });
        const pet = createPet(
          { petG: group, shadowEl: shadow.current!, fxG: fx },
          {
            figure: whale,
            sfx: silent,
            roam: "off",
            startX: element.clientWidth / 2,
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
        if (current.scheme !== scheme)
          void whale.setScheme(current.scheme, { fade: 0.35 });
        applyReaction(pet, current.eventName, current.events);
        observer = new ResizeObserver(() => pet.resize());
        observer.observe(element);
        let last = performance.now();
        const tick = (now: number) => {
          if (stopped) return;
          frame = requestAnimationFrame(tick);
          if (globalThis.document.hidden) {
            last = now;
            return;
          }
          pet.step(Math.min(0.05, (now - last) / 1000));
          last = now;
          pet.render();
        };
        frame = requestAnimationFrame(tick);
      })().catch((cause) => {
        if (!stopped)
          setError(cause instanceof Error ? cause.message : "鲸鱼娘无法加载");
      });
      return () => {
        stopped = true;
        cancelAnimationFrame(frame);
        observer?.disconnect();
        controller.current = null;
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
    }, [document.revision, view]);

    useEffect(() => {
      void figure.current?.setScheme(scheme, { fade: 0.35 });
    }, [scheme]);

    useEffect(() => {
      const pet = controller.current;
      if (pet) applyReaction(pet, eventName, events);
    }, [events, eventName, reactionKey]);

    return (
      <div className="dp-pet-renderer dp-whale-renderer" ref={host}>
        <svg aria-hidden="true" width="100%" height="100%">
          <ellipse ref={shadow} fill="#192027" opacity="0.16" />
          <g ref={petGroup} />
          <g ref={effects} />
        </svg>
        {error && (
          <span className="dp-render-error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  },
);
