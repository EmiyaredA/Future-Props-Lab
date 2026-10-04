import { expect, test } from "vitest";
import {
  buildRegionMesh,
  gridMesh,
  validateMesh,
  type MeshGeometry,
} from "../src/features/desktop-pet/whale-vendor/rig/meshGeometry.js";
import {
  createRig,
  type RigState,
} from "../src/features/desktop-pet/whale-vendor/rig/rig.js";

type Point = [number, number];
const at = (mesh: MeshGeometry, i: number): Point => [
  mesh.positions[2 * i],
  mesh.positions[2 * i + 1],
];
const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function triangles(mesh: MeshGeometry) {
  return Array.from({ length: mesh.indices.length / 3 }, (_, i) =>
    Array.from(mesh.indices.slice(3 * i, 3 * i + 3)),
  );
}
function area(mesh: MeshGeometry) {
  return triangles(mesh).reduce(
    (sum, [a, b, c]) => sum + cross(at(mesh, a), at(mesh, b), at(mesh, c)) / 2,
    0,
  );
}
function contains(p: Point, polygon: number[][]) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      hit = !hit;
  }
  return hit;
}
function captureRenderer(mesh?: MeshGeometry) {
  let vertices = new Float32Array(),
    drawType = 0;
  const constants = new Map<PropertyKey, number>();
  const gl = new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === "getShaderParameter" || key === "getProgramParameter")
          return () => true;
        if (key === "bufferSubData")
          return (_target: number, _offset: number, value: Float32Array) => {
            vertices = new Float32Array(value);
          };
        if (key === "drawElements")
          return (_mode: number, _count: number, type: number) => {
            drawType = type;
          };
        if (/^[A-Z_0-9]+$/.test(String(key))) {
          if (!constants.has(key)) constants.set(key, constants.size + 1);
          return constants.get(key);
        }
        return () => ({});
      },
    },
  );
  const grid = gridMesh({ box: [0, 0, 8, 8], grid: [2, 2] });
  const rig = createRig(
    {
      width: 64,
      height: 64,
      getContext: () => gl,
    } as unknown as HTMLCanvasElement,
    {
      view: [0, 0, 8, 8],
      parts: [
        {
          id: "whole",
          tex: "original-png",
          box: [0, 0, 8, 8],
          grid: [2, 2],
          parent: "body",
          z: 0,
          mesh,
          // Deliberately different vertex count. Compiled meshes must consume
          // their recomputed weights, never these old rectangular-grid weights.
          skin: [
            {
              deformer: "leg",
              weights: grid.owners.map((_, i) => (at(grid, i)[0] < 3 ? 1 : 0)),
            },
          ],
        },
      ],
      deformers: {
        body: { kind: "rot", pivot: [0, 0] },
        leg: { kind: "rot", pivot: [0, 0], parent: "body" },
      },
    },
  );
  rig.upload("original-png", {} as TexImageSource);
  return {
    rig,
    render: (state: RigState) => {
      rig.render(state);
      return { vertices, drawType };
    },
    constant: (key: string) => constants.get(key),
  };
}

test("legacy grids preserve their indices, winding and original atlas coordinates", () => {
  const mesh = gridMesh({
    box: [10, 20, 8, 4],
    grid: [2, 1],
    uvBox: [0.25, 0.5, 0.75, 1],
  });
  expect([...mesh.positions]).toEqual([
    10, 20, 14, 20, 18, 20, 10, 24, 14, 24, 18, 24,
  ]);
  expect([...mesh.indices]).toEqual([0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4]);
  expect([...mesh.uv]).toEqual([
    0.25, 0.5, 0.5, 0.5, 0.75, 0.5, 0.25, 1, 0.5, 1, 0.75, 1,
  ]);
  expect(area(mesh)).toBe(32);
  expect(mesh.owners).toEqual(Array(6).fill(null));
});

test("concave overlapping regions retain all source area and each triangle has one owner", () => {
  const source = {
    box: [10, 20, 8, 8],
    grid: [4, 4],
    uvBox: [0.2, 0.3, 0.8, 0.9],
  };
  const regions = [
    {
      id: "near",
      polygon: [
        [11, 21],
        [16, 21],
        [16, 23],
        [13, 23],
        [13, 27],
        [11, 27],
      ],
    },
    {
      id: "far",
      polygon: [
        [12, 22],
        [17, 22],
        [17, 27],
        [12, 27],
      ],
    },
  ];
  const mesh = buildRegionMesh(source, regions);
  expect(area(mesh)).toBeCloseTo(64, 6);
  const faces = triangles(mesh);
  for (const face of faces) {
    const center = [0, 1].map(
      (axis) => face.reduce((sum, i) => sum + at(mesh, i)[axis], 0) / 3,
    ) as Point;
    const owner =
      regions.find((region) => contains(center, region.polygon))?.id ?? null;
    expect(face.map((i) => mesh.owners[i])).toEqual([owner, owner, owner]);
    expect(
      cross(...(face.map((i) => at(mesh, i)) as [Point, Point, Point])),
    ).toBeGreaterThan(0);
  }
  for (let i = 0; i < mesh.owners.length; i++) {
    const p = at(mesh, i);
    expect(mesh.uv[i * 2]).toBeCloseTo(0.2 + ((p[0] - 10) / 8) * 0.6, 6);
    expect(mesh.uv[i * 2 + 1]).toBeCloseTo(0.3 + ((p[1] - 20) / 8) * 0.6, 6);
  }
  // Non-grid sample points must have exactly one original-area owner; no faces
  // have been deleted to conceal animated inversions or transparent gaps.
  for (let y = 20.071; y < 28; y += 0.271)
    for (let x = 10.043; x < 18; x += 0.233) {
      const p: Point = [x, y];
      const coverage = faces.map((face) => {
        const [a, b, c] = face.map((i) => at(mesh, i));
        return Math.min(cross(a, b, p), cross(b, c, p), cross(c, a, p));
      });
      expect(
        coverage.filter((value) => value >= -1e-7).length,
        `source sample ${x},${y}`,
      ).toBeGreaterThanOrEqual(1);
      // A point exactly on a shared grid diagonal has two closed-set faces,
      // but their interiors never overlap.
      expect(
        coverage.filter((value) => value > 1e-7).length,
      ).toBeLessThanOrEqual(1);
    }
  const points = new Map<string, Set<string | null>>();
  for (let i = 0; i < mesh.owners.length; i++) {
    const key = at(mesh, i).join(":");
    const owners = points.get(key) ?? new Set();
    owners.add(mesh.owners[i]);
    points.set(key, owners);
  }
  expect([...points.values()].some((owners) => owners.size > 1)).toBe(true);
  expect(mesh.owners).toContain(null);
});

test("actual renderer vertices cannot interpolate across a limb boundary", () => {
  const mesh = buildRegionMesh({ box: [0, 0, 8, 8], grid: [2, 2] }, [
    {
      id: "leg",
      polygon: [
        [0, 0],
        [3, 0],
        [3, 8],
        [0, 8],
      ],
    },
  ]);
  mesh.skin = [
    {
      deformer: "leg",
      weights: mesh.owners.map((owner) => (owner === "leg" ? 1 : 0)),
    },
  ];
  const renderer = captureRenderer(mesh);
  const legacy = captureRenderer();
  const state: RigState = { alpha: {}, body: {}, leg: { tx: 6 } };
  const actual = renderer.render(state).vertices;
  for (let i = 0; i < mesh.owners.length; i++) {
    expect(actual[2 * i]).toBeCloseTo(
      at(mesh, i)[0] + (mesh.owners[i] === "leg" ? 6 : 0),
      6,
    );
    expect(actual[2 * i + 1]).toBeCloseTo(at(mesh, i)[1], 6);
  }
  for (const [a, b, c] of triangles(mesh)) {
    const moved = (i: number): Point => [actual[2 * i], actual[2 * i + 1]];
    expect(cross(moved(a), moved(b), moved(c))).toBeCloseTo(
      cross(at(mesh, a), at(mesh, b), at(mesh, c)),
      6,
    );
  }
  const old = legacy.render(state).vertices;
  const oldMesh = gridMesh({ box: [0, 0, 8, 8], grid: [2, 2] });
  expect(
    triangles(oldMesh).some(
      ([a, b, c]) =>
        cross(
          [old[2 * a], old[2 * a + 1]],
          [old[2 * b], old[2 * b + 1]],
          [old[2 * c], old[2 * c + 1]],
        ) < 0,
    ),
  ).toBe(true);
});

test("compiled geometry supports Uint32 index buffers without silently narrowing indices", () => {
  const positions = new Float32Array(65537 * 2);
  positions[65535 * 2] = 8;
  positions[65536 * 2 + 1] = 8;
  const mesh: MeshGeometry = {
    positions,
    uv: new Float32Array(positions.length),
    indices: new Uint32Array([0, 65535, 65536]),
    owners: Array(65537).fill(null),
  };
  const renderer = captureRenderer(mesh);
  const result = renderer.render({ alpha: {} });
  expect(result.drawType).toBe(renderer.constant("UNSIGNED_INT"));
  expect(result.vertices[65535 * 2]).toBe(8);
});

test.each([
  { box: [0, 0, 0, 10] },
  { box: [0, 0, 10, 10], grid: [1.5, 2] },
  { box: [0, 0, Infinity, 10] },
])("invalid mesh source is rejected before buffer creation: %j", (source) => {
  expect(() => gridMesh(source)).toThrow("Invalid rig mesh source");
});

test("region identities and compiled weight shapes are validated", () => {
  const source = { box: [0, 0, 8, 8] },
    polygon = [
      [0, 0],
      [3, 0],
      [3, 8],
      [0, 8],
    ];
  expect(() =>
    buildRegionMesh(source, [
      { id: "leg", polygon },
      { id: "leg", polygon },
    ]),
  ).toThrow();
  expect(() =>
    buildRegionMesh(source, [
      {
        id: "leg",
        polygon: [
          [0, 0],
          [NaN, 1],
          [0, 2],
        ],
      },
    ]),
  ).toThrow();
  const mesh = gridMesh(source);
  expect(() => validateMesh({ ...mesh, owners: [] })).toThrow();
  expect(() =>
    validateMesh({ ...mesh, skin: [{ deformer: "leg", weights: [1] }] }),
  ).toThrow();
  expect(() =>
    validateMesh({
      ...mesh,
      skin: [
        { deformer: "leg", weights: mesh.owners.map(() => 0.6) },
        { deformer: "other", weights: mesh.owners.map(() => 0.6) },
      ],
    }),
  ).toThrow("weight sum");
});
