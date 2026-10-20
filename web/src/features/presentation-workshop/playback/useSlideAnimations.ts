import { useLayoutEffect, useMemo, useState, type RefObject } from "react";
import type { Slide } from "../types";
import { animationFrames, animationGroups } from "./animationModel";

export function useSlideAnimations(
  slide: Slide,
  root: RefObject<HTMLDivElement | null>,
  step: number,
) {
  const [running, setRunning] = useState(false);
  const groups = useMemo(() => animationGroups(slide), [slide]);
  useLayoutEffect(() => {
    let active = true;
    const animations: Animation[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const elements = new Map(
      [
        ...(root.current?.querySelectorAll<HTMLElement>("[data-element-id]") ??
          []),
      ].map((node) => [
        node.dataset.elementId,
        node.querySelector<HTMLElement>(".presentation-element-content"),
      ]),
    );
    for (const node of elements.values())
      if (node) {
        node.style.visibility = "visible";
        node.style.opacity = "";
        node.style.transform = "";
      }
    for (const animation of slide.animations ?? []) {
      if (animation.type === "in") {
        const node = elements.get(animation.element_id);
        if (node) node.style.visibility = "hidden";
      }
    }
    // Reconstruct earlier click groups without replaying them.
    for (const group of groups.slice(0, Math.max(0, step - 1)))
      for (const animation of group) {
        const node = elements.get(animation.element_id);
        if (node && animation.type !== "emphasis")
          node.style.visibility =
            animation.type === "out" ? "hidden" : "visible";
      }
    const group = groups[step - 1];
    if (group) {
      let previousStart = 0,
        previousEnd = 0,
        end = 0;
      for (const animation of group) {
        const start =
          (animation.trigger === "with_previous"
            ? previousStart
            : animation.trigger === "after_previous"
              ? previousEnd
              : 0) + animation.delay;
        previousStart = start;
        previousEnd = start + animation.duration;
        end = Math.max(end, previousEnd);
        timers.push(
          setTimeout(() => {
            if (!active) return;
            const node = elements.get(animation.element_id);
            if (!node) return;
            node.style.visibility = "visible";
            if (node.animate) {
              const player = node.animate(animationFrames(animation), {
                duration: animation.duration,
                easing: "ease-in-out",
                fill: "forwards",
              });
              animations.push(player);
              void player.finished
                .then(() => {
                  if (active && animation.type === "out")
                    node.style.visibility = "hidden";
                })
                .catch(() => {});
            } else if (animation.type === "out")
              node.style.visibility = "hidden";
          }, start),
        );
      }
      setRunning(true);
      timers.push(
        setTimeout(() => {
          if (active) setRunning(false);
        }, end),
      );
    } else setRunning(false);
    return () => {
      active = false;
      timers.forEach(clearTimeout);
      animations.forEach((a) => a.cancel());
    };
  }, [slide, step, root, groups]);
  return { groups: groups.length, running };
}
