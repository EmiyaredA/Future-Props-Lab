import {
  createRig,
  type Deformer,
  type RigPart,
  type RigState,
} from "./whale-vendor/rig/rig.js";
import type { PetMotionFrame } from "@platform/petMotion";
import { Articulation, jointDeformers, type MotionRig } from "./locomotion/articulation";

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
  const articulation = model.motionRig ? new Articulation(model.motionRig, model.pivots.body as [number, number]) : null;
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
      ...model.parts,
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

  function paintFace(frame: HumanFrame, blush: number) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
    context.setTransform(3, 0, 0, 3, -x0 * 3, -y0 * 3);
    const sprite = (name: string, sy = 1, dx = 0, dy = 0) => {
      const bounds = model.feat.sprites[name];
      if (!bounds || !images[name]) return;
      const [x, y, right, bottom] = bounds;
      const w = right - x;
      const h = bottom - y;
      context.drawImage(
        images[name],
        x + dx,
        y + dy + (h * (1 - sy)) / 2,
        w,
        h * sy,
      );
    };
    const asleep =
      frame.mode === "sleep" ||
      frame.face === "sleep" ||
      frame.face === "sleepy";
    const closed = Math.max(
      frame.blink || 0,
      frame.eyeClose || 0,
      asleep ? 1 : 0,
    );
    const eyeName =
      frame.face === "angry"
        ? "angry_eyes"
        : frame.face === "surprised"
          ? "surprised_eyes"
          : "eyes";
    const openness =
      frame.face === "thinking" || frame.face === "shy" ? 0.8 : 1;
    if (closed > 0.8) sprite("closed_eyes");
    else
      sprite(
        eyeName,
        openness * (1 - closed),
        clamp(frame.look[0] * 0.22, -1.5, 1.5),
        clamp(frame.look[1] * 0.15, -1, 1),
      );
    sprite(
      "brows",
      1,
      0,
      frame.face === "surprised" ? -2 : frame.face === "angry" ? 1 : 0,
    );
    if (frame.face === "happy" || frame.face === "love" || frame.talk > 0.15)
      sprite(
        "happy_mouth",
        frame.talk > 0.15 ? 0.5 + Math.abs(Math.sin(frame.t * 12)) * 0.5 : 0.8,
      );
    else sprite("neutral_mouth");
    const alpha = Math.max(blush, frame.face === "shy" ? 0.8 : 0);
    if (alpha > 0.05) {
      const [left, top, right, bottom] = model.feat.sprites.eyes;
      for (const x of [left + 5, right - 5]) {
        const y = bottom + 4;
        const glow = context.createRadialGradient(x, y, 0, x, y, 8);
        glow.addColorStop(0, `rgba(245,115,130,${alpha * 0.4})`);
        glow.addColorStop(1, "rgba(245,115,130,0)");
        context.fillStyle = glow;
        context.fillRect(x - 8, top + 8, 16, 24);
      }
    }
    rig.upload("face_fx", faceCanvas);
  }

  return {
    draw(group: SVGGElement, face: { blush?: number }, frame: HumanFrame) {
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
      if (articulation && pose.sit < 0.4) {
        const natural = articulation.sample(frame);
        Object.assign(state, natural.state, {
          alpha: { ...outfitAlpha(model.schemes.find((item) => item.id === scheme), pose.sit), ...natural.state.alpha },
        });
      } else if (model.motionRig) {
        for (const limb of Object.values(model.motionRig.limbs)) {
          for (const id of limb.parts) state.alpha[id] = 0;
          if (limb.jointPart) state.alpha[limb.jointPart] = 0;
        }
      }
      paintFace(frame, face.blush || 0);
      rig.render(state);
    },
    groupTilt(mode: string, tilt: number, lean: number) {
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
