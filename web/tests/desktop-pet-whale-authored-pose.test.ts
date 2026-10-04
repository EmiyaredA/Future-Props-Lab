import { afterEach, expect, test, vi } from "vitest";
import geometry from "./fixtures/desktop-pet-motion-v2.json";
import walk from "./fixtures/desktop-pet-calibrated-walk.json";
import { naturalWalkRegistration } from "./fixtures/natural-walk-registration";
import {
  bindWhaleAuthoredParts,
  projectWhaleFace,
  readWhaleAuthoredRig,
  whaleLayerSlots,
  whalePosePartIds,
  type WhaleAuthoredRig,
  type WhalePose,
} from "../src/features/desktop-pet/locomotion/whaleAuthored";
import { whaleMotionRig } from "../src/features/desktop-pet/locomotion/whaleRig";
import {
  demoMotion,
  type MotionDemo,
} from "../src/features/desktop-pet/locomotion/demo";
import {
  createRig,
  type RigPart,
  type RigState,
  type Deformer,
} from "../src/features/desktop-pet/whale-vendor/rig/rig.js";
import {
  createWhaleFigure,
  type WhaleFrame,
} from "../src/features/desktop-pet/whale-vendor/whale/figure.js";
import { whaleTextureLibrary } from "../src/features/desktop-pet/whale-vendor/whale/textures";
import type {
  PoseName,
  PoseLimb,
  AuthoredPose,
} from "../src/features/desktop-pet/locomotion/authoredPose";
import type { Point } from "../src/features/desktop-pet/locomotion/articulation";
import type { PoseTransition } from "../src/features/desktop-pet/locomotion/motionTransitions";
import type { PetEdge } from "../src/platform/petMotion";

// Synthetic registered geometry exercises the real solver/renderer. It is not approved whale artwork.
function model() {
  const standing = [
    "body",
    "skirt",
    "skirt_sit",
    "tail",
    "hair_back",
    "bangs",
    "brows",
    "eye_creases",
    "arm_near",
    "arm_far",
    "leg_back",
    "leg_front",
  ];
  const parts: RigPart[] = standing.map((id) => ({
    id,
    tex: id,
    parent: "body",
    box: [20, 20, 80, 80],
    z: 1,
    grid: [2, 2],
  }));
  const poses = Object.fromEntries(
    Object.entries(geometry.poses).map(([name, raw]) => {
      const source =
        name === "walk" ? naturalWalkRegistration(walk as AuthoredPose) : raw;
      const limbs = Object.fromEntries(
        Object.entries(source.limbs).map(([key, value]) => {
          const { root, joint, end, region, limits, bend } = value;
          const contact = "contact" in value ? value.contact : undefined;
          const limb: PoseLimb = {
            root: [...root] as Point,
            joint: [...joint] as Point,
            end: [...end] as Point,
            region: region.map((p) => [...p] as Point),
            limits: [...limits] as PoseLimb["limits"],
            bend: bend as -1 | 1,
            contact: Array.isArray(contact)
              ? [Number(contact[0]), Number(contact[1])]
              : undefined,
            segments: [
              `${name}_${key}_upper`,
              `${name}_${key}_lower`,
              `${name}_${key}_distal`,
            ],
          };
          return [key, limb];
        }),
      ) as WhalePose["limbs"];
      // Do not retain the human face or head protocol from the geometry-only fixture.
      const pose: WhalePose = {
        part: `pose_${name}`,
        waist: [...source.waist] as Point,
        neck: [128, 128],
        limbs,
        edges: structuredClone(source.edges) as WhalePose["edges"],
        stride: name === "walk" ? 32 : 16,
        layers: Object.fromEntries(
          whaleLayerSlots.map((slot) => [slot, [`${name}_${slot}`]]),
        ) as WhalePose["layers"],
        face: {
          kind: "whale",
          transform: [0.2, 0, 0, 0.2, 100, 40],
          clip: [
            [80, 20],
            [200, 20],
            [200, 130],
            [80, 130],
          ],
        },
      };
      for (const id of whalePosePartIds(pose))
        parts.push({
          id,
          tex: "body",
          parent: "body",
          box: [30, 30, 50, 50],
          grid: [4, 4],
          z: id.includes("headFront") ? 12 : 4,
        });
      return [name, pose];
    }),
  ) as Record<PoseName, WhalePose>;
  const rig: WhaleAuthoredRig = {
    version: 2,
    waist: [128, 188],
    neck: [128, 128],
    hiddenParts: standing,
    supportedEdges: ["left", "right", "top", "bottom"],
    poses,
  };
  const eye = {
    ball: [600, 620, 660, 680],
    iris: [610, 630, 650, 670],
    lash: [600, 620, 660, 640],
    rim: [600, 670, 660, 680],
    lidFit: [0, 0, 625],
    rimFit: [0, 0, 678],
  };
  return {
    rigProfile: "whale",
    units: { S: 0.19, X0: 650, FEET: 1363 },
    view: [-12, -8, 268, 272],
    parts,
    pivots: Object.fromEntries(
      [
        "body",
        "waist",
        "neck",
        "armNear",
        "armFar",
        "legBack",
        "legFront",
        "tail",
        "finNear",
        "finFar",
        "ahoge",
      ].map((key) => [key, [128, 128] as Point]),
    ),
    feat: {
      sprites: {
        neutral_mouth: [750, 760, 770, 780],
        happy_mouth: [750, 760, 770, 780],
      },
      eyes: {
        eyeL: eye,
        eyeR: {
          ...eye,
          ball: [780, 620, 820, 680],
          iris: [790, 630, 810, 670],
          lash: [780, 620, 820, 640],
        },
      },
    },
    schemes: [{ id: "deepseek" }, { id: "harness" }],
    motionRig: rig,
  };
}
function gpu() {
  const methods = new Map<string, ReturnType<typeof vi.fn>>();
  const gl = new Proxy(
    {},
    {
      get: (_, key) => {
        const name = String(key);
        if (!methods.has(name))
          methods.set(
            name,
            vi.fn(() =>
              name === "getShaderParameter" || name === "getProgramParameter"
                ? true
                : name === "getExtension"
                  ? { loseContext() {} }
                  : {},
            ),
          );
        return methods.get(name);
      },
    },
  );
  return { gl, methods };
}
function renderer(adapted: {
  parts: RigPart[];
  deformers: Record<string, Deformer>;
  view: number[];
}) {
  const { gl } = gpu();
  return createRig({ getContext: () => gl } as unknown as HTMLCanvasElement, {
    parts: adapted.parts,
    deformers: adapted.deformers,
    view: adapted.view,
  });
}
const sourceDeformers = {
  body: { kind: "rot" as const, pivot: [128, 256] },
  neck: { kind: "rot" as const, parent: "body", pivot: [128, 128] },
  skirt: { kind: "warp" as const, parent: "body", rect: [0, 0, 256, 256] },
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function recovery(input: ReturnType<typeof model>): PoseTransition<WhalePose> {
  return {
    id: "held-rest",
    from: { pose: "held", facing: 1 },
    to: { pose: "stand", facing: 1 },
    durationMs: 300,
    keyframes: [
      { progress: 0, pose: "held" },
      { progress: 1, pose: structuredClone(input.motionRig.poses.walk) },
    ],
  };
}

test("optional native whale transitions validate whole views without duplicate GPU bindings", () => {
  const input = model(),
    first = recovery(input);
  const second: PoseTransition<WhalePose> = {
    id: "start",
    from: { pose: "stand", facing: 1 },
    to: { pose: "walk", facing: 1 },
    durationMs: 250,
    keyframes: [
      { progress: 0, pose: structuredClone(input.motionRig.poses.walk) },
      { progress: 1, pose: "walk" },
    ],
  };
  input.motionRig.transitions = [first, second];
  const source = structuredClone(input);
  const checked = readWhaleAuthoredRig(input.motionRig, input.parts)!;
  expect(checked.transitions).toEqual([first, second]);
  expect(input).toEqual(source);
  expect(bindWhaleAuthoredParts(input.parts, checked)).toHaveLength(
    input.parts.length,
  );
  expect(
    whaleMotionRig(input, sourceDeformers).authored!.getMotionFailure(),
  ).toBeNull();
});

test.each([null, {}, false, "bad", [null], Array(33).fill(null)])(
  "native whale boundary rejects invalid transition container %j",
  (transitions) => {
    const input = model();
    expect(() =>
      readWhaleAuthoredRig({ ...input.motionRig, transitions }, input.parts),
    ).toThrow("动作过渡");
  },
);

test("native whale transition reader rejects every invalid temporal, endpoint and binding shape", () => {
  const input = model(),
    good = recovery(input),
    final = structuredClone(input.motionRig.poses.walk);
  const frames = (last: unknown) => [{ progress: 0, pose: "held" }, last];
  const invalid = [
    { ...good, extra: "bad" },
    { ...good, id: "../unsafe" },
    ...[true, NaN, Infinity, 79, 1501].map((durationMs) => ({
      ...good,
      durationMs,
    })),
    { ...good, from: { pose: "held", facing: true } },
    { ...good, to: { pose: "stand", facing: 1, edge: null } },
    { ...good, to: { pose: "unknown", facing: 1 } },
    { ...good, keyframes: frames({ progress: 0.9, pose: final }) },
    { ...good, keyframes: frames({ progress: NaN, pose: final }) },
    { ...good, keyframes: frames({ progress: 1, pose: "stand" }) },
    {
      ...good,
      keyframes: frames({ progress: 1, pose: final, supports: null }),
    },
    {
      ...good,
      keyframes: frames({
        progress: 1,
        pose: { ...final, head: { part: "body", neck: [1, 2] } },
      }),
    },
    {
      ...good,
      keyframes: frames({
        progress: 1,
        pose: { ...final, face: { ...final.face, kind: "human" } },
      }),
    },
    {
      ...good,
      keyframes: frames({
        progress: 1,
        pose: {
          ...final,
          face: { ...final.face, transform: [-0.2, 0, 0, 0.2, 100, 100] },
        },
      }),
    },
    {
      ...good,
      keyframes: frames({ progress: 1, pose: { ...final, part: "missing" } }),
    },
    {
      ...good,
      keyframes: frames({
        progress: 1,
        pose: { ...final, waist: [final.waist[0] + 1, final.waist[1]] },
      }),
    },
  ];
  for (const value of invalid)
    expect(() =>
      readWhaleAuthoredRig(
        { ...input.motionRig, transitions: [value] },
        input.parts,
      ),
    ).toThrow();
  for (const transitions of [
    [good, good],
    [good, { ...good, id: "another" }],
  ])
    expect(() =>
      readWhaleAuthoredRig({ ...input.motionRig, transitions }, input.parts),
    ).toThrow();
});

function cornerRig(source: PetEdge, target: PetEdge) {
  const input = model();
  const seed = structuredClone(input.motionRig.poses.held);
  // This resource-reader fixture registers two soles on one synthetic floor.
  // Translating the complete second leg preserves its bones and contact offset.
  const shift = seed.limbs.legFront.end[1] - seed.limbs.legBack.end[1];
  const leg = seed.limbs.legBack;
  for (const point of [
    leg.root,
    leg.joint,
    leg.end,
    ...(leg.contact ? [leg.contact] : []),
    ...leg.region,
  ])
    point[1] += shift;
  // Synthetic common contact registration checks the actual resource reader, not anatomy artwork.
  for (const pose of Object.values(input.motionRig.poses))
    for (const limb of ["armNear", "armFar", "legBack", "legFront"] as const) {
      const segments = pose.limbs[limb].segments;
      pose.limbs[limb] = { ...structuredClone(seed.limbs[limb]), segments };
    }
  const contact = (limb: keyof WhalePose["limbs"], edge: PetEdge) => ({
    edge,
    point: [...(seed.limbs[limb].contact ?? seed.limbs[limb].end)] as Point,
  });
  const anchors = {
    left: { armNear: contact("armNear", "left") },
    right: { armNear: contact("armNear", "right") },
    top: { armFar: contact("armFar", "top") },
    bottom: {
      legBack: contact("legBack", "bottom"),
      legFront: contact("legFront", "bottom"),
    },
  };
  const names = {
    left: "side",
    right: "side",
    top: "top",
    bottom: "bottom",
  } as const;
  const transition: PoseTransition<WhalePose> = {
    id: `corner-${source}-${target}`,
    from: { pose: names[source], facing: 1, edge: source },
    to: { pose: names[target], facing: 1, edge: target },
    durationMs: 250,
    keyframes: [
      { progress: 0, pose: names[source], supports: anchors[source] },
      {
        progress: 0.5,
        pose: names[source],
        supports: structuredClone({ ...anchors[source], ...anchors[target] }),
      },
      { progress: 1, pose: names[target], supports: anchors[target] },
    ],
  };
  input.motionRig.transitions = [transition];
  return { input, transition };
}

test.each([
  ["left", "top"],
  ["right", "top"],
  ["left", "bottom"],
  ["right", "bottom"],
  ["top", "left"],
  ["top", "right"],
  ["bottom", "left"],
  ["bottom", "right"],
] as [PetEdge, PetEdge][])(
  "native %s→%s transfer keeps old support until new support exists",
  (from, to) => {
    const { input } = cornerRig(from, to);
    expect(
      readWhaleAuthoredRig(input.motionRig, input.parts)!.transitions,
    ).toHaveLength(1);
  },
);

test("native corner reader rejects lost contact, unsupported top/bottom and drifting anchor", () => {
  const { input, transition } = cornerRig("left", "top");
  const cases = [
    { ...transition.keyframes[1], supports: {} },
    {
      ...transition.keyframes[1],
      supports: { armFar: transition.keyframes[2].supports!.armFar },
    },
    {
      ...transition.keyframes[1],
      supports: {
        legFront: {
          edge: "top",
          point: input.motionRig.poses.top.limbs.legFront.end,
        },
      },
    },
    {
      ...transition.keyframes[1],
      supports: {
        legFront: {
          edge: "bottom",
          point: input.motionRig.poses.bottom.limbs.legFront.end,
        },
      },
    },
    {
      ...transition.keyframes[1],
      supports: { armNear: { edge: "left", point: [500, 500] } },
    },
  ];
  for (const frame of cases) {
    const keyframes = [transition.keyframes[0], frame, transition.keyframes[2]];
    expect(() =>
      readWhaleAuthoredRig(
        { ...input.motionRig, transitions: [{ ...transition, keyframes }] },
        input.parts,
      ),
    ).toThrow();
  }
  const drifting = structuredClone(transition);
  drifting.keyframes[0].supports!.armNear!.point[0] -= 0.75;
  drifting.keyframes[1].supports!.armNear!.point[0] += 0.75;
  expect(() =>
    readWhaleAuthoredRig(
      { ...input.motionRig, transitions: [drifting] },
      input.parts,
    ),
  ).toThrow();
});

test("native reader preserves explicit display basis and rejects invalid basis values", () => {
  const input = model(),
    t = recovery(input);
  t.keyframes[0].viewFacing = 1;
  t.keyframes[1].viewFacing = -1;
  expect(
    readWhaleAuthoredRig({ ...input.motionRig, transitions: [t] }, input.parts)!
      .transitions,
  ).toEqual([t]);
  for (const viewFacing of [
    undefined,
    null,
    false,
    0,
    2,
    NaN,
    Infinity,
    "left",
  ])
    expect(() =>
      readWhaleAuthoredRig(
        {
          ...input.motionRig,
          transitions: [
            {
              ...t,
              keyframes: [{ ...t.keyframes[0], viewFacing }, t.keyframes[1]],
            },
          ],
        },
        input.parts,
      ),
    ).toThrow();
});

test.each(["left", "top", "bottom"] as PetEdge[])(
  "native %s attach and release require endpoint supports",
  (edge) => {
    const { input, transition } = cornerRig(
      "left",
      edge === "left" ? "top" : edge,
    );
    const name = edge === "left" || edge === "right" ? "side" : edge;
    const anchors =
      edge === "left"
        ? transition.keyframes[0].supports!
        : transition.keyframes[2].supports!;
    for (const release of [false, true]) {
      const t: PoseTransition<WhalePose> = {
        id: "attach",
        from: release
          ? { pose: name, facing: 1, edge }
          : { pose: "held", facing: 1 },
        to: release
          ? { pose: "held", facing: 1 }
          : { pose: name, facing: 1, edge },
        durationMs: 250,
        keyframes: [
          { progress: 0, pose: release ? name : "held" },
          { progress: 1, pose: release ? "held" : name },
        ],
      };
      expect(() =>
        readWhaleAuthoredRig(
          { ...input.motionRig, transitions: [t] },
          input.parts,
        ),
      ).toThrow();
      t.keyframes[release ? 0 : 1].supports = structuredClone(anchors);
      expect(
        readWhaleAuthoredRig(
          { ...input.motionRig, transitions: [t] },
          input.parts,
        )!.transitions,
      ).toEqual([t]);
    }
  },
);

test("native same-edge turn cannot omit or replace all existing support limbs", () => {
  const { input, transition } = cornerRig("left", "top");
  const t: PoseTransition<WhalePose> = {
    id: "edge-turn",
    from: { pose: "side", facing: 1, edge: "left" },
    to: { pose: "side", facing: -1, edge: "left" },
    durationMs: 250,
    keyframes: [0, 1].map((progress) => ({
      progress,
      pose: "side",
      supports: structuredClone(transition.keyframes[0].supports),
    })),
  };
  expect(
    readWhaleAuthoredRig({ ...input.motionRig, transitions: [t] }, input.parts)!
      .transitions,
  ).toEqual([t]);
  for (const supports of [
    {},
    {
      armFar: {
        edge: "left",
        point: input.motionRig.poses.side.limbs.armFar.end,
      },
    },
  ])
    expect(() =>
      readWhaleAuthoredRig(
        {
          ...input.motionRig,
          transitions: [
            {
              ...t,
              keyframes: [t.keyframes[0], { ...t.keyframes[1], supports }],
            },
          ],
        },
        input.parts,
      ),
    ).toThrow();
});

test("real whale engine binds and renders complete inline cels with their own native layers and face", () => {
  const input = model();
  const inline = (prefix: string, x: number) => {
    const pose = structuredClone(input.motionRig.poses.held);
    const ids = new Map(
      whalePosePartIds(pose).map((id) => [id, `${prefix}_${id}`]),
    );
    for (const [id, next] of ids)
      input.parts.push({
        ...input.parts.find((p) => p.id === id)!,
        id: next,
        z: 17,
      });
    pose.part = ids.get(pose.part)!;
    for (const limb of Object.values(pose.limbs))
      limb.segments = limb.segments!.map((id) =>
        ids.get(id)!,
      ) as PoseLimb["segments"];
    for (const slot of whaleLayerSlots)
      pose.layers[slot] = pose.layers[slot].map((id) => ids.get(id)!);
    pose.face.transform[4] = x;
    return pose;
  };
  const stand = inline("stand", 101),
    mid = inline("middle", 103);
  input.motionRig.transitions = [
    {
      id: "pickup",
      from: { pose: "stand", facing: 1 },
      to: { pose: "held", facing: 1 },
      durationMs: 300,
      keyframes: [
        { progress: 0, pose: stand },
        { progress: 0.5, pose: mid },
        { progress: 1, pose: "held" },
      ],
    },
    {
      id: "release",
      from: { pose: "held", facing: 1 },
      to: { pose: "stand", facing: 1 },
      durationMs: 300,
      keyframes: [
        { progress: 0, pose: "held" },
        { progress: 1, pose: structuredClone(stand) },
      ],
    },
  ];
  const checked = readWhaleAuthoredRig(input.motionRig, input.parts)!;
  const adapted = whaleMotionRig(
      { ...input, motionRig: checked },
      sourceDeformers,
    ),
    engine = adapted.authored!;
  const defs = { ...adapted.deformers };
  for (const slot of whaleLayerSlots)
    defs[slot] = {
      kind: "rot",
      parent:
        slot.startsWith("head") || slot.startsWith("fin") ? "neck" : "body",
    };
  const rig = renderer({ ...adapted, deformers: defs });
  let rendered: RigState = { alpha: {} };
  const sample = (t: number, held: boolean) =>
    engine.apply(
      { t, mode: held ? "held" : "idle", swing: 0, sit: 0, facing: 1 },
      (rendered = { alpha: {} }),
    )!;
  expect(sample(0, false).pose).toEqual(stand);
  const start = sample(0.1, true);
  expect(start.view).toBe("transition:pickup:0");
  const middle = sample(0.26, true);
  expect(middle.pose).toEqual(mid);
  expect(engine.pose).toEqual(mid);
  expect(rendered.alpha[mid.layers.headFront[0]]).toBe(1);
  expect(rendered.alpha[stand.layers.headFront[0]]).toBe(0);
  const headPart = adapted.parts.find((p) => p.id === mid.layers.headFront[0])!;
  expect(headPart.parent).toBe("headFront");
  expect(headPart.z).toBe(17);
  expect(headPart.skin).toBeUndefined();
  for (const [name, limb] of Object.entries(mid.limbs)) {
    const actual = rig.point(
      `${name}End`,
      rendered,
      ...(limb.contact ?? limb.end),
    );
    expect(actual).toEqual(
      middle.endpoints[name as keyof typeof middle.endpoints],
    );
  }
  const { commands } = surfaces(),
    canvas = document.createElement("canvas"),
    source = document.createElement("canvas");
  canvas.width = canvas.height = 840;
  projectWhaleFace(
    canvas.getContext("2d")!,
    source,
    middle.pose.face,
    input.view,
  );
  expect(commands.find((c) => c.op === "transform")?.args).toEqual(
    mid.face.transform,
  );
  expect(sample(0.4, true).pose).toEqual(input.motionRig.poses.held);
  sample(0.5, false);
  expect(sample(0.81, false).pose).toEqual(stand);
  expect(engine.getMotionFailure()).toBeNull();
  engine.reset();
  expect(engine.pose).toBeNull();
  expect(sample(1, false).pose).toEqual(stand);
});

test("real whale engine refuses turning without authored display bases and does not invent absent stand views", () => {
  const input = model();
  input.motionRig.transitions = [
    {
      id: "start",
      from: { pose: "stand", facing: 1 },
      to: { pose: "walk", facing: 1 },
      durationMs: 300,
      keyframes: [
        { progress: 0, pose: structuredClone(input.motionRig.poses.walk) },
        { progress: 1, pose: "walk" },
      ],
    },
    {
      id: "turn",
      from: { pose: "walk", facing: 1 },
      to: { pose: "walk", facing: -1 },
      durationMs: 300,
      keyframes: [
        { progress: 0, pose: "walk" },
        { progress: 1, pose: "walk" },
      ],
    },
  ];
  const engine = whaleMotionRig(input, sourceDeformers).authored!;
  const apply = (t: number, mode: string, facing: number) =>
    engine.apply({ t, mode, facing, sit: 0, swing: 0 }, { alpha: {} });
  apply(0, "idle", 1);
  apply(0.1, "walk", 1);
  apply(0.4, "walk", 1);
  const before = engine.pose;
  apply(0.41, "walk", -1);
  expect(engine.getMotionFailure()).toBe("needs-authored-turn-basis");
  expect(engine.pose).toBe(before);
  expect(engine.displayFacing(-1, 0.8)).toBe(1);
  engine.reset();
  expect(engine.getMotionFailure()).toBeNull();
  input.motionRig.transitions = [];
  const missing = whaleMotionRig(input, sourceDeformers).authored!;
  expect(
    missing.apply(
      { t: 0, mode: "idle", facing: 1, sit: 0, swing: 0 },
      { alpha: {} },
    ),
  ).toBeNull();
  expect(missing.getMotionFailure()).toBe("needs-stand-view");
});

test("v2 requires complete native whale bindings and preserves the source model", () => {
  const input = model(),
    original = structuredClone(input);
  const checked = readWhaleAuthoredRig(input.motionRig, input.parts)!;
  const adapted = whaleMotionRig(input, sourceDeformers);
  expect(adapted.supportedEdges).toEqual(["left", "right", "top", "bottom"]);
  expect(adapted.rig).toBeNull();
  expect(adapted.authored).not.toBeNull();
  expect(adapted.view).toEqual(input.view);
  const bound = bindWhaleAuthoredParts(input.parts, checked);
  for (const pose of Object.values(checked.poses)) {
    for (const [slot, ids] of Object.entries(pose.layers))
      for (const id of ids) {
        const part = bound.find((p) => p.id === id)!;
        expect(part.parent).toBe(slot);
        expect(part.grid).toEqual([1, 1]);
        expect(part.skin).toBeUndefined();
        expect(part.z).toBe(input.parts.find((p) => p.id === id)!.z);
      }
  }
  expect(input).toEqual(original);
  expect(
    Object.values(checked.poses).every(
      (p) => p.face.kind === "whale" && !("eye" in p.face),
    ),
  ).toBe(true);
});

test.each([
  "supportedEdges",
  "poses",
  "layers",
  "projection",
  "duplicate",
  "sourceParent",
  "humanFace",
  "nonfinite",
])("incomplete or invalid %s cannot enable four-edge rendering", (invalid) => {
  const input = model();
  if (invalid === "supportedEdges") input.motionRig.supportedEdges.pop();
  if (invalid === "poses")
    delete (input.motionRig.poses as Partial<WhaleAuthoredRig["poses"]>).top;
  if (invalid === "layers") input.motionRig.poses.top.layers.headFront = [];
  if (invalid === "projection")
    input.motionRig.poses.top.face.transform = [-1, 0, 0, 1, 0, 0];
  if (invalid === "duplicate")
    input.motionRig.poses.top.layers.tail =
      input.motionRig.poses.walk.layers.tail;
  if (invalid === "sourceParent")
    input.parts.find((p) => p.id === "top_headFront")!.parent = "headFront";
  if (invalid === "humanFace")
    Object.assign(input.motionRig.poses.top.face, { eye: [0, 0, 1, 1] });
  if (invalid === "nonfinite") input.motionRig.poses.top.neck[0] = Infinity;
  expect(() => whaleMotionRig(input, sourceDeformers)).toThrow("版本二");
});

test("no imported rig retains legacy left/right behavior; missing legacy limb art declares no edge support", () => {
  const { motionRig, ...old } = model();
  expect(motionRig.version).toBe(2);
  old.parts = old.parts.filter(
    (p) =>
      !p.id.startsWith("pose_") &&
      !p.id.includes("_upper") &&
      !p.id.includes("_lower") &&
      !p.id.includes("_distal"),
  );
  const adapted = whaleMotionRig(old, sourceDeformers);
  expect(adapted.rig?.version).toBe(1);
  expect(adapted.authored).toBeNull();
  expect(adapted.supportedEdges).toEqual(["left", "right"]);
  expect(
    whaleMotionRig({ ...old, parts: [] }, sourceDeformers).supportedEdges,
  ).toEqual([]);
});

test.each([
  "walk-right",
  "held",
  "climb-left",
  "climb-right",
  "climb-top",
  "climb-bottom",
  "glide-right",
] as MotionDemo[])(
  "%s uses production pose sampling and rigid deformer geometry",
  (demo) => {
    const input = model(),
      adapted = whaleMotionRig(input, sourceDeformers),
      engine = adapted.authored!;
    // All layer ancestors used by this fixture are real fixed renderer-owned slots.
    const defs = {
      ...adapted.deformers,
      headBack: { kind: "rot" as const, parent: "neck" },
      headFront: { kind: "rot" as const, parent: "neck" },
      tail: { kind: "rot" as const, parent: "body" },
      finNear: { kind: "rot" as const, parent: "neck" },
      finFar: { kind: "rot" as const, parent: "neck" },
    };
    const rig = renderer({ ...adapted, deformers: defs });
    for (let frame = 0; frame < 120; frame++) {
      const t = frame / 60,
        motion = demoMotion(demo, t, demo.startsWith("walk") ? 32 : 16);
      const state: RigState = {
        alpha: {},
        body: { sx: 0.6 },
        neck: { a: 110 },
        finNear: { a: 80 },
      };
      const result = engine.apply(
        {
          t,
          mode: "idle",
          sit: 0,
          swing: 0,
          locomotion: motion,
          facing: motion.facing,
        },
        state,
      )!;
      expect(result.pose.face.kind).toBe("whale");
      expect(state.body.sx).toBe(1);
      expect(state.neck.pivot).toEqual(result.pose.neck);
      expect(state.finNear).toEqual({});
      for (const [name, limb] of Object.entries(result.pose.limbs)) {
        const a = rig.point(name, state, ...limb.root),
          b = rig.point(name, state, ...limb.joint);
        expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(
          Math.hypot(
            limb.joint[0] - limb.root[0],
            limb.joint[1] - limb.root[1],
          ),
          8,
        );
        expect(
          rig.point(`${name}End`, state, ...limb.end).every(Number.isFinite),
        ).toBe(true);
      }
      const visible = new Set(whalePosePartIds(result.pose));
      for (const part of input.parts)
        expect(state.alpha[part.id]).toBe(visible.has(part.id) ? 1 : 0);
      rig.render(state);
    }
  },
);

type CanvasCommand = { canvas: HTMLCanvasElement; op: string; args: unknown[] };
function surfaces(failures = new Set<string>()) {
  const commands: CanvasCommand[] = [],
    contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  const driver = gpu();
  const context = function (this: HTMLCanvasElement, kind: string) {
    if (kind === "webgl2") return driver.gl;
    if (!contexts.has(this)) {
      const target = { canvas: this };
      contexts.set(
        this,
        new Proxy(target, {
          get: (value, key) => {
            if (key === "canvas") return value.canvas;
            return (...args: unknown[]) => {
              commands.push({ canvas: value.canvas, op: String(key), args });
              return key === "createRadialGradient"
                ? { addColorStop() {} }
                : undefined;
            };
          },
          set: (value, key, next) => {
            commands.push({
              canvas: value.canvas,
              op: `set:${String(key)}`,
              args: [next],
            });
            return true;
          },
        }) as unknown as CanvasRenderingContext2D,
      );
    }
    return contexts.get(this);
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    context as typeof HTMLCanvasElement.prototype.getContext,
  );
  const loads: string[] = [];
  class TestImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    url = "";
    set src(url: string) {
      this.url = url;
      loads.push(url);
      queueMicrotask(() =>
        failures.delete(url) ? this.onerror?.() : this.onload?.(),
      );
    }
    get src() {
      return this.url;
    }
  }
  vi.stubGlobal("Image", TestImage);
  return { commands, loads, driver };
}
test("canonical whale face projection clips in model space and does not mirror or scale the body", () => {
  const { commands } = surfaces(),
    canvas = document.createElement("canvas");
  canvas.width = 840;
  canvas.height = 840;
  const source = document.createElement("canvas"),
    face = model().motionRig.poses.held.face;
  projectWhaleFace(canvas.getContext("2d")!, source, face, [-12, -8, 268, 272]);
  expect(
    commands.filter((c) => c.op === "setTransform").map((c) => c.args),
  ).toEqual([
    [1, 0, 0, 1, 0, 0],
    [3, 0, 0, 3, 36, 24],
  ]);
  expect(commands.findIndex((c) => c.op === "clip")).toBeLessThan(
    commands.findIndex((c) => c.op === "transform"),
  );
  expect(commands.find((c) => c.op === "transform")?.args).toEqual(
    face.transform,
  );
  expect(commands.find((c) => c.op === "drawImage")?.args).toEqual([
    source,
    0,
    0,
  ]);
});

function frame(t: number, demo: MotionDemo | null): WhaleFrame {
  const locomotion = demo ? demoMotion(demo, t, 32) : null;
  return {
    t,
    mode: "idle",
    face: "neutral",
    look: [3, -2],
    legs: [
      [110, 200, 110, 256],
      [140, 200, 140, 256],
    ],
    sit: 0,
    swing: 0,
    blink: 0,
    eyeClose: 0,
    locomotion,
    facing: locomotion?.facing ?? 1,
  };
}
test("real whale painter retains eye layers and updates preview without rebuilding GPU or reloading shared textures", async () => {
  const { commands, loads, driver } = surfaces(),
    input = model();
  const figure = await createWhaleFigure(undefined, {
    model: input,
    asset: (path) => path,
    scheme: "deepseek",
  });
  expect(loads.filter((path) => path === "tex/body.png")).toHaveLength(1);
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  Object.defineProperty(group, "getScreenCTM", {
    value: () => ({ a: 1, b: 0, c: 0, d: 1 }),
  });
  const face = {
    eyes: [
      { shape: "ring", rx: 16, ry: 16 },
      { shape: "ring", rx: 16, ry: 16 },
    ],
    gap: [50, 50],
    brows: "neutral",
  };
  figure.draw(group, face, frame(0, "held"));
  const programs = driver.methods.get("createProgram")!.mock.calls.length;
  const vaos = driver.methods.get("createVertexArray")!.mock.calls.length;
  const textures = driver.methods.get("createTexture")!.mock.calls.length;
  const images = commands
    .filter((c) => c.op === "drawImage")
    .flatMap((c) => c.args.slice(0, 1));
  for (const name of [
    "eyeL_ball",
    "eyeL_iris",
    "eyeL_lash",
    "eyeL_rim",
    "eyeR_ball",
    "eyeR_iris",
    "eyeR_lash",
  ])
    expect(
      images.some(
        (image) =>
          typeof image === "object" &&
          image !== null &&
          "url" in image &&
          image.url === `feat/${name}.png`,
      ),
    ).toBe(true);
  expect(
    commands.some(
      (command) =>
        command.op === "set:globalCompositeOperation" &&
        command.args[0] === "source-atop",
    ),
  ).toBe(true);
  expect(
    commands.some(
      (command) =>
        command.op === "set:globalCompositeOperation" &&
        command.args[0] === "destination-out",
    ),
  ).toBe(true);
  expect(figure.fixedScale).toBe(true);
  expect(figure.pickupPoint?.()).toEqual(input.motionRig.poses.held.waist);
  figure.draw(group, face, { ...frame(0.2, "climb-top"), eyeClose: 0.5 });
  expect(
    commands.some(
      (command) => command.op === "scale" && command.args[1] === 0.775,
    ),
  ).toBe(true);
  expect(group.getAttribute("data-pet-supported-edges")).toBe(
    "left,right,top,bottom",
  );
  expect(JSON.parse(group.getAttribute("data-pet-edges")!)).toEqual(
    input.motionRig.poses.top.edges,
  );
  expect(group.getAttribute("data-pet-stride")).toBe("16");
  figure.draw(group, { ...face, brows: "angry" }, frame(0.3, "climb-bottom"));
  figure.reset();
  figure.draw(group, face, frame(1, null));
  expect(group.getAttribute("data-pet-edges")).toBeNull();
  expect(driver.methods.get("createProgram")!.mock.calls).toHaveLength(
    programs,
  );
  expect(driver.methods.get("createVertexArray")!.mock.calls).toHaveLength(
    vaos,
  );
  expect(driver.methods.get("createTexture")!.mock.calls).toHaveLength(
    textures,
  );
  await figure.setScheme("harness", { fade: 0.1 });
  figure.draw(group, face, frame(2, "held"));
  figure.draw(group, face, frame(2.2, "held"));
  expect(
    loads.filter((path) => path === "schemes/harness/tex/body.png"),
  ).toHaveLength(1);
  expect(driver.methods.get("createProgram")!.mock.calls).toHaveLength(
    programs,
  );
  figure.dispose?.();
});

test("texture schemes share an in-flight load and preload does not reload successful images", async () => {
  const { loads } = surfaces();
  const library = whaleTextureLibrary(
    { parts: [{ tex: "same" }, { tex: "same" }], schemes: [{ id: "one" }] },
    ["mouth", "mouth"],
    (path) => path,
  );
  const a = library.loadScheme("one"),
    b = library.loadScheme("one");
  expect(a).toBe(b);
  await a;
  await library.loadScheme("one");
  expect(loads).toEqual(["tex/same.png", "feat/mouth.png"]);
});

test("failed scheme loading does not poison a later explicit retry", async () => {
  const { loads } = surfaces(new Set(["tex/body.png"]));
  const library = whaleTextureLibrary(
    { parts: [{ tex: "body" }] },
    [],
    (path) => path,
  );
  await expect(library.loadScheme("deepseek")).rejects.toThrow("贴图");
  expect(library.ready.deepseek).toBeUndefined();
  await expect(library.loadScheme("deepseek")).resolves.toHaveProperty(
    "tex.body",
  );
  expect(loads).toEqual(["tex/body.png", "tex/body.png"]);
});

test.each([
  "walk-left",
  "walk-right",
  "climb-left",
  "climb-right",
  "climb-top",
  "climb-bottom",
] as MotionDemo[])(
  "%s keeps actual planted contacts stable under confirmed world travel",
  (demo) => {
    const input = model(),
      adapted = whaleMotionRig(input, sourceDeformers),
      engine = adapted.authored!;
    const deformers = { ...adapted.deformers };
    for (const slot of whaleLayerSlots)
      deformers[slot] = {
        kind: "rot",
        parent:
          slot.startsWith("head") || slot.startsWith("fin") ? "neck" : "body",
      };
    const rig = renderer({ ...adapted, deformers });
    const anchors = new Map<string, number[]>();
    let maximumDrift = 0;
    for (let frame = 0; frame < 180; frame++) {
      const t = frame / 60,
        motion = demoMotion(demo, t, demo.startsWith("walk") ? 32 : 16);
      const state: RigState = { alpha: {} };
      const result = engine.apply(
        {
          t,
          mode: "idle",
          sit: 0,
          swing: 0,
          locomotion: motion,
          facing: motion.facing,
        },
        state,
      )!;
      for (const [name, limb] of Object.entries(result.pose.limbs)) {
        const contact = result.contacts[name as keyof typeof result.contacts];
        if (!contact || frame < 15) {
          anchors.delete(name);
          continue;
        }
        const p = rig.point(`${name}End`, state, ...(limb.contact ?? limb.end));
        const world = [
          p[0] * motion.facing + motion.travel!.x,
          p[1] + motion.travel!.y,
        ];
        const anchor = anchors.get(name);
        if (anchor)
          maximumDrift = Math.max(
            maximumDrift,
            Math.hypot(world[0] - anchor[0], world[1] - anchor[1]),
          );
        else anchors.set(name, world);
      }
    }
    expect(maximumDrift).toBeLessThan(1);
  },
);
