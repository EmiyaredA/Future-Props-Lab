import { findAsset } from "./asset-catalog.ts";
import { builtinMotionName } from "./animation/motion-catalog.ts";
import { ACTIONS, COLORS, uid } from "./model-constants.ts";
import type { Action, Clip, Entity, Kind, Project, Vec3 } from "./model.ts";
export const clipLabel = (c: Clip) =>
  c.name ??
  (c.action === "retarget"
    ? (builtinMotionName(c) ?? `适配动作 ${c.retarget!.index + 1}`)
    : c.action === "native"
      ? `原生动画 ${c.native!.index + 1}`
      : ACTIONS[c.action]);
export function entity(
  kind: Kind,
  asset: string,
  name: string,
  position: Vec3 = [0, 0, 0],
): Entity {
  return {
    id: uid(),
    kind,
    asset,
    name,
    color: kind === "actor" ? COLORS[0] : "#d5d5d0",
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    locked: false,
    height: 1.75,
    build: "normal",
    gender: "male",
    path: null,
    face: "path",
    faceTarget: "",
    clips: [],
    pose: {},
    poseKeys: [],
    camera:
      kind === "camera"
        ? {
            aim: "target",
            focal: 28,
            target: [0, 1, 0],
            targetId: "",
            targetHeight: 1.2,
            mode: "free",
            offset: [0, 1.6, -1.8],
            inheritRotation: true,
            hideWalls: [],
          }
        : null,
    count: 12,
    spacing: 0.75,
    seed: 42,
    reference: "",
    ...(asset === "woman" ? { gender: "female" as const, height: 1.65 } : {}),
    ...structuredClone(findAsset(asset)?.defaults ?? {}),
  };
}
export function clip(action: Action, start: number, end: number): Clip {
  return { id: uid(), action, start, end, speed: 1 };
}
export function demoProject(): Project {
  const a = entity("actor", "person", "人物 A · 床边", [-0.5, 0, -0.75]);
  a.color = COLORS[1];
  a.rotation[1] = Math.PI / 2;
  a.clips = [clip("sit", 0, 7), clip("standup", 7, 9), clip("idle", 9, 15)];
  const b = entity("actor", "person", "人物 B · 走向衣柜", [0.55, 0, 1.4]);
  b.color = COLORS[0];
  b.clips = [
    clip("idle", 0, 2),
    clip("walk", 2, 6),
    clip("turn", 6, 8),
    clip("idle", 8, 15),
  ];
  b.path = {
    smooth: true,
    points: [
      { time: 2, position: [0.55, 0, 1.4] },
      { time: 4, position: [0.9, 0, 0.05] },
      { time: 6, position: [1.15, 0, -0.95] },
    ],
  };
  const c = entity("actor", "person", "人物 C · 书桌", [-1.65, 0, 1.05]);
  c.color = COLORS[2];
  c.gender = "female";
  c.height = 1.65;
  c.rotation[1] = -Math.PI / 2;
  c.clips = [clip("sit", 0, 15)];
  c.poseKeys = [
    { time: 0, pose: { head: 8 } },
    { time: 9, pose: { head: -12, headYaw: 30 } },
    { time: 12, pose: { head: 0, headYaw: 0 } },
  ];
  const d = entity("actor", "person", "人物 D · 进门", [1.55, 0, 1.75]);
  d.color = COLORS[3];
  d.height = 1.8;
  d.clips = [
    clip("idle", 0, 3),
    clip("walk", 3, 6),
    clip("idle", 6, 9),
    clip("walk", 9, 13),
    clip("idle", 13, 15),
  ];
  d.path = {
    smooth: false,
    points: [
      { time: 3, position: [1.55, 0, 1.75] },
      { time: 6, position: [1.3, 0, 0.65] },
      { time: 9, position: [1.3, 0, 0.65] },
      { time: 13, position: [0.1, 0, 0.6] },
    ],
  };
  const props = [
    entity("prop", "bed", "双人床", [-1.25, 0, -0.9]),
    entity("prop", "nightstand", "床头柜", [-2.08, 0, -1.66]),
    entity("prop", "wardrobe", "衣柜", [1.35, 0, -1.78]),
    entity("prop", "desk", "书桌", [-2.02, 0, 1.05]),
    entity("prop", "chair", "座椅", [-1.65, 0, 1.05]),
    entity("prop", "lamp", "台灯", [-2.08, 0.58, -1.66]),
    entity("prop", "laptop", "电脑", [-2.02, 0.75, 1.05]),
  ];
  props.find((p) => p.asset === "desk")!.rotation[1] = Math.PI / 2;
  props.find((p) => p.asset === "chair")!.rotation[1] = -Math.PI / 2;
  props.find((p) => p.asset === "laptop")!.rotation[1] = Math.PI / 2;
  const ca = entity("camera", "camera", "A · 室内全景", [2.15, 1.65, 1]);
  ca.camera!.focal = 20;
  ca.camera!.target = [-0.8, 1, -0.6];
  ca.path = {
    smooth: false,
    points: [
      { time: 0, position: [2.15, 1.65, 1] },
      { time: 15, position: [2.05, 1.6, 0.8] },
    ],
  };
  const cb = entity("camera", "camera", "B · 人物跟拍", [2.2, 1.5, 0.6]);
  cb.camera!.focal = 28;
  cb.camera!.targetHeight = 1.3;
  cb.camera!.targetId = b.id;
  cb.path = {
    smooth: true,
    points: [
      { time: 3, position: [2.2, 1.5, 0.6] },
      { time: 10, position: [2.2, 1.5, 0.15] },
    ],
  };
  const cc = entity("camera", "camera", "C · 主观视角", [0, 1.65, 0]);
  cc.camera!.mode = "pov";
  cc.camera!.targetId = d.id;
  cc.camera!.offset = [0, 1.67, 0.13];
  cc.camera!.focal = 24;
  return {
    format: "director-desk",
    version: 1,
    name: "卧室 · 四人调度",
    duration: 15,
    fps: 24,
    aspect: "16:9",
    room: { enabled: true, width: 4.8, depth: 4.2, height: 2.8 },
    entities: [a, b, c, d, ca, cb, cc, ...props],
    cuts: [
      { time: 0, cameraId: ca.id },
      { time: 5, cameraId: cb.id },
      { time: 10, cameraId: ca.id },
    ],
    references: [],
  };
}
