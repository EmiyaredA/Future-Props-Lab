import type { PetMotionFrame } from "@platform/petMotion";

export const cycle = (phase: number) => ((phase / (Math.PI * 2)) % 1 + 1) % 1;

/** Contact timing is shared by actual motion, the virtual stage and the renderer. */
export function motionPhases(frame: PetMotionFrame, age: number, remaining = Infinity): PetMotionFrame {
  const climbing = frame.state === "climb";
  const moving = climbing || frame.state === "walk";
  const stance = climbing ? 0.68 : 0.6;
  const feet: [boolean, boolean] = moving
    ? [cycle(frame.phase) < stance, cycle(frame.phase + Math.PI) < stance]
    : [frame.state === "idle" || frame.state === "land", frame.state === "idle" || frame.state === "land"];
  const hands: [boolean, boolean] = climbing
    ? [cycle(frame.phase + Math.PI * 0.3) < stance, cycle(frame.phase + Math.PI * 1.3) < stance]
    : [false, false];
  return {
    ...frame,
    stage: remaining < 0.18 ? "end" : age < 0.18 ? "start" : "loop",
    progress: Math.min(1, age / 0.18),
    contacts: { feet, hands },
  };
}
