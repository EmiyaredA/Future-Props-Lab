import type {
  FrameSequences,
  SequenceClip,
  SequenceFrame,
  SequencePoint,
  SequenceRect,
  SequenceTransition,
} from "./types";

const safeId = /^[a-zA-Z0-9_-]{1,48}$/;
const edges = ["left", "right", "top", "bottom"] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown, limit: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= limit;
const exact = (
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
) =>
  required.every((key) => key in value) &&
  Object.keys(value).every(
    (key) => required.includes(key) || optional.includes(key),
  );
const point = (value: unknown, size: SequencePoint): value is SequencePoint =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((n, i) => finite(n, size[i]) && n >= 0);
const tuple = (
  value: unknown,
  length: number,
  limit: number,
): value is number[] =>
  Array.isArray(value) &&
  value.length === length &&
  value.every((n) => finite(n, limit));
const fail = (detail: string): never => {
  throw new Error(`完整序列帧资源无效：${detail}`);
};

function readFrame(
  value: unknown,
  size: SequencePoint,
  scale: number,
  headLength: number,
): SequenceFrame {
  if (
    !record(value) ||
    !exact(
      value,
      ["texture", "rect", "durationMs", "grip", "foot", "head"],
      ["contacts", "supports"],
    ) ||
    typeof value.texture !== "string" ||
    !safeId.test(value.texture) ||
    !finite(value.durationMs, 60000) ||
    value.durationMs <= 0 ||
    !point(value.grip, size) ||
    !point(value.foot, size) ||
    !Array.isArray(value.head) ||
    value.head.length !== 2 ||
    !point(value.head[0], size) ||
    !point(value.head[1], size)
  )
    return fail("图片、时长或局部锚点");
  const rect = value.rect;
  if (
    !tuple(rect, 4, 4096) ||
    !rect.every((n) => Number.isInteger(n) && n >= 0) ||
    rect[2] !== size[0] ||
    rect[3] !== size[1]
  )
    return fail("裁切必须保持统一尺寸");
  const first = value.head[0];
  const second = value.head[1];
  const measured =
    Math.hypot(first[0] - second[0], first[1] - second[1]) * scale;
  if (!(measured > 0) || Math.abs(measured / headLength - 1) > 0.02 + 1e-10)
    return fail("头部比例超出统一标尺的百分之二");
  const frame: SequenceFrame = {
    texture: value.texture,
    rect: [rect[0], rect[1], rect[2], rect[3]],
    durationMs: value.durationMs,
    grip: [...value.grip],
    foot: [...value.foot],
    head: [[...first], [...second]],
  };
  if ("contacts" in value) {
    if (
      !record(value.contacts) ||
      Object.keys(value.contacts).some(
        (key) => !edges.some((edge) => edge === key),
      )
    )
      return fail("四边接触锚点");
    const contacts: NonNullable<SequenceFrame["contacts"]> = {};
    for (const edge of edges)
      if (edge in value.contacts) {
        const anchor = value.contacts[edge];
        if (!point(anchor, size)) return fail("四边接触锚点");
        contacts[edge] = [...anchor];
      }
    frame.contacts = contacts;
  }
  if ("supports" in value) {
    const names = ["armNear", "armFar", "legBack", "legFront"] as const;
    if (
      !record(value.supports) ||
      Object.keys(value.supports).some(
        (key) => !names.some((name) => name === key),
      )
    )
      return fail("真实支点");
    const supports: NonNullable<SequenceFrame["supports"]> = {};
    for (const name of names)
      if (name in value.supports) {
        const anchor = value.supports[name];
        if (!point(anchor, size)) return fail("真实支点");
        supports[name] = [...anchor];
      }
    frame.supports = supports;
  }
  return frame;
}

/** Missing optional resources stay absent; invalid declarations fail instead of enabling old motion. */
export function readFrameSequences(value: unknown): FrameSequences | null {
  if (value === undefined) return null;
  if (
    !record(value) ||
    !exact(value, [
      "version",
      "frameSize",
      "modelBox",
      "headLength",
      "clips",
      "transitions",
    ]) ||
    value.version !== 1
  )
    return fail("版本或字段");
  const rawSize = value.frameSize,
    rawBox = value.modelBox;
  if (
    !tuple(rawSize, 2, 4096) ||
    !rawSize.every((n) => Number.isInteger(n) && n > 0) ||
    !tuple(rawBox, 4, 512) ||
    rawBox[2] <= 0 ||
    rawBox[3] <= 0 ||
    !finite(value.headLength, 512) ||
    value.headLength <= 0
  )
    return fail("统一画布或头部标尺");
  const size: SequencePoint = [rawSize[0], rawSize[1]];
  const box: SequenceRect = [rawBox[0], rawBox[1], rawBox[2], rawBox[3]];
  const scale = box[2] / size[0],
    scaleY = box[3] / size[1];
  if (!(scale > 0) || Math.abs(scale - scaleY) > Math.max(scale, scaleY) * 1e-6)
    return fail("禁止各向异性缩放");
  if (
    !record(value.clips) ||
    Object.keys(value.clips).length < 1 ||
    Object.keys(value.clips).length > 64 ||
    !Object.hasOwn(value.clips, "idle")
  )
    return fail("片段数量");
  const clips: Record<string, SequenceClip> = Object.create(null);
  const headLength = value.headLength;
  let total = 0;
  for (const [id, clip] of Object.entries(value.clips)) {
    if (
      !safeId.test(id) ||
      !record(clip) ||
      !exact(clip, ["frames", "loop"], ["distancePerCycle"]) ||
      typeof clip.loop !== "boolean" ||
      !Array.isArray(clip.frames) ||
      clip.frames.length < 1 ||
      clip.frames.length > 128
    )
      return fail("片段定义");
    total += clip.frames.length;
    if (total > 2048) return fail("总帧数过大");
    const parsed: SequenceClip = {
      loop: clip.loop,
      frames: clip.frames.map((frame) =>
        readFrame(frame, size, scale, headLength),
      ),
    };
    if ("distancePerCycle" in clip) {
      if (!finite(clip.distancePerCycle, 512) || clip.distancePerCycle <= 0)
        return fail("循环距离");
      parsed.distancePerCycle = clip.distancePerCycle;
    }
    clips[id] = parsed;
  }
  const result: FrameSequences = {
    version: 1,
    frameSize: size,
    modelBox: box,
    headLength: value.headLength,
    clips,
    transitions: [],
  };
  if ("transitions" in value) {
    if (!Array.isArray(value.transitions) || value.transitions.length > 128)
      return fail("过渡数量");
    const ids = new Set<string>(),
      pairs = new Set<string>();
    const transitions: SequenceTransition[] = [];
    for (const transition of value.transitions) {
      if (
        !record(transition) ||
        !exact(transition, ["id", "from", "to", "clip"]) ||
        typeof transition.id !== "string" ||
        !safeId.test(transition.id) ||
        ids.has(transition.id) ||
        typeof transition.from !== "string" ||
        !Object.hasOwn(clips, transition.from) ||
        typeof transition.to !== "string" ||
        !Object.hasOwn(clips, transition.to) ||
        typeof transition.clip !== "string" ||
        !Object.hasOwn(clips, transition.clip)
      )
        return fail("过渡引用");
      const pair = `${transition.from}:${transition.to}`;
      if (pairs.has(pair)) return fail("重复过渡端点");
      ids.add(transition.id);
      pairs.add(pair);
      transitions.push({
        id: transition.id,
        from: transition.from,
        to: transition.to,
        clip: transition.clip,
      });
    }
    result.transitions = transitions;
  }
  return result;
}

/** Run after authorized image decode for each outfit, before uploading any atlas. */
export function validateSequenceImages(
  sequences: FrameSequences,
  dimensions: Record<string, { width: number; height: number }>,
): void {
  for (const clip of Object.values(sequences.clips))
    for (const frame of clip.frames) {
      const image = Object.hasOwn(dimensions, frame.texture)
        ? dimensions[frame.texture]
        : undefined;
      if (
        !image ||
        !Number.isInteger(image.width) ||
        !Number.isInteger(image.height) ||
        image.width < 1 ||
        image.height < 1 ||
        image.width > 4096 ||
        image.height > 4096 ||
        frame.rect[0] + frame.rect[2] > image.width ||
        frame.rect[1] + frame.rect[3] > image.height
      )
        fail("裁切超出服饰图集实际范围");
    }
}
