const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  PetMotionGate,
  clampVisiblePet,
  motionRequest,
} = require("../dist/pet-motion.js");
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
