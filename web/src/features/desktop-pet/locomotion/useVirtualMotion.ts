import { useEffect, useRef, useState } from "react";
import { demoMotion, type MotionDemo } from "./demo";
import { motionPhases } from "./phases";
import type { PetMotionFrame } from "@platform/petMotion";

/** Same motion frames in a local work area; no desktop movement bridge is involved. */
export function useVirtualMotion(
  demo: MotionDemo | null,
  key: number,
  size: number,
) {
  const stage = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
    frame: PetMotionFrame;
  } | null>(null);
  useEffect(() => {
    const element = stage.current;
    if (!demo || !element) {
      setPlacement(null);
      return;
    }
    let previous: { x: number; y: number } | null = null,
      phase = 0;
    const started = performance.now();
    let request = 0;
    const tick = (now: number) => {
      const seconds = (now - started) / 1000;
      const width = size * 0.75;
      const right = Math.max(4, element.clientWidth - width - 4);
      const floor = Math.max(28, element.clientHeight - size - 28);
      const top = Math.min(floor, 28);
      const frame = demoMotion(demo, seconds);
      let x = (4 + right) / 2,
        y = Math.max(top, (floor + top) / 2);
      if (demo.startsWith("climb")) {
        x = frame.edge === "left" ? 4 : right;
        y = Math.max(top, floor - (seconds * 40 * size) / 220);
      } else if (demo.startsWith("glide")) {
        const travel = Math.min(floor - top, (seconds * 70 * size) / 220);
        y = top + travel;
        x =
          frame.facing === 1
            ? Math.min(right, 4 + (travel * 110) / 70)
            : Math.max(4, right - (travel * 110) / 70);
      }
      if (previous)
        phase +=
          (Math.hypot(x - previous.x, y - previous.y) / (size * 0.22)) *
          Math.PI *
          2;
      previous = { x, y };
      setPlacement({ left: x, top: y, frame: motionPhases({ ...frame, phase, strideLength: size * 0.22, travel: { x, y } }, seconds) });
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [demo, key, size]);
  return { stage, placement };
}
