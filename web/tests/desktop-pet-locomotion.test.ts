import { expect, test } from "vitest";
import { createPet } from "../src/features/desktop-pet/whale-vendor/pet-core.js";
import { demoMotion } from "../src/features/desktop-pet/locomotion/demo";
import {
  humanPose,
  type HumanFrame,
} from "../src/features/desktop-pet/humanFigure";

function stage(walkInPlace: boolean, width = 165) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const frames: HumanFrame[] = [];
  const pet = createPet(
    {
      petG: group,
      shadowEl: document.createElementNS(
        "http://www.w3.org/2000/svg",
        "ellipse",
      ),
      fxG: document.createElementNS("http://www.w3.org/2000/svg", "g"),
    },
    {
      walkInPlace,
      roam: "off",
      sfx: new Proxy({}, { get: () => () => {} }),
      startX: width / 2,
      bounds: () => ({ W: width, H: 220, floorY: 212, S: 0.793269 }),
      figure: {
        draw: (_group: unknown, _face: unknown, frame: HumanFrame) =>
          frames.push(structuredClone(frame)),
      },
    },
  );
  const tick = () => {
    pet.step(0.05);
    pet.render();
  };
  return { pet, group, frames, tick };
}

test.each(["walk", "run"])(
  "%s keeps moving limbs inside the narrow desktop figure without shifting its anchor",
  (motion) => {
    const { pet, group, frames, tick } = stage(true);
    pet.act(motion);
    for (let i = 0; i < 20; i++) tick();
    expect(frames.every((frame) => frame.mode === motion)).toBe(true);
    expect(group.getAttribute("transform")).toMatch(/^translate\(82\.5 /);
    const poses = frames.map(humanPose);
    expect(
      new Set(poses.map((pose) => pose.legAngles[0])).size,
    ).toBeGreaterThan(10);
    expect(new Set(poses.map((pose) => pose.arms[0])).size).toBeGreaterThan(10);
    pet.resize();
    tick();
    expect(frames.at(-1)?.mode).toBe(motion);
    for (let i = 0; i < 120; i++) tick();
    expect(frames.at(-1)?.mode).toBe("idle");
  },
);

test("ordinary wide stages still walk across the stage", () => {
  const { pet, group, tick } = stage(false, 700);
  pet.act("walk");
  tick();
  const start = group.getAttribute("transform");
  for (let i = 0; i < 20; i++) tick();
  expect(group.getAttribute("transform")).not.toBe(start);
  expect(group.getAttribute("transform")).not.toMatch(/^translate\(350 /);
});

test.each(["walk", "run"])(
  "human %s alternates lifted feet without crossing throughout a real gait cycle",
  (motion) => {
    const { pet, frames, tick } = stage(true);
    pet.replaceReaction(motion, "happy", true);
    for (let i = 0; i < 60; i++) tick();
    const poses = frames.map(humanPose);
    for (const pose of poses) {
      // Kurisu's hip pivots are 21.46 px apart; each hip-to-sole length is 68 px.
      const footX = pose.legAngles.map(
        (angle, i) =>
          [112.275, 133.735][i] -
          Math.sin((angle * Math.PI) / 180) * 68 * pose.legScales[i],
      );
      expect(footX[1] - footX[0]).toBeGreaterThan(7);
      expect(pose.legAngles[0] * pose.legAngles[1]).toBeLessThanOrEqual(
        0.00001,
      );
    }
    expect(
      poses.some((pose) => pose.legScales[0] < pose.legScales[1] - 0.03),
    ).toBe(true);
    expect(
      poses.some((pose) => pose.legScales[1] < pose.legScales[0] - 0.03),
    ).toBe(true);
  },
);

test("public reaction replacement interrupts air, holds expressions, clears effects and keeps persistent poses", () => {
  const { pet, frames, tick } = stage(true);
  pet.replaceReaction("jump", "surprised", true);
  for (let i = 0; i < 5; i++) tick();
  expect(frames.at(-1)?.mode).toBe("air");
  pet.replaceReaction("sit", "happy", true);
  for (let i = 0; i < 100; i++) tick();
  expect(frames.at(-1)?.mode).toBe("sit");
  expect(frames.at(-1)?.face).toBe("happy");
  pet.replaceReaction(null, null, true);
  tick();
  expect(frames.at(-1)?.mode).toBe("idle");
  expect(frames.at(-1)?.face).toBe("neutral");
  pet.replaceReaction("sleep", null, true);
  for (let i = 0; i < 100; i++) tick();
  expect(frames.at(-1)?.mode).toBe("sleep");
});

test.each([
  "held",
  "climb-left",
  "climb-right",
  "glide-left",
  "glide-right",
] as const)(
  "physical %s replaces busy reactions and uses the same real engine as runtime",
  (preset) => {
    const { pet, frames, tick } = stage(true);
    pet.replaceReaction("jump", "happy", true);
    tick();
    const poses = [];
    for (let i = 0; i < 32; i++) {
      pet.setLocomotion(demoMotion(preset, i / 30));
      tick();
      const frame = frames.at(-1)!;
      expect(frame.mode).toBe(preset.split("-")[0]);
      expect(frame.face).toBe("happy");
      poses.push(humanPose(frame));
    }
    const pose = poses[10];
    if (preset === "held") {
      expect(Math.max(...pose.legAngles.map(Math.abs))).toBeLessThan(8);
      expect(Math.max(...pose.arms.map(Math.abs))).toBeLessThan(30);
    } else if (preset.startsWith("climb")) {
      expect(pose.arms.some((angle) => Math.abs(angle) > 70)).toBe(true);
      expect(new Set(poses.map((p) => p.legScales[0])).size).toBeGreaterThan(
        10,
      );
      expect(Math.sign(pose.arms[0])).toBe(preset === "climb-left" ? 1 : -1);
    } else {
      expect(pose.arms[0]).toBeGreaterThan(60);
      expect(pose.arms[1]).toBeLessThan(-60);
      expect(pose.legScales[0]).toBeLessThan(1);
    }
    pet.setLocomotion(null);
    tick();
    expect(frames.at(-1)?.mode).toBe("idle");
  },
);

test("the public held pose keeps the grabbed point fixed while squash and swing settle", () => {
  const { pet, group, tick } = stage(true);
  tick();
  const matrix = () => {
    const numbers = group
      .getAttribute("transform")!
      .match(/-?\d+(?:\.\d+)?/g)!
      .map(Number);
    return {
      x: numbers[0],
      y: numbers[1],
      r: (numbers[2] * Math.PI) / 180,
      sx: numbers[3],
      sy: numbers[4],
    };
  };
  const initial = matrix(),
    grip = { x: 82.5, y: 110 };
  const point = {
    x: (grip.x - initial.x) / initial.sx,
    y: (grip.y - initial.y) / initial.sy,
  };
  for (let i = 0; i < 40; i++) {
    pet.setLocomotion({
      ...demoMotion("held", i / 30),
      grip,
      swing: Math.sin(i / 8) * 12,
    });
    tick();
    const m = matrix(),
      x = point.x * m.sx,
      y = point.y * m.sy;
    expect(
      Math.abs(m.x + x * Math.cos(m.r) - y * Math.sin(m.r) - grip.x),
    ).toBeLessThan(0.2);
    expect(
      Math.abs(m.y + x * Math.sin(m.r) + y * Math.cos(m.r) - grip.y),
    ).toBeLessThan(0.2);
  }
});
