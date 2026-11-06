import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import fixture from "../../../tests/fixtures/amadeus-evaluation.json";
import { evaluate, parameterValues } from "../../src/shared/live2d/pose";
import type { CharacterDocument } from "../../src/shared/live2d/types";
import {
  avatarStates,
  boundPose,
} from "../../src/features/amadeus/avatarModel";

const archive = unzipSync(
  readFileSync(
    resolve(__dirname, "../../public/brand/amadeus/amadeus.fpllive2d"),
  ),
);
const document = (
  JSON.parse(strFromU8(archive["manifest.json"])) as {
    document: CharacterDocument;
  }
).document;

describe("Amadeus editable avatar", () => {
  it("maps every execution state to a real expression and motion", () => {
    expect(Object.keys(document.stateBindings).sort()).toEqual(
      [...avatarStates].sort(),
    );
    for (const state of avatarStates) {
      const { motion, expressionId } = boundPose(document, state);
      expect(motion.tracks.length).toBeGreaterThan(0);
      expect(
        document.expressions.some(
          (expression) => expression.id === expressionId,
        ),
      ).toBe(true);
    }
  });

  it("matches backend poses for all seven states", () => {
    for (const state of avatarStates) {
      const sample = fixture[state];
      const { motion, expressionId } = boundPose(document, state);
      const values = parameterValues(
        document,
        sample.frame,
        motion.id,
        expressionId,
      );
      for (const [key, expected] of Object.entries(sample.values)) {
        expect(values[key]).toBeCloseTo(expected, 8);
      }
      const parts = new Map(
        evaluate(document, values).parts.map((part) => [part.id, part]),
      );
      for (const [id, expected] of Object.entries(sample.parts)) {
        const part = parts.get(id);
        expect(part).toBeDefined();
        expect(part!.opacity).toBeCloseTo(expected.opacity, 8);
        expect(part!.worldVertices[0].x).toBeCloseTo(expected.first.x, 8);
        expect(part!.worldVertices[0].y).toBeCloseTo(expected.first.y, 8);
        expect(part!.worldVertices.at(-1)!.x).toBeCloseTo(expected.last.x, 8);
        expect(part!.worldVertices.at(-1)!.y).toBeCloseTo(expected.last.y, 8);
      }
    }
  });
});
