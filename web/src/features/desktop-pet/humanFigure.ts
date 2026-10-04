import {
  createRig,
  type Deformer,
  type RigPart,
  type RigState,
} from "./whale-vendor/rig/rig.js";
import type { PetMotionFrame } from "@platform/petMotion";
import { paintHumanFace } from "./humanFace";
import {
  Articulation,
  jointDeformers,
  type MotionRig,
} from "./locomotion/articulation";
import {
  AuthoredPoseAnimation,
  authoredViewBindings,
  bindAuthoredViews,
  posePartIds,
} from "./locomotion/authoredPose";

export type HumanScheme = {
  id: string;
  accent?: string;
  brand?: string;
  outfit?: { standingParts: string[]; seatedParts: string[] };
};
export type HumanModel = {
  rigProfile: "human-chibi";
  character: { name: string };
  view: number[];
  pivots: Record<string, number[]>;
  parts: RigPart[];
  feat: { sprites: Record<string, number[]> };
  schemes: HumanScheme[];
  motionRig?: MotionRig;
};
export type HumanFrame = {
  t: number;
  mode: string;
  face: string;
  look: number[];
  legs: number[][];
  low: number;
  swing: number;
  sit: number;
  blink: number;
  eyeClose: number;
  talk: number;
  tilt: number;
  lean: number;
  gait?: { phase: number; stride: number; lift: number };
  locomotion?: PetMotionFrame | null;
  worldScale?: number;
  facing?: number;
  gripPoint?: [number, number] | null;
};

const NS = "http://www.w3.org/2000/svg";
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

export function outfitAlpha(scheme: HumanScheme | undefined, sit: number) {
  const seated = clamp((sit - 0.4) / 0.2, 0, 1);
  const alpha: Record<string, number> = {
    leg_back: 1 - seated,
    leg_front: 1 - seated,
    sit_lower: seated,
  };
  for (const id of scheme?.outfit?.standingParts ?? []) alpha[id] = 1 - seated;
  for (const id of scheme?.outfit?.seatedParts ?? []) alpha[id] = seated;
  return alpha;
}

/** Pure target pose; springs below smooth the independent hair/coat/neck channels. */
export function humanPose(frame: HumanFrame) {
  const walking = frame.mode === "walk" || frame.mode === "run";
  const held = frame.mode === "drag" || frame.mode === "held";
  const climb = frame.mode === "climb";
  const glide = frame.mode === "glide";
  const air = frame.mode === "air";
  const sit = clamp(frame.sit || 0, 0, 1);
  const rawAngles = frame.legs.map(([x0, y0, x1, y1]) =>
    clamp((-Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI, -50, 50),
  );
  // This figure faces the viewer: project forward/back strides into depth,
  // rather than rotating the whale's short legs across the person's long legs.
  const stride = frame.gait
    ? clamp(frame.gait.stride / (frame.mode === "run" ? 17 : 10), 0, 1)
    : 1;
  const gaitPhase = frame.gait?.phase;
  const legAngles = climb
    ? [0, 1].map(
        (i) =>
          (frame.locomotion?.edge === "left" ? (i ? 25 : 10) : i ? -10 : -25) +
          Math.sin((gaitPhase ?? 0) + i * Math.PI) * 3,
      )
    : glide
      ? [16, 10]
      : walking
        ? rawAngles.map(
            (angle, i) =>
              (gaitPhase === undefined
                ? clamp(angle / 25, -1, 1)
                : -Math.sin(gaitPhase + i * Math.PI) * stride) *
              (frame.mode === "run" ? 6 : 4),
          )
        : rawAngles.map((angle) =>
            held || air || sit > 0.05 ? angle : clamp(angle / 25, -1, 1) * 4,
          );
  const bodyY = walking ? -(frame.low || 0) * 0.4 : (frame.low || 0) - 11 * sit;
  const legScales = [0, 1].map((i) =>
    climb
      ? 0.92 - Math.max(0, Math.cos((gaitPhase ?? 0) + i * Math.PI)) * 0.12
      : glide
        ? 0.88
        : walking
          ? 1 -
            (bodyY +
              (frame.gait
                ? Math.max(0, Math.cos(frame.gait.phase + i * Math.PI)) *
                  frame.gait.lift *
                  0.6
                : Math.max(0, 241 - frame.legs[i][3]) * 0.6)) /
              68
          : 1,
  );
  const phase = Math.sin(frame.t * (frame.mode === "run" ? 14 : 9));
  const arms = held
    ? frame.mode === "drag" && !frame.locomotion
      ? [65 + phase * 12, -45 - phase * 10]
      : [
          12 + (frame.locomotion?.swing ?? phase * 4) * 0.3,
          -8 - (frame.locomotion?.swing ?? phase * 4) * 0.2,
        ]
    : climb
      ? frame.locomotion?.edge === "right"
        ? [
            -102 + Math.sin(frame.gait?.phase ?? 0) * 12,
            -105 - Math.sin(frame.gait?.phase ?? 0) * 14,
          ]
        : [
            105 + Math.sin(frame.gait?.phase ?? 0) * 14,
            102 - Math.sin(frame.gait?.phase ?? 0) * 12,
          ]
      : glide
        ? [78, -76]
        : air
          ? [35, -30]
          : walking
            ? [-legAngles[0] * 0.8, -legAngles[1] * 0.8]
            : [0, 0];
  const neck = clamp(
    (frame.tilt || 0) * 0.75 +
      frame.look[0] * 0.5 -
      frame.look[1] * 0.3 +
      (frame.face === "shy" ? 6 : frame.face === "thinking" ? -6 : 0) +
      (frame.mode === "sleep" ? 7 : 0),
    -18,
    18,
  );
  return {
    sit,
    legAngles,
    legScales,
    arms,
    bodyAngle: climb
      ? frame.locomotion?.edge === "left"
        ? 10
        : -10
      : held
        ? (frame.locomotion?.swing ?? 0) * 0.15
        : glide
          ? 10
          : 0,
    neck: glide ? -6 : neck,
    bodyY,
    sway: clamp((frame.swing || 0) / 20 + (walking ? phase * 0.35 : 0), -2, 2),
  };
}

function spring(stiffness: number, damping: number, limit: number) {
  let x = 0;
  let velocity = 0;
  return (target: number, dt: number) => {
    velocity += ((target - x) * stiffness - velocity * damping) * dt;
    x = clamp(x + velocity * dt, -limit, limit);
    return x;
  };
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("人物桌宠贴图无法加载"));
    image.src = url;
  });
}

export async function createHumanFigure(options: {
  model: HumanModel;
  asset: (path: string) => string;
  scheme: string;
}) {
  const { model } = options;
  const [x0, y0, x1, y1] = model.view;
  const width = x1 - x0;
  const height = y1 - y0;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * 3);
  canvas.height = Math.round(height * 3);
  canvas.style.cssText = "width:100%;height:100%;display:block";
  const faceCanvas = document.createElement("canvas");
  faceCanvas.width = canvas.width;
  faceCanvas.height = canvas.height;
  const context = faceCanvas.getContext("2d")!;
  const rect = (id: string) => {
    const [x, y, w, h] = model.parts.find((part) => part.id === id)!.box;
    return [x, y, x + w, y + h];
  };
  const deformers: Record<string, Deformer> = {
    body: { kind: "rot", pivot: model.pivots.body },
    neck: { kind: "rot", parent: "body", pivot: model.pivots.neck },
    head: { kind: "rot", parent: "neck", pivot: model.pivots.neck },
    hair: { kind: "warp", parent: "head", rect: rect("hair_back") },
    bangs: { kind: "warp", parent: "head", rect: rect("hair_front") },
    coat: { kind: "warp", parent: "body", rect: rect("coat") },
    armNear: { kind: "rot", parent: "body", pivot: model.pivots.armNear },
    armFar: { kind: "rot", parent: "body", pivot: model.pivots.armFar },
    legBack: { kind: "rot", parent: "body", pivot: model.pivots.legBack },
    legFront: { kind: "rot", parent: "body", pivot: model.pivots.legFront },
    ...(model.motionRig ? jointDeformers(model.motionRig) : {}),
  };
  if (model.motionRig) {
    deformers.neck.parent = "torso";
    deformers.coat.parent = "torso";
  }
  const authoredViews = model.motionRig?.poses
    ? authoredViewBindings(model.motionRig.poses, {
        transitions: model.motionRig.transitions,
      })
    : {};
  const authored =
    model.motionRig?.version === 2 && model.motionRig.poses
      ? new AuthoredPoseAnimation(model.motionRig.poses, {
          transitions: model.motionRig.transitions,
        })
      : null;
  // The first human motion packages sliced the standing arms and fitted a
  // profile head independently. They have no coherent physical pose views.
  // Keep their standing/sitting artwork usable without replaying that path.
  const unsupportedMotion = model.motionRig?.version === 1;
  const articulation =
    model.motionRig && !authored && !unsupportedMotion
      ? new Articulation(model.motionRig, model.pivots.body as [number, number])
      : null;
  const loaded = new Map<string, Promise<Record<string, HTMLImageElement>>>();
  const loadScheme = (id: string) => {
    if (!loaded.has(id)) {
      const prefix = id === model.schemes[0].id ? "" : `schemes/${id}/`;
      loaded.set(
        id,
        Promise.all(
          [
            ...model.parts.map((part) => [`tex/${part.tex}.png`, part.tex]),
            ...Object.keys(model.feat.sprites).map((name) => [
              `feat/${name}.png`,
              name,
            ]),
          ].map(
            async ([path, name]) =>
              [name, await loadImage(options.asset(prefix + path))] as const,
          ),
        ).then((entries) => Object.fromEntries(entries)),
      );
    }
    return loaded.get(id)!;
  };
  let scheme =
    model.schemes.find((item) => item.id === options.scheme)?.id ??
    model.schemes[0].id;
  let images = await loadScheme(scheme);
  const rig = createRig(canvas, {
    view: model.view,
    deformers,
    parts: [
      ...bindAuthoredViews(model.parts, authoredViews).map((part) => {
        return model.motionRig && ["torso", "body_underpaint"].includes(part.id)
          ? { ...part, parent: "torso" }
          : part;
      }),
      {
        id: "face_fx",
        tex: "face_fx",
        box: [x0, y0, width, height],
        grid: [6, 6],
        parent: "head",
        z: 8,
      },
    ],
  });
  let disposed = false;
  for (const part of model.parts) rig.upload(part.tex, images[part.tex]);
  let selection = 0;
  const hairSpring = spring(55, 9, 10);
  const coatSpring = spring(80, 10, 7);
  const headSpring = spring(75, 12, 18);
  let previousTime = 0;
  let mounted: SVGGElement | null = null;
  let motionFailure: string | null = null;
  let authoredPickup: number[] | null = null;

  return {
    // Joint poses own breathing and impact recovery; keep physical bone/head
    // proportions and planted contacts independent of the outer logo squash.
    fixedScale: Boolean(authored) || unsupportedMotion,
    getMotionFailure() {
      return motionFailure ?? authored?.getMotionFailure() ?? null;
    },
    getMotionTransition() {
      return authored?.getMotionTransition() ?? null;
    },
    cancelMotionPlayback() {
      authored?.cancelMotionPlayback();
    },
    motionFacing(motion: PetMotionFrame, seconds?: number) {
      return authored
        ? authored.displayFacing(motion.facing, seconds)
        : motion.state === "climb"
          ? 1
          : motion.facing;
    },
    draw(group: SVGGElement, face: { blush?: number }, frame: HumanFrame) {
      const mode = frame.locomotion?.state ?? frame.mode;
      motionFailure =
        unsupportedMotion &&
        ["walk", "run", "climb", "glide", "air"].includes(mode)
          ? "unsupported-motion-resource"
          : null;
      if (unsupportedMotion)
        frame = {
          ...frame,
          mode: "idle",
          locomotion: null,
          gait: undefined,
          legs: [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
          ],
          low: 0,
          swing: 0,
          tilt: 0,
          lean: 0,
        };
      if (mounted !== group) {
        const object = document.createElementNS(NS, "foreignObject");
        for (const [key, value] of Object.entries({
          x: x0,
          y: y0,
          width,
          height,
        }))
          object.setAttribute(key, String(value));
        object.appendChild(canvas);
        group.appendChild(object);
        mounted = group;
      }
      const dt = clamp(frame.t - previousTime || 1 / 60, 0.001, 0.05);
      previousTime = frame.t;
      const pose = humanPose(frame);
      const hair = hairSpring(pose.sway * 4 - pose.neck * 0.15, dt);
      const coat = coatSpring(pose.sway * 3, dt);
      const neck = headSpring(pose.neck, dt);
      const state: RigState = {
        body: { ty: pose.bodyY, a: pose.bodyAngle },
        neck: { a: neck },
        head: { tx: frame.look[0] * 0.1, ty: frame.look[1] * 0.07 },
        hair: { fn: (_u, v) => [hair * v * v, -Math.abs(hair) * v * 0.1] },
        bangs: { fn: (_u, v) => [hair * v * 0.18, 0] },
        coat: { fn: (_u, v) => [coat * v * v, 0] },
        armNear: { a: pose.arms[0] },
        armFar: { a: pose.arms[1] },
        legBack: {
          a: pose.legAngles[0] * (1 - pose.sit),
          sy: pose.legScales[0],
        },
        legFront: {
          a: pose.legAngles[1] * (1 - pose.sit),
          sy: pose.legScales[1],
        },
        alpha: outfitAlpha(
          model.schemes.find((item) => item.id === scheme),
          pose.sit,
        ),
      };
      let profile = 0;
      const painted = authored?.sample(frame);
      if (painted) {
        Object.assign(state, painted.state);
        // A whole authored pose already contains its head/neck. Facial overlays
        // follow that same body, rather than inheriting the standing neck spring.
        if (!painted.pose.head) state.neck = { a: 0 };
        state.head = { tx: 0, ty: 0 };
        const visible = new Set(posePartIds(painted.pose));
        state.alpha = Object.fromEntries(
          model.parts.map((part) => [part.id, visible.has(part.id) ? 1 : 0]),
        );
        state.alpha.face_fx = 1;
        group.setAttribute(
          "data-pet-edges",
          JSON.stringify(painted.pose.edges),
        );
        group.setAttribute("data-pet-supported-edges", "left,right,top,bottom");
        if (painted.pose.stride)
          group.setAttribute("data-pet-stride", String(painted.pose.stride));
        else group.removeAttribute("data-pet-stride");
      } else if (articulation && pose.sit < 0.4) {
        const natural = articulation.sample(frame);
        profile = natural.profile;
        Object.assign(state, natural.state, {
          alpha: {
            ...outfitAlpha(
              model.schemes.find((item) => item.id === scheme),
              pose.sit,
            ),
            ...natural.state.alpha,
          },
        });
      } else if (model.motionRig) {
        if (model.motionRig.profileHead)
          state.alpha[model.motionRig.profileHead.part] = 0;
        for (const limb of Object.values(model.motionRig.limbs)) {
          for (const id of limb.parts) state.alpha[id] = 0;
          if (limb.jointPart) state.alpha[limb.jointPart] = 0;
        }
        for (const entry of Object.values(authoredViews)) {
          for (const id of posePartIds(entry.pose)) state.alpha[id] = 0;
        }
      }
      if (!painted) {
        group.removeAttribute("data-pet-stride");
        group.removeAttribute("data-pet-edges");
        group.setAttribute(
          "data-pet-supported-edges",
          unsupportedMotion
            ? ""
            : authored
              ? "left,right,top,bottom"
              : "left,right",
        );
      }
      paintHumanFace(
        context,
        faceCanvas,
        model,
        images,
        frame,
        face.blush || 0,
        profile,
        painted?.pose.face,
      );
      rig.upload("face_fx", faceCanvas);
      rig.render(state);
      authoredPickup = painted
        ? rig.point("torso", state, ...painted.pose.waist)
        : null;
    },
    groupTilt(mode: string, tilt: number, lean: number) {
      if (unsupportedMotion) return 0;
      return ["air", "drag", "held", "crouch", "land", "dizzy"].includes(mode)
        ? tilt + lean
        : lean * 0.35;
    },
    async setScheme(id: string) {
      if (!model.schemes.some((item) => item.id === id)) return;
      const generation = ++selection;
      const next = await loadScheme(id);
      if (disposed || generation !== selection) return;
      scheme = id;
      images = next;
      for (const part of model.parts) rig.upload(part.tex, images[part.tex]);
    },
    get colors() {
      return {
        z:
          model.schemes.find((item) => item.id === scheme)?.accent ?? "#ac594b",
      };
    },
    pickupPoint() {
      return authoredPickup
        ? [...authoredPickup]
        : (model.motionRig?.waist ?? null);
    },
    dispose() {
      disposed = true;
      selection++;
      rig.gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
    anchors: {
      gaze: [145, 94],
      tear: [118, 110],
      z: [195, 35],
      hearts: [88, 176, 45],
      bubble: [128, 5],
    },
  };
}
