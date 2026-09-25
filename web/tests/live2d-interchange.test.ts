import { describe, expect, it } from "vitest";
import {
  exportCubismExpression,
  exportCubismMotion,
  inspectCubismImport,
} from "../src/features/live2d-workshop/cubismInterchange";
import { planPsdReimport } from "../src/features/live2d-workshop/psdReimport";
import type { CharacterDocument } from "../src/features/live2d-workshop/types";

const doc = {
  schemaVersion: 2,
  width: 256,
  height: 320,
  parts: [
    {
      id: "face",
      name: "脸部",
      group: "头部",
      assetId: "png",
      x: 20,
      y: 30,
      width: 80,
      height: 90,
    },
  ],
  deformers: [],
  parameters: [
    {
      id: "ParamSmile",
      name: "微笑",
      minimum: 0,
      maximum: 1,
      default: 0,
      bindings: [],
    },
  ],
  expressions: [],
  motions: [],
  stateBindings: {},
  cubismParameterIds: { ParamSmile: "Smile" },
} as unknown as CharacterDocument;

describe("Cubism parameter handoff", () => {
  it("imports mapped expression and reports flattening", () => {
    const preview = inspectCubismImport(
      {
        Version: 3,
        Type: "Live2D Expression",
        Parameters: [{ Id: "Smile", Value: 0.5, Blend: "Add" }],
      },
      "happy.exp3.json",
      doc,
    );
    expect(preview.expression?.values).toEqual({ ParamSmile: 0.5 });
    expect(preview.issues).toContainEqual(
      expect.objectContaining({ level: "warning" }),
    );
    expect(
      exportCubismExpression(doc, preview.expression!).Parameters[0],
    ).toEqual({
      Id: "Smile",
      Value: 0.5,
      Blend: "Overwrite",
    });
  });

  it("flattens Multiply and blocks values outside native range", () => {
    const multiplied = inspectCubismImport(
      {
        Type: "Live2D Expression",
        Parameters: [{ Id: "Smile", Value: 2, Blend: "Multiply" }],
      },
      "scale.exp3.json",
      { ...doc, parameters: [{ ...doc.parameters[0], default: 0.4 }] },
    );
    expect(multiplied.expression?.values.ParamSmile).toBeCloseTo(0.8);
    expect(multiplied.issues).toContainEqual(
      expect.objectContaining({ level: "warning" }),
    );
    const outside = inspectCubismImport(
      {
        Version: 3,
        Type: "Live2D Expression",
        Parameters: [{ Id: "Smile", Value: 2, Blend: "Overwrite" }],
      },
      "outside.exp3.json",
      doc,
    );
    expect(outside.issues).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: expect.stringContaining("越界"),
      }),
    );
  });

  it("blocks missing IDs and unsupported model tracks", () => {
    const preview = inspectCubismImport(
      {
        Version: 3,
        Meta: { Duration: 1, Fps: 30 },
        Curves: [
          { Target: "Parameter", Id: "Unknown", Segments: [0, 0, 0, 1, 1] },
          { Target: "Model", Id: "Opacity", Segments: [0, 1, 0, 1, 1] },
        ],
      },
      "test.motion3.json",
      doc,
    );
    expect(
      preview.issues.filter((issue) => issue.level === "error"),
    ).toHaveLength(3);
  });

  it("samples Bezier curves and exports standard metadata", () => {
    const preview = inspectCubismImport(
      {
        Version: 3,
        Meta: { Duration: 1, Fps: 30 },
        Curves: [
          {
            Target: "Parameter",
            Id: "Smile",
            Segments: [0, 0, 1, 1 / 3, 0, 2 / 3, 1, 1, 1],
          },
        ],
      },
      "smile.motion3.json",
      doc,
    );
    expect(preview.issues.some((issue) => issue.level === "error")).toBe(false);
    expect(preview.issues.some((issue) => issue.level === "warning")).toBe(
      true,
    );
    expect(preview.motion?.tracks[0].keys.at(-1)?.value).toBeCloseTo(1);
    const exported = exportCubismMotion(doc, preview.motion!);
    expect(exported.Meta.CurveCount).toBe(1);
    expect(exported.Curves[0].Id).toBe("Smile");
    expect(exported.Meta.TotalSegmentCount).toBe(
      preview.motion!.tracks[0].keys.length - 1,
    );
  });

  it("reports per-track fades and nonlooping motion", () => {
    const preview = inspectCubismImport(
      {
        Version: 3,
        Meta: { Duration: 1, Fps: 30, Loop: false },
        Curves: [
          {
            Target: "Parameter",
            Id: "Smile",
            FadeInTime: 0.2,
            Segments: [0, 0, 0, 1, 1],
          },
        ],
      },
      "once.motion3.json",
      doc,
    );
    expect(
      preview.issues.filter((issue) => issue.level === "warning"),
    ).toHaveLength(2);
  });

  it("exports a constant one-key track as a valid full-length segment", () => {
    const exported = exportCubismMotion(doc, {
      id: "constant",
      name: "静止",
      fps: 30,
      duration: 30,
      loopStart: 0,
      loopEnd: 30,
      tracks: [
        {
          parameterId: "ParamSmile",
          keys: [{ frame: 12, value: 0.4, interpolation: "hold" }],
        },
      ],
    });
    expect(exported.Curves[0].Segments).toEqual([0, 0.4, 0, 1, 0.4]);
    expect(exported.Meta.TotalSegmentCount).toBe(1);
    expect(exported.Meta.TotalPointCount).toBe(2);
  });
});

describe("PSD layer reimport", () => {
  it("preserves a matching rig and rejects geometry changes", () => {
    const same = planPsdReimport(
      doc,
      [
        {
          name: "脸部",
          group: "头部",
          x: 20,
          y: 30,
          width: 80,
          height: 90,
        },
      ],
      { width: 256, height: 320 },
    );
    expect(same.matches.get(0)).toBe("face");
    expect(same.errors).toEqual([]);
    const changed = planPsdReimport(
      doc,
      [
        {
          name: "脸部",
          group: "头部",
          x: 20,
          y: 30,
          width: 81,
          height: 90,
        },
      ],
      { width: 256, height: 320 },
    );
    expect(changed.errors.join(" ")).toContain("尺寸或位置变化");
  });
});
