const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  collapsedAmadeusBounds,
  initialAmadeusBounds,
} = require("../dist/amadeus-window-geometry.js");

const workArea = { x: 0, y: 25, width: 1440, height: 875 };

test("new Amadeus windows open at a readable width", () => {
  const bounds = initialAmadeusBounds(undefined, workArea);
  assert.equal(bounds.width, 900);
  assert.equal(bounds.height, 760);
  assert.ok(bounds.x >= workArea.x);
  assert.ok(bounds.x + bounds.width <= workArea.x + workArea.width);
});

test("saved window width is restored and clamped to the active work area", () => {
  assert.equal(
    initialAmadeusBounds({ x: 700, y: 80, width: 520, height: 650 }, workArea)
      .width,
    520,
  );
  const movedDisplay = { x: 100, y: 30, width: 800, height: 600 };
  const restored = initialAmadeusBounds(
    { x: 1200, y: 800, width: 1100, height: 760 },
    movedDisplay,
  );
  assert.deepEqual(restored, { x: 100, y: 30, width: 800, height: 600 });
});

test("expanded stage stores the collapsed window width", () => {
  const expanded = { x: 180, y: 40, width: 1260, height: 760 };
  assert.deepEqual(collapsedAmadeusBounds(expanded, true, 900), {
    x: 540,
    y: 40,
    width: 900,
    height: 760,
  });
  assert.deepEqual(collapsedAmadeusBounds(expanded, false, 900), expanded);
});
