import type { PetContactAnchor, PetMotionFrame } from "@platform/petMotion";

export const cycle = (phase: number) => (((phase / (Math.PI * 2)) % 1) + 1) % 1;

/** Contact timing is shared by actual motion, the virtual stage and the renderer. */
export function motionPhases(
  frame: PetMotionFrame,
  age: number,
  remaining = Infinity,
): PetMotionFrame {
  const climbing = frame.state === "climb";
  const moving =
    (climbing || frame.state === "walk") && frame.attachment !== "resting";
  const stance = climbing ? 0.68 : 0.6;
  const resting = climbing && frame.attachment === "resting";
  const feet: [boolean, boolean] =
    frame.edge === "top" && climbing
      ? [false, false]
      : resting
        ? [true, true]
        : moving
          ? [cycle(frame.phase) < stance, cycle(frame.phase + Math.PI) < stance]
          : [
              frame.state === "idle" || frame.state === "land",
              frame.state === "idle" || frame.state === "land",
            ];
  const hands: [boolean, boolean] = resting
    ? [true, true]
    : climbing
      ? [
          cycle(frame.phase + Math.PI * 0.3) < stance,
          cycle(frame.phase + Math.PI * 1.3) < stance,
        ]
      : [false, false];
  const anchors = (
    kind: "hands" | "feet",
    active: [boolean, boolean],
  ): [PetContactAnchor | null, PetContactAnchor | null] =>
    active.map((contact, index) => {
      if ((!moving && frame.attachment !== "resting") || !contact) return null;
      const phase =
        frame.phase + index * Math.PI + (kind === "hands" ? Math.PI * 0.3 : 0);
      const old = frame.contactAnchors?.[kind][index];
      if (
        old &&
        old.motion === frame.state &&
        old.edge === frame.edge &&
        old.facing === frame.facing &&
        Math.floor(old.phase / (2 * Math.PI)) ===
          Math.floor(phase / (2 * Math.PI))
      )
        return old;
      return {
        phase,
        travel: { ...(frame.travel ?? { x: 0, y: 0 }) },
        motion: climbing ? "climb" : "walk",
        facing: frame.facing,
        edge: frame.edge,
      };
    }) as [PetContactAnchor | null, PetContactAnchor | null];
  return {
    ...frame,
    stage: remaining < 0.18 ? "end" : age < 0.18 ? "start" : "loop",
    progress: Math.max(
      0,
      Math.min(1, remaining < 0.18 ? 1 - remaining / 0.18 : age / 0.18),
    ),
    contacts: { feet, hands },
    contactAnchors: {
      feet: anchors("feet", feet),
      hands: anchors("hands", hands),
    },
  };
}
