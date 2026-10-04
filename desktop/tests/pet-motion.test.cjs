const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  PetMotionGate,
  clampVisiblePet,
  motionRequest,
  scenePlacement,
  motionWindowBounds,
} = require("../dist/pet-motion.js");
test("native menu-bar constraints preserve the confirmed canvas origin without clipping its painted body", () => {
  const desired = { x: 0, y: -92, width: 300, height: 400 };
  const actual = { ...desired, y: 33 };
  const offset = scenePlacement(desired, actual, {
    visible: { x: 80, y: 130, width: 140, height: 220 },
    feet: { x: 150, y: 350 },
  });
  assert.deepEqual(offset, { x: 0, y: -125 });
  assert.equal(actual.y + offset.y + 130, 38);
  assert.throws(() =>
    scenePlacement({ ...desired, y: -300 }, actual, {
      visible: { x: 80, y: 130, width: 140, height: 220 },
      feet: { x: 150, y: 350 },
    }),
  );
});
const window = { x: 0, y: 0, width: 300, height: 400 };
const geometry = {
  visible: { x: 80, y: 130, width: 140, height: 220 },
  feet: { x: 150, y: 350 },
};
const request = {
  x: -100,
  y: 500,
  generation: 1,
  sequence: 1,
  environmentRevision: 2,
  geometry,
  manual: false,
};
test("held requests preserve an explicit finite grip and grow the shell without moving the renderer origin", () => {
  const hanging = {
    ...geometry,
    visible: { x: -12, y: 240, width: 180, height: 190 },
  };
  const held = {
    ...request,
    geometry: hanging,
    manual: true,
    grab: { x: 150, y: 280 },
  };
  assert.deepEqual(motionRequest(held, window).grab, held.grab);
  for (const invalid of [
    { ...held, manual: false },
    { ...held, grab: { x: NaN, y: 280 } },
    { ...held, grab: { x: 0, y: 9000 } },
  ])
    assert.throws(() => motionRequest(invalid, window), /抓取/);
  const shell = motionWindowBounds(window, hanging);
  assert.deepEqual(shell, { x: -20, y: 0, width: 300, height: 438 });
  assert.deepEqual(scenePlacement(window, shell, hanging), { x: 20, y: 0 });
  assert.deepEqual(motionWindowBounds(window, geometry), window);
});
test("only transparent margins may cross positive or negative work-area edges", () => {
  const area = { x: -1280, y: -300, width: 1280, height: 800 };
  const left = clampVisiblePet(
    { ...window, x: -1400, y: -600 },
    geometry,
    area,
  );
  assert.equal(left.x + geometry.visible.x, -1276);
  assert.equal(left.y + geometry.visible.y, -296);
  const right = clampVisiblePet({ ...window, x: 100, y: 1000 }, geometry, area);
  assert.equal(right.x + geometry.visible.x + geometry.visible.width, -4);
  assert.equal(right.y + geometry.feet.y, 496);
});
test("movement generations cancel late packets, sequence rejects reordering and screen changes reject stale geometry", () => {
  const gate = new PetMotionGate();
  gate.accept(request, 2);
  assert.throws(() => gate.accept(request, 2), /过期/);
  gate.cancel(2);
  assert.throws(() => gate.accept({ ...request, sequence: 2 }, 2), /过期/);
  assert.throws(() => gate.accept({ ...request, generation: 2 }, 3), /边界/);
  gate.accept({ ...request, generation: 2 }, 2);
});
test("transport rejects nonfinite positions and unbounded or empty visible geometry", () => {
  assert.equal(motionRequest(request, window).generation, 1);
  for (const invalid of [
    { ...request, x: Infinity },
    { ...request, sequence: -1 },
    { ...request, manual: "yes" },
    {
      ...request,
      geometry: { ...geometry, visible: { ...geometry.visible, width: 0 } },
    },
    { ...request, geometry: { ...geometry, feet: { x: 99999, y: 0 } } },
  ])
    assert.throws(() => motionRequest(invalid, window));
});

test("four-edge contact geometry is bounded and capabilities cannot be forged", () => {
  const supported = {
    ...geometry,
    edges: {
      left: { x: 80, y: 240 },
      right: { x: 220, y: 240 },
      top: { x: 150, y: 130 },
      bottom: { x: 150, y: 350 },
    },
    supportedEdges: ["left", "right", "top", "bottom"],
  };
  assert.deepEqual(
    motionRequest({ ...request, geometry: supported }, window).geometry,
    supported,
  );
  for (const invalid of [
    { ...supported, edges: { ...supported.edges, top: { x: NaN, y: 0 } } },
    {
      ...supported,
      edges: { ...supported.edges, right: { x: 99999, y: 240 } },
    },
    { ...supported, edges: { left: supported.edges.left } },
    { ...supported, supportedEdges: ["left", "left"] },
    { ...supported, supportedEdges: ["ceiling"] },
    { ...supported, supportedEdges: "all" },
  ])
    assert.throws(() =>
      motionRequest({ ...request, geometry: invalid }, window),
    );
  assert.doesNotThrow(() =>
    motionRequest(
      { ...request, geometry: { ...geometry, supportedEdges: [] } },
      window,
    ),
  );
});
