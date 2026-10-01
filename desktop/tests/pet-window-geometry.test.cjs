const { test } = require("node:test");
const assert = require("node:assert/strict");
const { clampPetBounds } = require("../dist/pet-window-geometry.js");

test("pet stays within the selected display work area", () => {
  const displays = [
    { x: 0, y: 25, width: 1280, height: 775 },
    { x: 1280, y: 0, width: 1920, height: 1080 },
  ];
  assert.deepEqual(
    clampPetBounds({ x: 3100, y: 990, width: 300, height: 400 }, displays),
    {
      x: 2900,
      y: 680,
      width: 300,
      height: 400,
    },
  );
  assert.deepEqual(
    clampPetBounds({ x: -80, y: -20, width: 300, height: 400 }, displays),
    {
      x: 0,
      y: 25,
      width: 300,
      height: 400,
    },
  );
});

test("pet size is clamped if a smaller display is attached", () => {
  const bounds = clampPetBounds({ x: 600, y: 400, width: 300, height: 400 }, [
    { x: 500, y: 200, width: 220, height: 250 },
  ]);
  assert.deepEqual(bounds, { x: 500, y: 200, width: 220, height: 250 });
});
