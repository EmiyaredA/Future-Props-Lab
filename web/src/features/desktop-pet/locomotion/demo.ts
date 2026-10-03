import type { PetMotionFrame } from "@platform/petMotion";
import { motionPhases } from "./phases";
export type MotionDemo =
  "held" | "climb-left" | "climb-right" | "glide-left" | "glide-right";
export const MOTION_DEMOS: Record<MotionDemo, string> = {
  held: "拎起",
  "climb-left": "左侧攀爬",
  "climb-right": "右侧攀爬",
  "glide-left": "向左滑翔",
  "glide-right": "向右滑翔",
};
export function demoMotion(name: MotionDemo, seconds: number): PetMotionFrame {
  const held = name === "held",
    climb = name.startsWith("climb");
  const facing = name.endsWith("left") ? -1 : 1;
  return motionPhases({
    state: held ? "held" : climb ? "climb" : "glide",
    facing,
    edge: climb ? (facing < 0 ? "left" : "right") : null,
    phase: seconds * (climb ? 4 : 6),
    strideLength: 220 * 0.22,
    velocity: held
      ? { x: 0, y: 0 }
      : climb
        ? { x: 0, y: -40 }
        : { x: facing * 110, y: 70 },
    swing: held
      ? Math.sin(seconds * 2) * 8 * Math.exp(-seconds * 0.3)
      : Math.sin(seconds * 3) * 3,
    travel: held ? { x: 0, y: 0 } : climb ? { x: 0, y: -seconds * 40 } : { x: facing * seconds * 110, y: seconds * 70 },
  }, seconds);
}
