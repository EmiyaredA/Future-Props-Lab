import { useEffect, useRef, useState } from "react";
import { demoMotion, type MotionDemo } from "./demo";
import { motionPhases } from "./phases";
import { boundedMotionTarget, remainingMotionBudget } from "./motionBudget";
import type { PetMotionFrame, PetPosePlayback } from "@platform/petMotion";

/** Same motion frames in a local work area; no desktop movement bridge is involved. */
export function useVirtualMotion(
  demo: MotionDemo | null,
  key: number,
  size: number,
  stride: () => number | undefined = () => undefined,
  feedback?: () => {
    transition: PetPosePlayback | null;
    failure: string | null;
  },
  cancelPlayback?: () => void,
) {
  const stage = useRef<HTMLDivElement>(null);
  const strideRef = useRef(stride);
  strideRef.current = stride;
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const cancelRef = useRef(cancelPlayback);
  cancelRef.current = cancelPlayback;
  const lastPlacement = useRef<{
    demo: MotionDemo;
    x: number;
    y: number;
    phase: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
    frame: PetMotionFrame;
  } | null>(null);
  useEffect(() => () => cancelRef.current?.(), []);
  useEffect(() => {
    setError("");
    cancelRef.current?.();
    const element = stage.current;
    if (!demo || !element) {
      setPlacement(null);
      return;
    }
    const replay =
      lastPlacement.current?.demo === demo ? lastPlacement.current : null;
    let previous: { x: number; y: number } | null = replay,
      phase = replay?.phase ?? 0;
    let previousFrame: PetMotionFrame | null = null;
    let previousTick = performance.now(),
      seconds = 0;
    let request = 0;
    let firstFrame = true;
    const tick = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - previousTick) / 1000));
      previousTick = now;
      // A new selection must reach the renderer before reading the preceding
      // selection's failure or still-playing transition.
      const playback = firstFrame ? undefined : feedbackRef.current?.();
      if (playback?.failure) {
        setError(
          playback.failure.includes("view") ||
            playback.failure.includes("transition")
            ? "该姿势缺少可用的过渡或支撑，已停止演示，请更新动作资源"
            : "该姿势无法保持自然支撑，已停止演示，请更新动作资源",
        );
        return;
      }
      if (playback?.transition && playback.transition.progress < 1) {
        request = requestAnimationFrame(tick);
        return;
      }
      const priorSeconds = seconds;
      if (!firstFrame) seconds += dt;
      const width = size * 0.75;
      const right = Math.max(4, element.clientWidth - width - 4);
      const floor = Math.max(28, element.clientHeight - size - 28);
      const top = Math.min(floor, 28);
      const frame = demoMotion(demo, seconds);
      let x = (4 + right) / 2,
        y = Math.max(top, (floor + top) / 2);
      if (demo.startsWith("walk")) {
        x =
          frame.facing === 1
            ? Math.min(right, (replay?.x ?? 4) + (seconds * 60 * size) / 220)
            : Math.max(4, (replay?.x ?? right) - (seconds * 60 * size) / 220);
        y = floor;
      } else if (demo === "land") {
        y = floor;
      } else if (demo.startsWith("climb")) {
        const horizontal = frame.edge === "top" || frame.edge === "bottom";
        x = horizontal
          ? Math.min(right, (replay?.x ?? 4) + (seconds * 40 * size) / 220)
          : frame.edge === "left"
            ? 4
            : right;
        y = horizontal
          ? frame.edge === "top"
            ? top
            : floor
          : Math.max(top, (replay?.y ?? floor) - (seconds * 40 * size) / 220);
      } else if (demo.startsWith("glide")) {
        const travel = Math.min(
          floor - (replay?.y ?? top),
          (seconds * 70 * size) / 220,
        );
        y = (replay?.y ?? top) + travel;
        x =
          frame.facing === 1
            ? Math.min(right, (replay?.x ?? 4) + (travel * 110) / 70)
            : Math.max(4, (replay?.x ?? right) - (travel * 110) / 70);
      }
      const budget = playback?.transition?.motionBudget;
      if (budget && previous) {
        const distance = Math.hypot(x - previous.x, y - previous.y);
        const bounded = boundedMotionTarget(
          previous,
          { x, y },
          remainingMotionBudget(budget, previous),
        );
        const allowed = Math.hypot(
          bounded.x - previous.x,
          bounded.y - previous.y,
        );
        if (distance > 0)
          seconds =
            priorSeconds + ((seconds - priorSeconds) * allowed) / distance;
        x = bounded.x;
        y = bounded.y;
      }
      const strideLength = strideRef.current() ?? size * 0.22;
      if (previous)
        phase +=
          (Math.hypot(x - previous.x, y - previous.y) / strideLength) *
          Math.PI *
          2;
      previous = { x, y };
      const walkDuration =
        ((frame.facing === 1
          ? right - (replay?.x ?? 4)
          : (replay?.x ?? right) - 4) *
          220) /
        (60 * size);
      const climbDuration =
        ((frame.edge === "top" || frame.edge === "bottom"
          ? right - (replay?.x ?? 4)
          : (replay?.y ?? floor) - top) *
          220) /
        (40 * size);
      const glideDuration = ((floor - (replay?.y ?? top)) * 220) / (70 * size);
      const stopped =
        (demo.startsWith("walk") && seconds >= walkDuration) ||
        (demo.startsWith("climb") && seconds >= climbDuration);
      const landed = demo.startsWith("glide") && seconds >= glideDuration;
      const landingAge = seconds - glideDuration;
      const current = motionPhases(
        {
          ...frame,
          ...(stopped || (landed && landingAge >= 0.2)
            ? { state: "idle", velocity: { x: 0, y: 0 } }
            : landed
              ? { state: "land", velocity: { x: 0, y: 0 } }
              : {}),
          phase,
          strideLength,
          travel: { x, y },
          contactAnchors: previousFrame?.contactAnchors,
        },
        landed ? landingAge : seconds,
      );
      previousFrame = current;
      firstFrame = false;
      lastPlacement.current = { demo, x, y, phase };
      setPlacement({
        left: x,
        top: y,
        frame: current,
      });
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [demo, key, size]);
  return { stage, placement, error };
}
