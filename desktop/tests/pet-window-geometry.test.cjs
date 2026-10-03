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

const { companionBounds } = require("../dist/pet-window-geometry.js");
test("companion swaps sides, follows the pet and fits small or offset displays", () => {
  const area = { x: 0, y: 25, width: 1280, height: 775 };
  const pet = { x: 900, y: 400, width: 300, height: 400 };
  const compact = companionBounds(pet, area, "compact");
  assert.equal(compact.side, "left");
  assert.deepEqual([compact.width, compact.height], [320, 240]);
  assert.equal(compact.x, pet.x - compact.width - 8);
  const expanded = companionBounds(pet, area, "expanded");
  assert.deepEqual([expanded.width, expanded.height], [360, 460]);
  const edge = companionBounds({ ...pet, x: 0 }, area, "compact");
  assert.equal(edge.side, "right");
  const tiny = companionBounds(
    pet,
    { x: 800, y: 400, width: 280, height: 200 },
    "expanded",
  );
  assert.deepEqual(tiny, {
    x: 800,
    y: 400,
    width: 280,
    height: 200,
    side: "left",
  });
});
