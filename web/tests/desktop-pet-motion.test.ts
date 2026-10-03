import { expect, test } from "vitest";
import {
  PetLocomotion,
  type ActivitySettings,
} from "../src/features/desktop-pet/locomotion/controller";
import type { PetEnvironment, PetGeometry } from "../src/platform/petMotion";

const geometry: PetGeometry = {
  visible: { x: 80, y: 130, width: 140, height: 220 },
  feet: { x: 150, y: 350 },
};
const settings: ActivitySettings = {
  roam: "free",
  size: 220,
  edgeClimbing: true,
  highGliding: true,
};
function setup(x = 500, y = 420, random = () => 0.9) {
  const events: string[] = [];
  const environment: PetEnvironment = {
    generation: 0,
    revision: 1,
    bounds: { x, y, width: 300, height: 400 },
    workArea: { x: 0, y: 25, width: 1280, height: 775 },
    displayId: 1,
    visible: true,
  };
  const pet = new PetLocomotion(
    environment,
    { ...settings },
    (name) => events.push(name),
    random,
  );
  const tick = (dt = 0.05) => {
    if (pet.step(dt, geometry))
      pet.receipt(
        {
          ...pet.environment,
          bounds: {
            ...pet.environment.bounds,
            x: Math.round(pet.x),
            y: Math.round(pet.y),
          },
        },
        dt,
      );
  };
  return { pet, events, tick };
}
test("short taps remain taps, stationary press holds at 150ms, release remains at the placed height", () => {
  const { pet, events, tick } = setup();
  pet.press(100, 100);
  tick();
  tick();
  expect(pet.release()).toBe(true);
  expect(events).toEqual([]);
  pet.press(100, 100);
  tick();
  tick();
  tick();
  expect(pet.frame.state).toBe("held");
  expect(events).toEqual(["grab"]);
  pet.pointer(170, -100);
  tick();
  const y = pet.environment.bounds.y;
  expect(pet.release()).toBe(false);
  expect(pet.y).toBe(y);
  expect(pet.frame.state).toBe("idle");
  expect(events).toEqual(["grab", "drop"]);
  tick();
  expect(pet.frame.state).toBe("idle");
});
test("drag threshold holds immediately and cancellation cannot remain suspended", () => {
  const { pet, events, tick } = setup();
  pet.press(0, 0);
  pet.pointer(4, 0);
  expect(pet.frame.state).toBe("idle");
  pet.pointer(5, 0);
  tick();
  expect(pet.frame.state).toBe("held");
  expect(Math.abs(pet.frame.swing)).toBeGreaterThan(0);
  expect(pet.release(true)).toBe(false);
  expect(pet.pressing).toBe(false);
  expect(events).toEqual(["grab", "drop"]);
});
test.each([
  ["free", 7],
  ["calm", 17],
] as const)(
  "%s begins continuous walking after its rest interval and strides follow receipts",
  (roam, wait) => {
    const { pet, tick } = setup();
    pet.settings.roam = roam;
    for (let i = 0; i < wait * 20 - 1; i++) tick();
    expect(pet.frame.state).toBe("idle");
    tick();
    expect(pet.frame.state).toBe("walk");
    const phase = pet.frame.phase,
      start = pet.x;
    for (let i = 0; i < 10; i++) tick();
    expect(pet.x - start).toBeGreaterThan(10);
    expect(pet.x - start).toBeLessThan(32);
    expect(pet.frame.phase).toBeGreaterThan(phase);
  },
);
test.each([
  [-75, 1, "left"],
  [1055, -1, "right"],
] as const)(
  "walking at a %s edge climbs with the correct contact side",
  (x, direction, edge) => {
    const { pet, tick } = setup(x, 450, () => (direction === 1 ? 0.1 : 0.9));
    // Choose a walk toward the nearby edge (the random values above choose its outer direction).
    for (let i = 0; i < 142; i++) tick();
    expect(pet.frame.state).toBe("climb");
    expect(pet.frame.edge).toBe(edge);
    const y = pet.y;
    for (let i = 0; i < 10; i++) tick();
    expect(pet.y).toBeLessThan(y);
  },
);
test("disabled climbing folds the walk inward without moving vertically", () => {
  const { pet, tick } = setup(-75, 450, () => 0.1);
  pet.settings.edgeClimbing = false;
  for (let i = 0; i < 155; i++) tick();
  expect(pet.frame.state).toBe("walk");
  expect(pet.frame.facing).toBe(1);
  expect(pet.y).toBe(450);
});
test("only an autonomous decision at sufficient height glides diagonally and lands", () => {
  const { pet, tick, events } = setup(350, 50, () => 0.1);
  pet.press(0, 0);
  pet.pointer(10, 0);
  tick();
  pet.release();
  expect(pet.frame.state).toBe("idle");
  for (let i = 0; i < 140; i++) tick();
  expect(pet.frame.state).toBe("glide");
  const start = { x: pet.x, y: pet.y };
  for (let i = 0; i < 20; i++) tick();
  expect(pet.x).toBeGreaterThan(start.x);
  expect(pet.y).toBeGreaterThan(start.y);
  for (let i = 0; i < 150; i++) tick();
  expect(pet.frame.state).toBe("idle");
  expect(pet.environment.bounds.y + geometry.feet.y).toBeCloseTo(796, 0);
  expect(events.at(-1)).toBe("drop");
});
test("gliding disabled or below threshold preserves the selected activity height", () => {
  for (const [y, allowed] of [
    [50, false],
    [440, true],
  ] as const) {
    const { pet, tick } = setup(350, y, () => 0.1);
    pet.settings.highGliding = allowed;
    for (let i = 0; i < 150; i++) tick();
    expect(pet.frame.state).toBe("walk");
    expect(pet.y).toBe(y);
  }
});
test("pause, off, hiding and changed display geometry cancel trajectories and restart the full rest interval", () => {
  const { pet, tick } = setup();
  for (let i = 0; i < 150; i++) tick();
  pet.configure(settings, true);
  const x = pet.x;
  for (let i = 0; i < 100; i++) tick();
  expect(pet.x).toBe(x);
  pet.configure(settings, false);
  for (let i = 0; i < 139; i++) tick();
  expect(pet.frame.state).toBe("idle");
  pet.updateEnvironment({
    ...pet.environment,
    revision: 2,
    displayId: 2,
    workArea: { x: -1280, y: -300, width: 1280, height: 800 },
    bounds: { ...pet.environment.bounds, x: -700, y: -100 },
  });
  expect(pet.x).toBe(-700);
  expect(pet.frame.state).toBe("idle");
  pet.configure({ ...settings, roam: "off" }, false);
  for (let i = 0; i < 200; i++) tick();
  expect(pet.x).toBe(-700);
});

test("host cancellation rebases a held pointer and display replacement releases it", () => {
  const { pet, tick, events } = setup();
  pet.press(100, 100);
  pet.pointer(120, 100);
  const next = {
    ...pet.environment,
    bounds: { ...pet.environment.bounds, x: pet.environment.bounds.x + 3 },
  };
  pet.cancelled(next);
  expect(pet.x).toBe(next.bounds.x + 20);
  pet.pointer(125, 100);
  expect(pet.x).toBe(next.bounds.x + 25);
  for (let i = 0; i < 50; i++) tick();
  expect(Math.abs(pet.frame.swing)).toBeLessThan(0.01);
  pet.updateEnvironment({ ...next, displayId: 2, revision: 2 });
  expect(pet.pressing).toBe(false);
  expect(pet.frame.state).toBe("idle");
  expect(events.at(-1)).toBe("drop");
});

test("walking speed scales with size and activity, settings stop an active path", () => {
  const small = setup(),
    large = setup();
  small.pet.configure({ ...settings, size: 160 }, false);
  large.pet.configure({ ...settings, size: 300 }, false);
  for (let i = 0; i < 160; i++) {
    small.tick();
    large.tick();
  }
  expect((large.pet.x - 500) / (small.pet.x - 500)).toBeCloseTo(300 / 160, 1);
  const position = large.pet.environment.bounds;
  large.pet.configure({ ...settings, roam: "off" }, false);
  for (let i = 0; i < 300; i++) large.tick();
  expect(large.pet.environment.bounds).toEqual(position);
  expect(large.pet.frame.state).toBe("idle");
});
