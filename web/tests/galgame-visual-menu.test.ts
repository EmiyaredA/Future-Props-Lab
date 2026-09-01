import { expect, test } from "vitest";
import { visualMenuPosition } from "@features/galgame-workshop/editor/visuals/model";

const menu = { width: 236, height: 220 };

test("places the visual item menu beside its trigger when space is available", () => {
  expect(
    visualMenuPosition({ left: 90, right: 120, top: 100, bottom: 130 }, menu, {
      width: 900,
      height: 700,
    }),
  ).toEqual({ left: 124, top: 134 });
});

test("moves the visual item menu left or upward near viewport edges", () => {
  expect(
    visualMenuPosition({ left: 300, right: 330, top: 500, bottom: 530 }, menu, {
      width: 540,
      height: 640,
    }),
  ).toEqual({ left: 60, top: 276 });
});

test("clamps the visual item menu within a small viewport", () => {
  expect(
    visualMenuPosition(
      { left: 6, right: 36, top: 10, bottom: 40 },
      { width: 260, height: 300 },
      { width: 240, height: 280 },
    ),
  ).toEqual({ left: 8, top: 8 });
});

test("keeps the visual item menu clear of the left viewport edge", () => {
  expect(
    visualMenuPosition(
      { left: 0, right: 2, top: 20, bottom: 50 },
      { width: 120, height: 100 },
      { width: 400, height: 300 },
    ),
  ).toEqual({ left: 8, top: 54 });
});
