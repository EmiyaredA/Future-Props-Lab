import type {
  FrameSequences,
  SequenceFrame,
} from "@features/desktop-pet/sequences/types";

/** Synthetic complete-cel registration; these points are not character art certification. */
export function stagedClimbFixture(): FrameSequences {
  const a = (shift = 0): SequenceFrame["supports"] => ({
    armFar: [80, 40 + shift],
    legFront: [80, 80 + shift],
  });
  const b = (shift = 0): SequenceFrame["supports"] => ({
    armNear: [70, 30 + shift],
    legBack: [70, 70 + shift],
  });
  const supports = [
    a(),
    a(),
    { ...a(4), ...b() },
    b(),
    b(),
    { ...b(4), ...a() },
  ];
  const frames: SequenceFrame[] = supports.map((points, i) => ({
    texture: `cel${i}`,
    rect: [0, 0, 100, 100],
    durationMs: 100,
    grip: [50, 40],
    foot: [80, 80],
    head: [
      [50, 0],
      [50, 20],
    ],
    contacts: { right: [80, 50] },
    supports: points,
  }));
  return {
    version: 1,
    frameSize: [100, 100],
    modelBox: [0, 0, 100, 100],
    headLength: 20,
    clips: {
      idle: { frames: [structuredClone(frames[0])], loop: true },
      "side-right": {
        frames,
        loop: true,
        distancePerCycle: 8,
        distanceAtFrame: [0, 0, 4, 4, 4, 8, 8],
      },
    },
    transitions: [],
  };
}
