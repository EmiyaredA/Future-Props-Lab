import { expect, test } from "vitest";
import {
  AuthoredPoseAnimation,
  authoredViewBindings,
  bindAuthoredViews,
  type AuthoredPose,
  type PoseName,
  type PoseSample,
} from "../src/features/desktop-pet/locomotion/authoredPose";
import { authoredContactPoint } from "../src/features/desktop-pet/locomotion/transitions/transitionPlayer";
import type {
  PoseTransition,
  TransitionSupport,
} from "../src/features/desktop-pet/locomotion/motionTransitions";
import {
  jointDeformers,
  type ArticulationFrame,
  type LimbName,
  type MotionRig,
  type Point,
} from "../src/features/desktop-pet/locomotion/articulation";
import { createRig } from "../src/features/desktop-pet/whale-vendor/rig/rig.js";
import type { RigPart } from "../src/features/desktop-pet/whale-vendor/rig/rig.js";
import type { PetEdge } from "../src/platform/petMotion";
import { naturalWalkRegistration } from "./fixtures/natural-walk-registration";
import calibrated from "./fixtures/desktop-pet-calibrated-walk.json";

const names: PoseName[] = ["walk", "held", "side", "top", "bottom", "glide"];
const limbs: LimbName[] = ["armNear", "armFar", "legBack", "legFront"];
const scale = 220 / 256;
type NativePose = AuthoredPose & { nativeFeatures: { identity: string } };
/** Mathematical complete-cel registrations only; they do not certify any source raster. */
function pose(id: string, dx = 0, reflect = false): NativePose {
  const result = naturalWalkRegistration(
    calibrated as AuthoredPose,
  ) as NativePose;
  const point = (p: Point): Point => [(reflect ? 256 - p[0] : p[0]) + dx, p[1]];
  result.part = id;
  if (result.head) {
    result.head.part = `${id}_head`;
    result.head.neck = point(result.head.neck);
  }
  result.waist = point(result.waist);
  for (const name of limbs) {
    const limb = result.limbs[name];
    limb.segments = [
      `${id}_${name}_upper`,
      `${id}_${name}_lower`,
      `${id}_${name}_end`,
    ];
    delete limb.part;
    for (const key of ["root", "joint", "end", "contact"] as const)
      if (limb[key]) limb[key] = point(limb[key]!);
    limb.region = limb.region.map(point);
    if (reflect) {
      limb.limits = [
        -limb.limits[1],
        -limb.limits[0],
        -limb.limits[3],
        -limb.limits[2],
      ];
      limb.bend = limb.bend === 1 ? -1 : 1;
    }
  }
  for (const edge of ["left", "right", "top", "bottom"] as const)
    result.edges[edge] = point(result.edges[edge]);
  result.nativeFeatures = { identity: id };
  return result;
}
function frame(
  t: number,
  mode: "idle" | "walk" | "held" | "climb" | "glide" = "idle",
  x = 0,
  facing: -1 | 1 = 1,
  edge: PetEdge | null = null,
): ArticulationFrame {
  return {
    t,
    mode,
    worldScale: scale,
    facing,
    swing: 0,
    sit: 0,
    locomotion: {
      state: mode,
      facing,
      edge,
      phase: t * 9,
      velocity: { x: 0, y: 0 },
      swing: 0,
      travel: { x, y: 0 },
    },
  };
}
const support = (p: NativePose, names: LimbName[], edge: PetEdge = "bottom") =>
  Object.fromEntries(
    names.map((name) => [name, { edge, point: p.limbs[name].contact! }]),
  ) as Partial<Record<LimbName, TransitionSupport>>;
function rig(p: NativePose) {
  const gl = new Proxy({}, { get: () => () => ({}) });
  return createRig({ getContext: () => gl } as unknown as HTMLCanvasElement, {
    view: [0, 0, 256, 300],
    parts: [],
    deformers: {
      body: { kind: "rot", pivot: p.waist },
      ...jointDeformers({
        waist: p.waist,
        limbs: p.limbs,
      } as unknown as MotionRig),
    },
  });
}
function actual(sample: PoseSample<NativePose>, name: LimbName): Point {
  const contact = sample.pose.limbs[name].contact!;
  return rig(sample.pose).point(
    `${name}End`,
    sample.state,
    ...contact,
  ) as Point;
}
function world(sample: PoseSample<NativePose>, name: LimbName, x = 0): Point {
  const point = actual(sample, name);
  return [point[0] * scale * sample.displayFacing! + x, point[1] * scale];
}
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function fixture() {
  const stand = pose("complete_stand"),
    mid = pose("complete_turn_middle", 10),
    walk = pose("complete_side", 20);
  const poses = Object.fromEntries(
    names.map((name) => [name, pose(`complete_${name}`, 20)]),
  ) as Record<PoseName, NativePose>;
  poses.walk = walk;
  const start: PoseTransition<NativePose> = {
    id: "front_side_start",
    from: { pose: "stand", facing: 1 },
    to: { pose: "walk", facing: 1 },
    durationMs: 300,
    keyframes: [
      {
        progress: 0,
        pose: stand,
        supports: support(stand, ["legBack", "legFront"]),
      },
      {
        progress: 0.5,
        pose: mid,
        supports: support(mid, ["legBack", "legFront"]),
      },
      {
        progress: 1,
        pose: "walk",
        supports: support(walk, ["legBack", "legFront"]),
      },
    ],
  };
  return { stand, mid, walk, poses, start };
}
for (const fps of [30, 60])
  test(`complete start/stop cels retain actual world soles at ${fps} fps`, () => {
    const { stand, walk, poses, start } = fixture();
    const stop: PoseTransition<NativePose> = {
      id: "side_front_stop",
      from: start.to,
      to: start.from,
      durationMs: 300,
      keyframes: [
        { progress: 0, pose: "walk", supports: support(walk, ["legFront"]) },
        {
          progress: 0.5,
          pose: stand,
          supports: support(stand, ["legBack", "legFront"]),
        },
        {
          progress: 1,
          pose: stand,
          supports: support(stand, ["legBack", "legFront"]),
        },
      ],
    };
    const engine = new AuthoredPoseAnimation(poses, {
      transitions: [start, stop],
    });
    const first = engine.sample(frame(0))!;
    const pins = Object.fromEntries(
      ["legBack", "legFront"].map((name) => [
        name,
        world(first, name as LimbName),
      ]),
    );
    const seen = new Set<string>();
    for (let i = 0; i <= fps * 0.3; i++) {
      const f = frame(i / fps, "walk", i * 0.1),
        sample = engine.sample(f)!;
      seen.add(sample.pose.part);
      for (const leg of ["legBack", "legFront"] as const) {
        expect(distance(world(sample, leg, i * 0.1), pins[leg])).toBeLessThan(
          1e-8,
        );
        expect(
          distance(
            actual(sample, leg),
            authoredContactPoint(sample.pose, sample.state, leg),
          ),
        ).toBeLessThan(1e-9);
      }
      expect(sample.state.body.a ?? 0).toBe(0);
      for (const s of Object.values(sample.state)) {
        expect(s.sx ?? 1).toBe(1);
        expect(s.sy ?? 1).toBe(1);
      }
    }
    expect(seen).toEqual(
      new Set([stand.part, "complete_turn_middle", walk.part]),
    );
    const terminalTravel = fps * 0.3 * 0.1;
    const normal = engine.sample(frame(0.3 + 1 / fps, "walk", terminalTravel))!;
    expect(normal.pose.part).toBe(walk.part);
    expect(
      distance(world(normal, "legFront", terminalTravel), pins.legFront),
    ).toBeLessThan(1e-8);
    engine.sample(frame(0.4, "idle", terminalTravel));
    for (let i = 0; i <= fps * 0.3; i++) {
      const sample = engine.sample(
        frame(0.4 + i / fps, "idle", terminalTravel),
      )!;
      expect(
        distance(world(sample, "legFront", terminalTravel), pins.legFront),
      ).toBeLessThan(1e-8);
    }
    const idle = engine.sample(frame(2, "idle", terminalTravel))!;
    expect(idle.pose.part).toBe(stand.part);
    expect(idle.view).toMatch(/transition:side_front_stop:2/);
    expect(engine.getMotionFailure()).toBeNull();
  });

test("binding enumeration includes every complete inline view and native generic features", () => {
  const { poses, start, stand } = fixture();
  const views = authoredViewBindings(poses, { transitions: [start] });
  expect(views["stand:1"].pose).toBe(stand);
  const inline = views["transition:front_side_start:1"];
  expect(inline.pose.nativeFeatures.identity).toBe("complete_turn_middle");
  const parts: RigPart[] = Object.values(views)
    .flatMap(({ pose: p }) => [
      p.part,
      ...limbs.flatMap((name) => p.limbs[name].segments!),
    ])
    .map((id) => ({
      id,
      tex: id,
      parent: "body",
      box: [0, 0, 256, 300],
      grid: [1, 1],
      z: 1,
    }));
  const bound = bindAuthoredViews(parts, views);
  expect(
    bound.find((p) => p.id === "complete_turn_middle_legFront_lower")?.parent,
  ).toBe("legFrontLower");
  expect(
    bound.find((p) => p.id === "complete_turn_middle_armNear_end")?.parent,
  ).toBe("armNearEnd");
  expect(bound.find((p) => p.id === stand.part)?.skin).toBeUndefined();
});

test("missing stand or matching transition exposes failure without borrowing walking artwork", () => {
  const { poses, stand } = fixture();
  const missingStand = new AuthoredPoseAnimation(poses, { transitions: [] });
  expect(missingStand.sample(frame(0, "walk"))).toBeNull();
  expect(missingStand.getMotionFailure()).toBe("needs-stand-view");
  const missingStart = new AuthoredPoseAnimation(poses, {
    transitions: [],
    stand,
  });
  const before = missingStart.sample(frame(0))!;
  const after = missingStart.sample(frame(0.1, "walk"))!;
  expect(after.pose).toBe(before.pose);
  expect(after.name).toBe(before.name);
  expect(after.motionFailure?.reason).toBe("needs-authored-transition");
});

test("ambiguous inferred stand and changing bones are rejected", () => {
  const { poses, start } = fixture();
  const other = structuredClone(start);
  other.id = "other";
  other.to = { pose: "held", facing: 1 };
  other.keyframes[0].pose = pose("wrong_stand");
  const engine = new AuthoredPoseAnimation(poses, {
    transitions: [start, other],
  });
  expect(engine.sample(frame(0))).toBeNull();
  expect(engine.getMotionFailure()).toBe("ambiguous-stand-view");
  const broken = structuredClone(start);
  const mid = broken.keyframes[1].pose as NativePose;
  mid.limbs.armNear.joint[1] += 10;
  const changed = new AuthoredPoseAnimation(poses, { transitions: [broken] });
  changed.sample(frame(0));
  changed.sample(frame(0.1, "walk"));
  expect(changed.getMotionFailure()).toBe("transition-bone-length-mismatch");
});

test("rapid new selection cancels the authored clock and never resumes its old terminal pose", () => {
  const { poses, start } = fixture();
  const engine = new AuthoredPoseAnimation(poses, { transitions: [start] });
  engine.sample(frame(0));
  engine.sample(frame(0.1, "walk"));
  const middle = engine.sample(frame(0.26, "walk"))!;
  const cancelled = engine.sample(frame(0.27, "held"))!;
  expect(cancelled.pose.part).toBe(middle.pose.part);
  expect(engine.getMotionFailure()).toBe("transition-interrupted");
  expect(engine.sample(frame(4, "held"))!.pose.part).toBe(middle.pose.part);
});

test("skipped keyframes still validate shared support before releasing the old point", () => {
  const { poses, start } = fixture();
  const broken = structuredClone(start);
  const mid = broken.keyframes[1].pose as NativePose;
  mid.limbs.legBack.contact![0] += 4;
  const engine = new AuthoredPoseAnimation(poses, { transitions: [broken] });
  engine.sample(frame(0));
  engine.sample(frame(0.1, "walk"));
  engine.sample(frame(0.6, "walk"));
  expect(engine.getMotionFailure()).toBe("transition-support-mismatch");
});

test("old turn metadata without authored display bases fails explicitly", () => {
  const { poses, start } = fixture();
  start.to.facing = -1;
  const engine = new AuthoredPoseAnimation(poses, { transitions: [start] });
  engine.sample(frame(0));
  engine.sample(frame(0.1, "walk", 0, -1));
  expect(engine.getMotionFailure()).toBe("needs-authored-turn-basis");
});

test("first left request starts from its registered front view, including pre-draw basis", () => {
  const { poses, start, stand } = fixture();
  const left = pose("complete_first_left", 0, true);
  start.to.facing = -1;
  start.keyframes = [
    { progress: 0, pose: stand, viewFacing: 1 },
    { progress: 0.5, pose: pose("complete_first_turn"), viewFacing: 1 },
    {
      progress: 1,
      pose: left,
      viewFacing: 1,
      supports: support(left, ["legFront"]),
    },
  ];
  const engine = new AuthoredPoseAnimation(poses, { transitions: [start] });
  expect(engine.displayFacing(-1, 0)).toBe(1);
  const first = engine.sample(frame(0, "walk", 0, -1))!;
  expect(first.pose.part).toBe(stand.part);
  expect(first.displayFacing).toBe(1);
  expect(engine.getMotionFailure()).toBeNull();
  expect(engine.sample(frame(0.3, "walk", 0, -1))!.pose.part).toBe(left.part);
});

for (const fps of [30, 60])
  test(`native left complete terminal view persists into confirmed walking at ${fps} fps`, () => {
    const { poses, start, stand } = fixture();
    const left = pose("complete_left_walk", 0, true);
    start.to.facing = -1;
    start.keyframes = [
      {
        progress: 0,
        pose: stand,
        viewFacing: 1,
        supports: support(stand, ["legFront"]),
      },
      {
        progress: 0.5,
        pose: pose("complete_real_turn"),
        viewFacing: 1,
        supports: support(stand, ["legFront"]),
      },
      {
        progress: 1,
        pose: left,
        viewFacing: 1,
        supports: support(left, ["legFront"]),
      },
    ];
    const engine = new AuthoredPoseAnimation(poses, { transitions: [start] });
    engine.sample(frame(0));
    engine.sample(frame(0.1, "walk", 0, -1));
    expect(engine.displayFacing(-1, 0.4)).toBe(1);
    const terminal = engine.sample(frame(0.4, "walk", 0, -1))!;
    expect(terminal.pose.part).toBe(left.part);
    expect(terminal.displayFacing).toBe(1);
    let pin: Point | null = world(terminal, "legFront"),
      supported = terminal.contacts.legFront;
    for (let i = 1; i <= fps * 3; i++) {
      const x = (-i * 60) / fps,
        sample = engine.sample(frame(0.4 + i / fps, "walk", x, -1))!;
      expect(sample.pose.part).toBe(left.part);
      expect(sample.displayFacing).toBe(1);
      expect(engine.getMotionFailure()).toBeNull();
      const contact = sample.contacts.legFront;
      const point = world(sample, "legFront", x);
      if (contact && supported)
        expect(distance(point, pin!)).toBeLessThan(1e-8);
      if (contact) pin = point;
      supported = contact;
      const renderer = rig(sample.pose),
        limb = sample.pose.limbs.legFront;
      const root = renderer.point("body", sample.state, ...limb.root) as Point;
      const knee = renderer.point(
        "legFront",
        sample.state,
        ...limb.joint,
      ) as Point;
      const ankle = renderer.point(
        "legFrontLower",
        sample.state,
        ...limb.end,
      ) as Point;
      expect(distance(root, knee)).toBeCloseTo(30, 9);
      expect(distance(knee, ankle)).toBeCloseTo(26, 9);
    }
  });

test("held/front resource cels preserve native pose identity and do not turn the complete torso", () => {
  const { stand, poses } = fixture();
  const held = pose("complete_bent_waist");
  const pick: PoseTransition<NativePose> = {
    id: "pick",
    from: { pose: "stand", facing: 1 },
    to: { pose: "held", facing: 1 },
    durationMs: 240,
    keyframes: [
      { progress: 0, pose: stand },
      { progress: 0.5, pose: pose("complete_bending_middle") },
      { progress: 1, pose: held },
    ],
  };
  const release: PoseTransition<NativePose> = {
    id: "release",
    from: pick.to,
    to: pick.from,
    durationMs: 320,
    keyframes: [
      { progress: 0, pose: held },
      { progress: 0.5, pose: pose("complete_straightening_middle") },
      { progress: 1, pose: stand },
    ],
  };
  const engine = new AuthoredPoseAnimation(poses, {
    transitions: [pick, release],
  });
  engine.sample(frame(0));
  engine.sample(frame(0.1, "held"));
  const hold = engine.sample(frame(0.34, "held"))!;
  expect(hold.pose.nativeFeatures.identity).toBe(held.part);
  expect(hold.state.body.a ?? 0).toBe(0);
  const after = engine.sample(frame(0.4, "held"))!;
  expect(after.pose.part).toBe(held.part);
  engine.sample(frame(0.5));
  const end = engine.sample(frame(0.83))!;
  expect(end.pose.part).toBe(stand.part);
  expect(end.transition?.kind).toBe("authored");
  expect(engine.getMotionFailure()).toBeNull();
});

for (const fps of [30, 60])
  test(`actual rendered waist follows current grab through cels and native drag at ${fps} fps`, () => {
    const { stand, poses } = fixture();
    const held = pose("complete_held_grab", 20);
    const pick: PoseTransition<NativePose> = {
      id: "grab",
      from: { pose: "stand", facing: 1 },
      to: { pose: "held", facing: 1 },
      durationMs: 300,
      keyframes: [
        { progress: 0, pose: stand },
        { progress: 0.5, pose: pose("complete_grab_middle", 10) },
        { progress: 1, pose: held },
      ],
    };
    const engine = new AuthoredPoseAnimation(poses, { transitions: [pick] });
    engine.sample(frame(0));
    for (let i = 0; i <= fps; i++) {
      const t = i / fps,
        f = frame(t, "held", t * 100);
      f.gripPoint = [
        stand.waist[0] + 4 * Math.sin(t * 3),
        stand.waist[1] + 3 * Math.sin(t * 2),
      ];
      f.swing = 12;
      f.locomotion!.swing = 12;
      const sample = engine.sample(f)!;
      const waist = rig(sample.pose).point(
        "body",
        sample.state,
        ...sample.pose.waist,
      ) as Point;
      expect(distance(waist, f.gripPoint)).toBeLessThan(1e-8);
      const actualWorld = [
        waist[0] * scale + t * 100,
        waist[1] * scale,
      ] as Point;
      expect(
        distance(actualWorld, [
          f.gripPoint[0] * scale + t * 100,
          f.gripPoint[1] * scale,
        ]),
      ).toBeLessThan(1e-8);
      expect(engine.getMotionFailure()).toBeNull();
      if (t > 0.3) expect(sample.pose.part).toBe(held.part);
    }
  });

test("bad skipped handoff retains the actually displayed source rather than an unseen internal cel", () => {
  const { stand, start, poses } = fixture();
  const broken = structuredClone(start);
  broken.keyframes[2].supports = support(poses.walk, ["armNear"]);
  const engine = new AuthoredPoseAnimation(poses, { transitions: [broken] });
  engine.sample(frame(0));
  engine.sample(frame(0.1, "walk"));
  const failed = engine.sample(frame(0.5, "walk"))!;
  expect(failed.pose.part).toBe(stand.part);
  expect(engine.getMotionFailure()).toBe("transition-support-handoff");
});

test("nonfinite travel and backwards clocks cannot inject transforms or rewind old cels", () => {
  const { poses, start } = fixture();
  const badReceipt = new AuthoredPoseAnimation(poses, { transitions: [start] });
  badReceipt.sample(frame(0));
  badReceipt.sample(frame(0.1, "walk"));
  const failed = badReceipt.sample(frame(0.2, "walk", Number.NaN))!;
  for (const name of limbs)
    expect(actual(failed, name).every(Number.isFinite)).toBe(true);
  expect(badReceipt.getMotionFailure()).toBe("transition-support-mismatch");
  const clock = new AuthoredPoseAnimation(poses, { transitions: [start] });
  clock.sample(frame(0));
  clock.sample(frame(0.1, "walk"));
  clock.sample(frame(0.18, "walk"));
  clock.sample(frame(0.17, "walk"));
  expect(clock.getMotionFailure()).toBe("transition-invalid-time");
  const displayed = clock.sample(frame(0.2, "walk"))!;
  expect(clock.getMotionFailure()).toBe("transition-invalid-time");
  expect(clock.sample(frame(4, "walk"))!.pose.part).toBe(displayed.pose.part);
  expect(clock.getMotionTransition()).toBeNull();
});

test("resource records and publicly returned status cannot mutate an active sequence", () => {
  const { poses, start } = fixture();
  const engine = new AuthoredPoseAnimation(poses, { transitions: [start] });
  engine.sample(frame(0));
  engine.sample(frame(0.1, "walk"));
  start.durationMs = 1;
  start.keyframes[1].pose = pose("mutated_view");
  const status = engine.getMotionTransition()!;
  status.to.pose = "held";
  const middle = engine.sample(frame(0.27, "walk"))!;
  expect(middle.pose.part).toBe("complete_turn_middle");
  expect(engine.getMotionTransition()!.to.pose).toBe("walk");
});

test("two same-edge supports must actually share the boundary plane", () => {
  const { poses, start } = fixture();
  const broken = structuredClone(start),
    middle = broken.keyframes[1].pose as NativePose;
  // Each chain keeps its lengths; one sole is authored on a different floor.
  for (const key of ["root", "joint", "end", "contact"] as const)
    middle.limbs.legBack[key]![1] += 4;
  broken.keyframes[1].supports = support(middle, ["legBack", "legFront"]);
  const engine = new AuthoredPoseAnimation(poses, { transitions: [broken] });
  engine.sample(frame(0));
  engine.sample(frame(0.1, "walk"));
  engine.sample(frame(0.27, "walk"));
  expect([
    "transition-support-plane-mismatch",
    "transition-support-mismatch",
  ]).toContain(engine.getMotionFailure());
});

for (const [edge, toEdge] of [
  ["left", "top"],
  ["left", "bottom"],
  ["right", "top"],
  ["right", "bottom"],
  ["top", "left"],
  ["top", "right"],
  ["bottom", "left"],
  ["bottom", "right"],
] as const)
  test(`registered corner ${edge}→${toEdge} retains an actual common contact`, () => {
    const { poses, stand } = fixture();
    const fromPose =
      edge === "top" ? "top" : edge === "bottom" ? "bottom" : "side";
    const toPose =
      toEdge === "top" ? "top" : toEdge === "bottom" ? "bottom" : "side";
    const place = (p: NativePose, name: LimbName, contact: Point) => {
      const limb = p.limbs[name],
        delta: Point = [
          contact[0] - limb.contact![0],
          contact[1] - limb.contact![1],
        ];
      for (const key of ["root", "joint", "end", "contact"] as const)
        limb[key] = [limb[key]![0] + delta[0], limb[key]![1] + delta[1]];
    };
    const on = (which: PetEdge, tangent: number): Point =>
      which === "left"
        ? [90, tangent]
        : which === "right"
          ? [166, tangent]
          : which === "top"
            ? [tangent, 80]
            : [tangent, 256];
    const first = pose(`complete_${edge}`);
    place(first, "armNear", on(edge, 110));
    if (edge === "bottom") place(first, "legFront", on(edge, 140));
    poses[fromPose] = first;
    const middle = structuredClone(first);
    middle.part = `corner_${edge}_${toEdge}`;
    place(middle, "armFar", on(toEdge, 120));
    if (toEdge === "bottom") place(middle, "legBack", on(toEdge, 150));
    const target = structuredClone(middle);
    target.part = `complete_${toEdge}`;
    place(target, "armNear", on(toEdge, 100));
    poses[toPose] = target;
    const oldNames: LimbName[] =
      edge === "bottom" ? ["armNear", "legFront"] : ["armNear"];
    const newNames: LimbName[] =
      toEdge === "bottom"
        ? ["armNear", "armFar", "legBack"]
        : ["armNear", "armFar"];
    const oldSupport = support(first, oldNames, edge),
      newSupport = support(target, newNames, toEdge);
    const entry: PoseTransition<NativePose> = {
      id: `entry_${edge}_${toEdge}`,
      from: { pose: "stand", facing: 1 },
      to: { pose: fromPose, facing: 1, edge },
      durationMs: 100,
      keyframes: [
        { progress: 0, pose: stand },
        { progress: 1, pose: fromPose, supports: oldSupport },
      ],
    };
    const corner: PoseTransition<NativePose> = {
      id: `corner_${edge}_${toEdge}`,
      from: entry.to,
      to: { pose: toPose, facing: 1, edge: toEdge },
      durationMs: 300,
      keyframes: [
        { progress: 0, pose: fromPose, supports: oldSupport },
        {
          progress: 0.5,
          pose: middle,
          supports: {
            ...support(middle, oldNames, edge),
            ...support(
              middle,
              toEdge === "bottom" ? ["armFar", "legBack"] : ["armFar"],
              toEdge,
            ),
          },
        },
        { progress: 1, pose: toPose, supports: newSupport },
      ],
    };
    const engine = new AuthoredPoseAnimation(poses, {
      transitions: [entry, corner],
    });
    engine.sample(frame(0));
    engine.sample(frame(0.1, "climb", 0, 1, edge));
    const attached = engine.sample(frame(0.2, "climb", 0, 1, edge))!;
    const oldPin = world(attached, "armNear");
    engine.sample(frame(0.21, "climb", 0, 1, toEdge));
    const transfer = engine.sample(frame(0.37, "climb", 0, 1, toEdge))!;
    expect(distance(world(transfer, "armNear"), oldPin)).toBeLessThan(1e-8);
    const newPin = world(transfer, "armFar");
    const finished = engine.sample(frame(0.52, "climb", 0, 1, toEdge))!;
    expect(distance(world(finished, "armFar"), newPin)).toBeLessThan(1e-8);
    expect(engine.getMotionFailure()).toBeNull();
  });
