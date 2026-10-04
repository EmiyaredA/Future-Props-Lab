import type { PetMotionFrame } from "@platform/petMotion";
import { motionPhases } from "./phases";
export type MotionDemo =
  | "held"
  | "walk-left"
  | "walk-right"
  | "climb-left"
  | "climb-right"
  | "climb-top"
  | "climb-bottom"
  | "glide-left"
  | "glide-right"
  | "land";
export const MOTION_DEMOS: Record<MotionDemo, string> = {
  held: "拎起",
  "walk-left": "向左行走",
  "walk-right": "向右行走",
  "climb-left": "左侧攀爬",
  "climb-right": "右侧攀爬",
  "climb-top": "顶部悬挂爬行",
  "climb-bottom": "底部低姿爬行",
  "glide-left": "向左滑翔",
  "glide-right": "向右滑翔",
  land: "落地缓冲",
};
export function demoMotion(
  name: MotionDemo,
  seconds: number,
  strideLength = 220 * 0.22,
): PetMotionFrame {
  const held = name === "held",
    climb = name.startsWith("climb"),
    walk = name.startsWith("walk"),
    land = name === "land";
  const facing = name.endsWith("left") ? -1 : 1;
  const horizontal = name === "climb-top" || name === "climb-bottom";
  return motionPhases(
    {
      state: held
        ? "held"
        : climb
          ? "climb"
          : walk
            ? "walk"
            : land
              ? "land"
              : "glide",
      facing,
      edge: climb
        ? horizontal
          ? name === "climb-top"
            ? "top"
            : "bottom"
          : facing < 0
            ? "left"
            : "right"
        : null,
      phase:
        ((seconds * (climb ? 40 : walk ? 60 : 0)) / strideLength) * Math.PI * 2,
      strideLength,
      velocity:
        held || land
          ? { x: 0, y: 0 }
          : climb
            ? horizontal
              ? { x: 40, y: 0 }
              : { x: 0, y: -40 }
            : walk
              ? { x: facing * 60, y: 0 }
              : { x: facing * 110, y: 70 },
      swing: held
        ? Math.sin(seconds * 2) * 8 * Math.exp(-seconds * 0.3)
        : Math.sin(seconds * 3) * 3,
      travel:
        held || land
          ? { x: 0, y: 0 }
          : climb
            ? horizontal
              ? { x: seconds * 40, y: 0 }
              : { x: 0, y: -seconds * 40 }
            : walk
              ? { x: facing * seconds * 60, y: 0 }
              : { x: facing * seconds * 110, y: seconds * 70 },
    },
    seconds,
  );
}
