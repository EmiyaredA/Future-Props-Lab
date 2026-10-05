import { isTransitionContainer, transitionBranchFailure } from "./transitions";
import { validDistanceStages } from "./distanceStages";
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
const ownRecord = (value: unknown): value is Record<string, unknown> =>
  record(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const finite = (value: unknown, limit: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= limit;
const exact = (
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
) =>
  required.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every(
    (key) => required.includes(key) || optional.includes(key),
  );
const point = (value: unknown, size: SequencePoint): value is SequencePoint =>
  Array.isArray(value) &&
  value.length === 2 &&
  Array.from(value).every((n, i) => finite(n, size[i]) && n >= 0);
const tuple = (
  value: unknown,
  length: number,
  limit: number,
): value is number[] =>
  Array.isArray(value) &&
  value.length === length &&
  Array.from(value).every((n) => finite(n, limit));
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
    !ownRecord(value) ||
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
      !ownRecord(value.contacts) ||
      Object.keys(value.contacts).some(
        (key) => !edges.some((edge) => edge === key),
      )
    )
      return fail("四边接触锚点");
    const contacts: NonNullable<SequenceFrame["contacts"]> = {};
    for (const edge of edges)
      if (Object.hasOwn(value.contacts, edge)) {
        const anchor = value.contacts[edge];
        if (!point(anchor, size)) return fail("四边接触锚点");
        contacts[edge] = [...anchor];
      }
    frame.contacts = contacts;
  }
  if ("supports" in value) {
    const names = ["armNear", "armFar", "legBack", "legFront"] as const;
    if (
      !ownRecord(value.supports) ||
      Object.keys(value.supports).some(
        (key) => !names.some((name) => name === key),
      )
    )
      return fail("真实支点");
    const supports: NonNullable<SequenceFrame["supports"]> = {};
    for (const name of names)
      if (Object.hasOwn(value.supports, name)) {
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
    !exact(
      value,
      [
        "version",
        "frameSize",
        "modelBox",
        "headLength",
        "clips",
        "transitions",
      ],
      ["cels"],
    ) ||
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
  const cels: Record<string, SequenceFrame> = Object.create(null);
  if ("cels" in value && !Object.hasOwn(value, "cels"))
    return fail("登记帧必须是自有字段");
  if (Object.hasOwn(value, "cels")) {
    if (!ownRecord(value.cels)) return fail("登记帧必须是完整帧字典");
    const declarations = Object.entries(value.cels);
    total = declarations.length;
    if (total > 2048) return fail("总帧数过大");
    for (const [id, frame] of declarations) {
      if (!safeId.test(id)) return fail("登记帧标识");
      cels[id] = readFrame(frame, size, scale, headLength);
    }
  }
  const resolveFrame = (frame: unknown): SequenceFrame => {
    if (typeof frame !== "string")
      return readFrame(frame, size, scale, headLength);
    if (!safeId.test(frame) || !Object.hasOwn(cels, frame))
      return fail("未知登记帧引用");
    // Every use owns fresh nested anchors; neither siblings nor declarations share mutable state.
    return readFrame(cels[frame], size, scale, headLength);
  };
  for (const [id, clip] of Object.entries(value.clips)) {
    if (
      !safeId.test(id) ||
      !record(clip) ||
      !exact(
        clip,
        ["frames", "loop"],
        ["distancePerCycle", "distanceAtFrame"],
      ) ||
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
      frames: Array.from(clip.frames, resolveFrame),
    };
    if ("distancePerCycle" in clip) {
      if (!finite(clip.distancePerCycle, 512) || clip.distancePerCycle <= 0)
        return fail("循环距离");
      parsed.distancePerCycle = clip.distancePerCycle;
    }
    if (Object.hasOwn(clip, "distanceAtFrame")) {
      if (
        !tuple(clip.distanceAtFrame, parsed.frames.length + 1, 512) ||
        !Array.from(clip.distanceAtFrame).every((_, i) =>
          Object.hasOwn(clip.distanceAtFrame!, i),
        )
      )
        return fail("阶段累计距离");
      parsed.distanceAtFrame = [...clip.distanceAtFrame];
      if (!validDistanceStages(parsed)) return fail("阶段累计距离");
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
  if (Object.hasOwn(value, "cels")) result.cels = cels;
  if ("transitions" in value) {
    if (!Array.isArray(value.transitions) || value.transitions.length > 128)
      return fail("过渡数量");
    const ids = new Set<string>(),
      pairs = new Set<string>();
    const transitions: SequenceTransition[] = [];
    for (const transition of value.transitions) {
      if (
        !record(transition) ||
        !exact(transition, ["id", "from", "to", "clip"], ["branches"]) ||
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
      const parsed: SequenceTransition = {
        id: transition.id,
        from: transition.from,
        to: transition.to,
        clip: transition.clip,
      };
      if ("branches" in transition) {
        if (
          !Array.isArray(transition.branches) ||
          transition.branches.length > 128
        )
          return fail("过渡分支");
        parsed.branches = transition.branches.map((branch) => {
          if (
            !record(branch) ||
            !exact(branch, ["fromFrame", "clip"], ["range"]) ||
            typeof branch.fromFrame !== "number" ||
            !Number.isInteger(branch.fromFrame) ||
            typeof branch.clip !== "string" ||
            !Object.hasOwn(clips, branch.clip)
          )
            return fail("过渡分支引用");
          const parsedBranch: NonNullable<
            SequenceTransition["branches"]
          >[number] = {
            fromFrame: branch.fromFrame,
            clip: branch.clip,
          };
          if ("range" in branch) {
            if (
              !Array.isArray(branch.range) ||
              branch.range.length !== 2 ||
              !branch.range.every(
                (n) => typeof n === "number" && Number.isInteger(n),
              )
            )
              return fail("过渡分支范围");
            parsedBranch.range = [branch.range[0], branch.range[1]];
          }
          return parsedBranch;
        });
        const branchFailure = transitionBranchFailure(result, parsed);
        if (branchFailure) return fail(`过渡分支（${branchFailure}）`);
      }
      transitions.push(parsed);
    }
    result.transitions = transitions;
  }
  if (
    isTransitionContainer(result, "idle") ||
    result.transitions.some((transition) =>
      isTransitionContainer(result, transition.to),
    )
  )
    return fail("过渡容器不能作为待机或目标动作");
  return result;
}

/** Run after authorized image decode for each outfit, before uploading any atlas. */
export function validateSequenceImages(
  sequences: Pick<FrameSequences, "clips" | "cels">,
  dimensions: Record<string, { width: number; height: number }>,
): void {
  const frames = [
    ...Object.values(sequences.cels ?? {}),
    ...Object.values(sequences.clips).flatMap((clip) => clip.frames),
  ];
  for (const frame of frames) {
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
