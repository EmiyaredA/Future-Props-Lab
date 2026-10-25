import { useLayoutEffect, useRef } from "react";
import {
  lightLeakStrip,
  type LightLeakEffect,
} from "./directionalTransitionCanvas";

/** Program-wide light, composited once even when both seam partners are visible. */
export function VideoEditorLightLeak({
  effect,
  width,
  height,
}: {
  effect: LightLeakEffect;
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const horizontal =
      effect.direction === "left" || effect.direction === "right";
    const length = Math.max(1, Math.round(horizontal ? width : height));
    canvas.width = horizontal ? length : 1;
    canvas.height = horizontal ? 1 : length;
    const context = canvas.getContext("2d");
    if (!context) return;
    const data = context.createImageData(canvas.width, canvas.height);
    data.data.set(lightLeakStrip(length, effect));
    context.putImageData(data, 0, 0);
  }, [effect, width, height]);
  return <canvas ref={ref} className="ve-transition-light-leak" aria-hidden />;
}
