import { describe, expect, it } from "vitest";
import fixture from "../../tests/fixtures/live2d-evaluation.json";
import {
  captureKey,
  clearBindings,
  copy,
  evaluate,
  grid,
  parameterValues,
  triangulate,
} from "../src/features/live2d-workshop/model";
import type { CharacterDocument } from "../src/features/live2d-workshop/types";
describe("native character parameter evaluation", () => {
  const document = fixture.document as CharacterDocument;
  it("matches the Python fixture and lets animated parameters override expressions", () => {
    const values = parameterValues(
      document,
      fixture.frame,
      fixture.motionId,
      fixture.expressionId,
    );
    expect(values).toEqual(fixture.values);
    const parts = evaluate(document, values).parts;
    parts[0].worldVertices.forEach((p, i) => {
      expect(p.x).toBeCloseTo(fixture.vertices[i].x, 8);
      expect(p.y).toBeCloseTo(fixture.vertices[i].y, 8);
    });
  });
  it("retains unanimated expression parameters and clamps preview values", () => {
    const doc = copy(document);
    doc.motions[0].tracks = doc.motions[0].tracks.filter(
      (t) => t.parameterId !== "smile",
    );
    expect(parameterValues(doc, 15, "nod", "smile-exp")).toEqual({
      turn: 45,
      smile: 1,
    });
    expect(
      parameterValues(doc, 0, undefined, undefined, { turn: 120 }),
    ).toEqual({ turn: 90, smile: 0 });
  });
  it("keeps keyforms independent of motion keyframes and clears only the affected topology", () => {
    const doc = copy(document),
      motion = copy(doc.motions);
    const target = copy(doc.parts[0]);
    target.vertices[0].y = 8;
    captureKey(doc, "smile", "face", 0.75, target);
    expect(
      doc.parameters[1].bindings[0].keys.find((k) => k.value === 0.75)
        ?.points?.[0].y,
    ).toBe(8);
    expect(doc.motions).toEqual(motion);
    clearBindings(doc, "face");
    expect(doc.parameters[1].bindings).toEqual([]);
    expect(doc.parameters[0].bindings).toHaveLength(1);
  });
  it("triangulates regenerated topology without changing its texture coordinates", () => {
    const mesh = grid(16, 16, 2, 2),
      part = { ...copy(document.parts[0]), ...mesh };
    const uv = copy(part.uvs);
    triangulate(part);
    expect(part.triangles).toHaveLength(24);
    expect(part.uvs).toEqual(uv);
    expect(Math.max(...part.triangles)).toBeLessThan(9);
  });
  it("interpolates a nested warp followed by rotation", () => {
    const doc = copy(document);
    doc.parameters = [];
    doc.deformers.push({
      id: "warp",
      name: "curve",
      kind: "warp",
      parentId: "head",
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      rows: 1,
      columns: 1,
      rotation: 0,
      scale: 1,
      points: [
        { x: 0, y: 0 },
        { x: 64, y: 0 },
        { x: 0, y: 32 },
        { x: 64, y: 32 },
      ],
    });
    doc.parts[0].parentId = "warp";
    doc.deformers[0].rotation = 90;
    const point = evaluate(doc, {}).parts[0].worldVertices[0];
    expect(point.x).toBeCloseTo(24);
    expect(point.y).toBeCloseTo(16);
  });
});

describe("keyform insertion", () => {
  it("preserves the isolated parameter interpolation instead of resetting to the base", () => {
    const doc = copy(fixture.document as CharacterDocument);
    const values = parameterValues(doc, 0, undefined, undefined, {
      smile: 0.5,
    });
    const before = evaluate(doc, values);
    captureKey(doc, "smile", "face", 0.5);
    const after = evaluate(doc, values);
    expect(after).toEqual(before);
    expect(
      doc.parameters[1].bindings[0].keys.find((k) => k.value === 0.5)?.points,
    ).toEqual(before.parts[0].vertices);
    expect(
      evaluate(
        doc,
        parameterValues(doc, 0, undefined, undefined, { smile: 1 }),
      ),
    ).not.toEqual(after);
  });
});
