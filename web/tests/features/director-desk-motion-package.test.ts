import { expect, it } from "vitest";
import { demoProject } from "@features/director-desk/editor/model";
import { includeMotionResources } from "@features/director-desk/editor/animation/motion-presets";
import { BUILTIN_MOTION_RESOURCE_ID } from "@features/director-desk/editor/animation/motion-catalog";

it("retains the embedded, validated motion package for offline/test execution", async () => {
  const original = demoProject();
  const before = JSON.stringify(original);
  const next = await includeMotionResources(original);
  expect(
    next.resources?.some(
      (resource) => resource.id === BUILTIN_MOTION_RESOURCE_ID,
    ),
  ).toBe(true);
  expect(JSON.stringify(original)).toBe(before);
  expect(await includeMotionResources(next)).toBe(next);
});
