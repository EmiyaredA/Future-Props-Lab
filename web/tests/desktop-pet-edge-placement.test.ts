import { expect, test } from "vitest";
import { PetLocomotion } from "../src/features/desktop-pet/locomotion/controller";
import {
  edgeThreshold,
  nearestEdge,
} from "../src/features/desktop-pet/locomotion/edges";
import { motionPhases } from "../src/features/desktop-pet/locomotion/phases";
import type { PetEdge, PetGeometry } from "../src/platform/petMotion";
import { unshiftGeometry } from "../src/platform/petMotion";

const shape: PetGeometry = {
  visible: { x: 50, y: 50, width: 200, height: 250 },
  feet: { x: 150, y: 300 },
  supportedEdges: ["left", "right", "top", "bottom"],
  edges: {
    left: { x: 50, y: 180 },
    right: { x: 250, y: 180 },
    top: { x: 150, y: 50 },
    bottom: { x: 150, y: 300 },
  },
};
const area = { x: -1000, y: -200, width: 1000, height: 800 };
const locations: Record<PetEdge, [number, number]> = {
  left: [-1040, 0],
  right: [-260, 0],
  top: [-650, -244],
  bottom: [-650, 290],
};
function model(edge: PetEdge) {
  const [x, y] = locations[edge];
  const events: string[] = [];
  const pet = new PetLocomotion(
    {
      generation: 0,
      revision: 1,
      bounds: { x, y, width: 300, height: 400 },
      displayId: 1,
      workArea: area,
      visible: true,
    },
    {
      roam: "free",
      size: 220,
      edgeClimbing: true,
      highGliding: true,
      dropDuration: 0.2,
    },
    (event) => events.push(event),
    () => 0.1,
  );
  const tick = () => {
    if (pet.step(0.05, shape))
      pet.receipt(
        {
          ...pet.environment,
          bounds: { ...pet.environment.bounds, x: pet.x, y: pet.y },
        },
        0.05,
      );
  };
  const place = () => {
    pet.press(x + 150, y + 180);
    pet.pointer(x + 155, y + 180);
    pet.release();
    pet.placed(pet.environment, shape);
  };
  return { pet, events, tick, place };
}
test.each(["left", "right", "top", "bottom"] as const)(
  "acknowledged placement attaches to %s and crawls along its support plane",
  (edge) => {
    const { pet, tick, place } = model(edge);
    place();
    expect(pet.frame.edge).toBeNull();
    for (let i = 0; i < 11; i++) tick();
    expect(pet.frame.state).toBe("climb");
    expect(pet.frame.edge).toBe(edge);
    const start = { x: pet.x, y: pet.y };
    for (let i = 0; i < 12; i++) tick();
    const horizontal = edge === "top" || edge === "bottom";
    expect(
      Math.abs(horizontal ? pet.x - start.x : pet.y - start.y),
    ).toBeGreaterThan(5);
    expect(horizontal ? pet.y : pet.x).toBeCloseTo(
      horizontal ? start.y : start.x,
      5,
    );
    expect(pet.frame.state).not.toBe("glide");
  },
);
test("threshold scales and has hysteresis, with walls winning exact corner ties", () => {
  expect(edgeThreshold(20)).toBe(12);
  expect(edgeThreshold(1000)).toBe(32);
  expect(nearestEdge(-1046, -246, shape, area, 220)).toBe("left");
  expect(nearestEdge(-1020, 0, shape, area, 220)).toBeNull();
  expect(nearestEdge(-1020, 0, shape, area, 220, "left")).toBe("left");
  expect(
    nearestEdge(
      -650,
      -244,
      { ...shape, supportedEdges: ["left", "right"] },
      area,
      220,
    ),
  ).toBeNull();
});
test.each(["tap", "cancel", "off", "disabled", "paused"])(
  "%s never activates placement attachment",
  (reason) => {
    const { pet, tick } = model("left");
    pet.press(0, 0);
    if (reason !== "tap") pet.pointer(5, 0);
    pet.release(reason === "cancel");
    if (reason === "off")
      pet.configure({ ...pet.settings, roam: "off" }, false);
    if (reason === "disabled")
      pet.configure({ ...pet.settings, edgeClimbing: false }, false);
    if (reason === "paused") pet.configure(pet.settings, true);
    pet.placed(pet.environment, shape);
    for (let i = 0; i < 20; i++) tick();
    expect(pet.frame.edge).toBeNull();
  },
);
test("a new press invalidates an older drop acknowledgement", () => {
  const { pet } = model("left");
  pet.press(0, 0);
  pet.pointer(5, 0);
  pet.release();
  pet.press(0, 0);
  pet.placed(pet.environment, shape);
  expect(pet.frame.edge).toBeNull();
  expect(pet.pressing).toBe(true);
});
test("a constrained drag receipt rebases the grip and the next pointer target once", () => {
  const { pet } = model("left");
  pet.press(0, 0);
  pet.pointer(20, 10);
  const submitted = { x: pet.x, y: pet.y };
  const grip = { ...pet.frame.grip! };
  pet.receipt(
    {
      ...pet.environment,
      bounds: {
        ...pet.environment.bounds,
        x: submitted.x + 8,
        y: submitted.y - 3,
      },
    },
    0.03,
    submitted,
  );
  expect(pet.frame.grip).toEqual({ x: grip.x - 8, y: grip.y + 3 });
  pet.pointer(22, 13);
  expect(pet.x).toBe(submitted.x + 10);
  expect(pet.y).toBe(submitted.y);
});
test("confirmed content travel advances the climb even when the native window cannot move above its menu bar", () => {
  const { pet, tick, place } = model("left");
  place();
  for (let n = 0; n < 15; n++) tick();
  const phase = pet.frame.phase;
  const origin = pet.y;
  pet.receipt({ ...pet.environment, sceneOffset: { x: 0, y: -8 } }, 0.1);
  expect(pet.y).toBe(origin - 8);
  expect(pet.frame.phase).toBeGreaterThan(phase);
  const normalized = unshiftGeometry(
    {
      ...shape,
      visible: { ...shape.visible, y: shape.visible.y - 8 },
      feet: { ...shape.feet, y: shape.feet.y - 8 },
      edges: undefined,
    },
    { x: 0, y: -8 },
  );
  expect(normalized.visible).toEqual(shape.visible);
  expect(normalized.feet).toEqual(shape.feet);
});
test("activity ends in attached rest and waits a full interval before moving again", () => {
  const { pet, tick, place } = model("top");
  place();
  for (let i = 0; i < 58; i++) tick();
  expect(pet.frame.attachment).toBe("resting");
  const x = pet.x;
  for (let i = 0; i < 120; i++) tick();
  expect(pet.x).toBe(x);
  expect(pet.frame.attachment).toBe("resting");
  for (let i = 0; i < 30; i++) tick();
  expect(pet.frame.attachment).toBe("moving");
  expect(pet.x).not.toBe(x);
});
test("corners transfer from wall to ceiling without initiating a glide", () => {
  const { pet, tick, place } = model("left");
  pet.environment.bounds.y = -246;
  pet.y = -246;
  pet.environment.bounds.x = -1046;
  pet.x = -1046;
  place();
  for (let i = 0; i < 15; i++) tick();
  expect(pet.frame.edge).toBe("top");
  expect(pet.frame.edgeTurn?.from).toBe("left");
  for (let i = 0; i < 10; i++) tick();
  expect(pet.frame.state).toBe("climb");
  expect(pet.frame.edgeTurn).toBeUndefined();
});
test("leaving the bottom corner upward does not teleport to the opposite edge", () => {
  const { pet, tick, place } = model("left");
  pet.environment.bounds.x = -1046;
  pet.environment.bounds.y = 296;
  pet.x = -1046;
  pet.y = 296;
  place();
  for (let i = 0; i < 22; i++) tick();
  expect(pet.frame.edge).toBe("left");
  expect(pet.x).toBeCloseTo(-1046);
  expect(pet.y).toBeLessThan(290);
  expect(pet.y).toBeGreaterThan(260);
  expect(pet.frame.edgeTurn).toBeUndefined();
});
test("ceiling always has hand support, floor crawl always has at least two supports", () => {
  for (const edge of ["top", "bottom"] as const)
    for (let n = 0; n < 180; n++) {
      const frame = motionPhases(
        {
          state: "climb",
          edge,
          facing: 1,
          phase: (n / 180) * Math.PI * 2,
          swing: 0,
          velocity: { x: 40, y: 0 },
        },
        1,
      );
      const count = [...frame.contacts!.hands, ...frame.contacts!.feet].filter(
        Boolean,
      ).length;
      expect(count).toBeGreaterThanOrEqual(edge === "top" ? 1 : 2);
      if (edge === "top") expect(frame.contacts!.feet).toEqual([false, false]);
    }
});
