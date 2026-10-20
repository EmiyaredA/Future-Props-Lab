import type { Slide } from "../types";
export type SlideAnimation = NonNullable<Slide["animations"]>[number];
export const effects = [
  "fade",
  "slide",
  "zoom",
  "rotate",
  "bounce",
  "flip",
  "back",
  "lightSpeed",
  "pulse",
  "shake",
  "swing",
  "tada",
  "wobble",
  "heartBeat",
] as const;
export const effectLabels = [
  "浮现",
  "滑动",
  "缩放",
  "旋转",
  "弹跳",
  "翻转",
  "放大滑入",
  "飞入",
  "脉冲",
  "摇动",
  "摆动",
  "跳跃",
  "晃动",
  "心跳",
];

/** Click groups are deterministic; with/after events share a single click boundary. */
export function animationGroups(slide: Slide) {
  const groups: SlideAnimation[][] = [];
  for (const animation of slide.animations ?? []) {
    if (!slide.elements.some((e) => e.id === animation.element_id && !e.hidden))
      continue;
    if (animation.trigger === "click" || !groups.length) groups.push([]);
    groups.at(-1)!.push(animation);
  }
  return groups;
}

export function animationFrames(animation: SlideAnimation): Keyframe[] {
  const distance = animation.effect === "lightSpeed" ? "120%" : "80%";
  const translation =
    animation.direction === "left"
      ? `translateX(-${distance})`
      : animation.direction === "right"
        ? `translateX(${distance})`
        : animation.direction === "top"
          ? `translateY(-${distance})`
          : `translateY(${distance})`;
  const base: Record<string, Keyframe[]> = {
    fade: [{ opacity: 0 }, { opacity: 1 }],
    slide: [
      { transform: translation, opacity: 0 },
      { transform: "none", opacity: 1 },
    ],
    zoom: [
      { transform: "scale(0.1)", opacity: 0 },
      { transform: "scale(1)", opacity: 1 },
    ],
    rotate: [
      { transform: "rotate(-90deg)", opacity: 0 },
      { transform: "rotate(0)", opacity: 1 },
    ],
    bounce: [
      { transform: `${translation} scale(.8)`, opacity: 0 },
      { transform: "translateY(-12%) scale(1.05)", opacity: 1, offset: 0.7 },
      { transform: "none", opacity: 1 },
    ],
    flip: [
      { transform: "perspective(600px) rotateY(90deg)", opacity: 0 },
      { transform: "perspective(600px) rotateY(0)", opacity: 1 },
    ],
    back: [
      { transform: `${translation} scale(.65)`, opacity: 0 },
      { transform: "scale(.65)", opacity: 1, offset: 0.7 },
      { transform: "scale(1)", opacity: 1 },
    ],
    lightSpeed: [
      { transform: `${translation} skewX(-30deg)`, opacity: 0 },
      { transform: "skewX(10deg)", opacity: 1, offset: 0.7 },
      { transform: "none", opacity: 1 },
    ],
    pulse: [
      { transform: "scale(1)" },
      { transform: "scale(1.12)" },
      { transform: "scale(1)" },
    ],
    shake: [
      { transform: "translateX(0)" },
      { transform: "translateX(-8%)" },
      { transform: "translateX(8%)" },
      { transform: "translateX(-5%)" },
      { transform: "none" },
    ],
    swing: [
      { transform: "rotate(0)" },
      { transform: "rotate(12deg)" },
      { transform: "rotate(-8deg)" },
      { transform: "rotate(0)" },
    ],
    tada: [
      { transform: "scale(1)" },
      { transform: "scale(.9) rotate(-5deg)" },
      { transform: "scale(1.1) rotate(5deg)" },
      { transform: "none" },
    ],
    wobble: [
      { transform: "none" },
      { transform: "translateX(-10%) rotate(-5deg)" },
      { transform: "translateX(8%) rotate(3deg)" },
      { transform: "none" },
    ],
    heartBeat: [
      { transform: "scale(1)" },
      { transform: "scale(1.2)" },
      { transform: "scale(1)" },
      { transform: "scale(1.2)" },
      { transform: "scale(1)" },
    ],
  };
  const frames = base[animation.effect] ?? base.fade;
  return animation.type === "out" ? [...frames].reverse() : frames;
}
