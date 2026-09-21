import { expect, it } from "vitest";
import {
  defaultEnd,
  exportCrop,
  outputSize,
} from "../src/features/live2d-workshop/exportSettings";
import type { CharacterDocument } from "../src/features/live2d-workshop/types";
import fixture from "../../tests/fixtures/live2d-evaluation.json";
it("uses selected motion duration, converts frame rate, and emits one static frame", () => {
  const doc = fixture.document as CharacterDocument;
  expect(defaultEnd(doc, [], 30)).toBe(1);
  const motion = doc.motions[0];
  expect(defaultEnd(doc, [motion.id], 60)).toBe(
    Math.floor((motion.duration / motion.fps) * 60),
  );
});
it("keeps full portrait canvas proportional and provides centered square crop", () => {
  const doc = {
    ...fixture.document,
    width: 1200,
    height: 1600,
  } as CharacterDocument;
  const crop = exportCrop(doc, "full", { x: 0, y: 0, width: 1, height: 1 });
  expect(outputSize(600, crop)).toEqual({ width: 600, height: 800 });
  expect(exportCrop(doc, "square", crop)).toEqual({
    x: 0,
    y: 200,
    width: 1200,
    height: 1200,
  });
});
