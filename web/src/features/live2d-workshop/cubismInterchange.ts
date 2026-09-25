import type { CharacterDocument, Expression, Motion, TimeKey } from "./types";

export type InterchangeIssue = { level: "error" | "warning"; message: string };
export type InterchangePreview = {
  kind: "motion" | "expression";
  name: string;
  motion?: Motion;
  expression?: Expression;
  issues: InterchangeIssue[];
};

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const id = () => crypto.randomUUID();
const error = (message: string): InterchangeIssue => ({
  level: "error",
  message,
});
const warning = (message: string): InterchangeIssue => ({
  level: "warning",
  message,
});
const targetId = (doc: CharacterDocument, nativeId: string) =>
  doc.cubismParameterIds[nativeId] || nativeId;
const nativeParameter = (doc: CharacterDocument, externalId: string) =>
  doc.parameters.find((p) => targetId(doc, p.id) === externalId);

type Segment = {
  kind: number;
  start: [number, number];
  end: [number, number];
  c1?: [number, number];
  c2?: [number, number];
};

function parseSegments(raw: unknown): Segment[] {
  if (!Array.isArray(raw) || raw.length < 2 || !raw.every(finite))
    throw new Error("曲线 Segments 无效");
  const segments: Segment[] = [];
  let at = 2;
  let start: [number, number] = [raw[0], raw[1]];
  while (at < raw.length) {
    const kind = raw[at++];
    if (![0, 1, 2, 3].includes(kind)) throw new Error("未知的曲线插值方式");
    const count = kind === 1 ? 6 : 2;
    if (at + count > raw.length) throw new Error("曲线控制点不完整");
    const end: [number, number] =
      kind === 1 ? [raw[at + 4], raw[at + 5]] : [raw[at], raw[at + 1]];
    if (end[0] <= start[0]) throw new Error("曲线时间必须递增");
    segments.push({
      kind,
      start,
      end,
      ...(kind === 1
        ? {
            c1: [raw[at], raw[at + 1]] as [number, number],
            c2: [raw[at + 2], raw[at + 3]] as [number, number],
          }
        : {}),
    });
    at += count;
    start = end;
  }
  return segments;
}

function curveValue(
  segments: Segment[],
  first: [number, number],
  time: number,
) {
  if (time <= first[0]) return first[1];
  for (const segment of segments) {
    if (time > segment.end[0]) continue;
    if (segment.kind === 2)
      return time < segment.end[0] ? segment.start[1] : segment.end[1];
    if (segment.kind === 3)
      return time <= segment.start[0] ? segment.start[1] : segment.end[1];
    if (segment.kind === 0)
      return (
        segment.start[1] +
        ((time - segment.start[0]) / (segment.end[0] - segment.start[0])) *
          (segment.end[1] - segment.start[1])
      );
    const cubic = (a: number, b: number, c: number, d: number, t: number) =>
      (1 - t) ** 3 * a +
      3 * (1 - t) ** 2 * t * b +
      3 * (1 - t) * t * t * c +
      t ** 3 * d;
    let low = 0;
    let high = 1;
    for (let n = 0; n < 24; n++) {
      const mid = (low + high) / 2;
      if (
        cubic(
          segment.start[0],
          segment.c1![0],
          segment.c2![0],
          segment.end[0],
          mid,
        ) < time
      )
        low = mid;
      else high = mid;
    }
    return cubic(
      segment.start[1],
      segment.c1![1],
      segment.c2![1],
      segment.end[1],
      (low + high) / 2,
    );
  }
  return segments.at(-1)?.end[1] ?? first[1];
}

function sampledKeys(
  raw: unknown,
  fps: number,
  duration: number,
  minimum: number,
  maximum: number,
): { keys: TimeKey[]; approximate: boolean } {
  if (!Array.isArray(raw) || raw.length < 2 || !raw.every(finite))
    throw new Error("曲线 Segments 无效");
  const segments = parseSegments(raw);
  const first: [number, number] = [raw[0], raw[1]];
  if (
    first[0] < 0 ||
    segments.some(
      (s) =>
        s.c1 &&
        (s.c1[0] < s.start[0] || s.c2![0] > s.end[0] || s.c1[0] > s.c2![0]),
    )
  )
    throw new Error("曲线时间或贝塞尔控制点无效");
  const sampled: TimeKey[] = [];
  for (let frame = 0; frame <= duration; frame++) {
    const value = curveValue(segments, first, frame / fps);
    if (value < minimum - 1e-5 || value > maximum + 1e-5)
      throw new Error("曲线值超出 FPL 参数范围");
    sampled.push({ frame, value, interpolation: "linear" });
  }
  const keys = sampled.filter((point, index) => {
    if (index === 0 || index === sampled.length - 1) return true;
    const previous = sampled[index - 1];
    const next = sampled[index + 1];
    return Math.abs(point.value - (previous.value + next.value) / 2) > 1e-6;
  });
  if (keys.length > 1000) throw new Error("采样后超过每条轨道 1000 个关键帧");
  return {
    keys,
    approximate:
      segments.some((s) => s.kind === 1 || s.kind === 2 || s.kind === 3) ||
      segments.some(
        (s) => Math.abs(s.end[0] * fps - Math.round(s.end[0] * fps)) > 1e-6,
      ),
  };
}

export function inspectCubismImport(
  data: unknown,
  filename: string,
  doc: CharacterDocument,
): InterchangePreview {
  const source = object(data);
  const name =
    filename.replace(/\.(motion3|exp3)\.json$/i, "").slice(0, 120) ||
    "导入预设";
  const kind = filename.toLowerCase().endsWith(".exp3.json")
    ? "expression"
    : "motion";
  const issues: InterchangeIssue[] = [];
  if (
    !source ||
    (source.Version !== 3 && !(kind === "expression" && source.Version == null))
  )
    return { kind, name, issues: [error("仅支持 Cubism 3 JSON 格式")] };
  if (kind === "expression") {
    if (
      source.Type !== "Live2D Expression" ||
      !Array.isArray(source.Parameters)
    )
      return { kind, name, issues: [error("表情文件结构无效")] };
    const values: Record<string, number> = {};
    for (const entry of source.Parameters) {
      const row = object(entry);
      if (!row || typeof row.Id !== "string" || !finite(row.Value)) {
        issues.push(error("表情参数条目无效"));
        continue;
      }
      const parameter = nativeParameter(doc, row.Id);
      if (!parameter) {
        issues.push(error(`未映射参数：${row.Id}`));
        continue;
      }
      if (parameter.id in values) {
        issues.push(error(`重复参数：${row.Id}`));
        continue;
      }
      const blend = row.Blend ?? "Add";
      if (!["Add", "Multiply", "Overwrite"].includes(String(blend))) {
        issues.push(error(`不支持的表情混合模式：${blend}`));
        continue;
      }
      const value =
        blend === "Add"
          ? parameter.default + row.Value
          : blend === "Multiply"
            ? parameter.default * row.Value
            : row.Value;
      if (value < parameter.minimum || value > parameter.maximum) {
        issues.push(error(`表情参数越界：${row.Id}`));
        continue;
      }
      if (blend !== "Overwrite")
        issues.push(
          warning(`${row.Id} 的 ${blend} 已按当前默认值转换为静态值`),
        );
      values[parameter.id] = value;
    }
    if (source.FadeInTime != null || source.FadeOutTime != null)
      issues.push(warning("表情淡入淡出时间不会写入原生工程"));
    return { kind, name, expression: { id: id(), name, values }, issues };
  }
  const meta = object(source.Meta);
  if (
    !meta ||
    !finite(meta.Fps) ||
    !finite(meta.Duration) ||
    meta.Fps <= 0 ||
    meta.Duration <= 0 ||
    !Array.isArray(source.Curves)
  )
    return { kind, name, issues: [error("动作文件结构或帧率无效")] };
  const sourceDuration = meta.Duration;
  const fps = Math.max(1, Math.min(60, Math.round(meta.Fps)));
  const duration = Math.max(1, Math.ceil(sourceDuration * fps));
  if (duration > 36000 || source.Curves.length > 128)
    return { kind, name, issues: [error("动作时长或轨道数超过原生工程限制")] };
  if (fps !== meta.Fps)
    issues.push(warning(`帧率 ${meta.Fps} 已调整为 ${fps}`));
  if (meta.Loop === false)
    issues.push(warning("原动作标记为不循环；FPL 预览将按完整时长循环"));
  if (
    meta.FadeInTime != null ||
    meta.FadeOutTime != null ||
    (Array.isArray(source.UserData) && source.UserData.length)
  )
    issues.push(warning("淡入淡出或事件数据不会写入原生工程"));
  const tracks: Motion["tracks"] = [];
  const seen = new Set<string>();
  for (const entry of source.Curves) {
    const curve = object(entry);
    if (
      !curve ||
      curve.Target !== "Parameter" ||
      typeof curve.Id !== "string"
    ) {
      issues.push(error("存在模型或部件轨道；原生引擎仅支持参数轨道"));
      continue;
    }
    const parameter = nativeParameter(doc, curve.Id);
    if (!parameter) {
      issues.push(error(`未映射参数：${curve.Id}`));
      continue;
    }
    if (seen.has(parameter.id)) {
      issues.push(error(`重复轨道：${curve.Id}`));
      continue;
    }
    seen.add(parameter.id);
    if (curve.FadeInTime != null || curve.FadeOutTime != null)
      issues.push(warning(`${curve.Id} 的单轨淡入淡出不会写入原生工程`));
    try {
      const segments = parseSegments(curve.Segments);
      if (segments.some((segment) => segment.end[0] > sourceDuration + 1e-6))
        throw new Error("曲线超出动作时长");
      const result = sampledKeys(
        curve.Segments,
        fps,
        duration,
        parameter.minimum,
        parameter.maximum,
      );
      tracks.push({ parameterId: parameter.id, keys: result.keys });
      if (result.approximate)
        issues.push(
          warning(`${curve.Id} 已按 ${fps} FPS 采样，曲线可能有细微差异`),
        );
    } catch (exc) {
      issues.push(
        error(
          `${curve.Id}：${exc instanceof Error ? exc.message : "曲线无效"}`,
        ),
      );
    }
  }
  if (!tracks.length) issues.push(error("没有可导入的参数轨道"));
  return {
    kind,
    name,
    motion: {
      id: id(),
      name,
      fps,
      duration,
      loopStart: 0,
      loopEnd: duration,
      tracks,
    },
    issues,
  };
}

export function exportCubismExpression(
  doc: CharacterDocument,
  expression: Expression,
) {
  return {
    Version: 3,
    Type: "Live2D Expression",
    Parameters: Object.entries(expression.values).map(([nativeId, Value]) => ({
      Id: targetId(doc, nativeId),
      Value,
      Blend: "Overwrite",
    })),
  };
}

export function exportCubismMotion(doc: CharacterDocument, motion: Motion) {
  if (motion.loopStart !== 0 || motion.loopEnd !== motion.duration)
    throw new Error("Cubism 动作只能导出完整时长循环；请先调整循环区间");
  const activeTracks = motion.tracks
    .filter((track) => track.keys.length)
    .map((track) => {
      const keys = [...track.keys].sort((a, b) => a.frame - b.frame);
      return {
        ...track,
        keys:
          keys.length === 1
            ? [
                {
                  frame: 0,
                  value: keys[0].value,
                  interpolation: "linear" as const,
                },
                {
                  frame: motion.duration,
                  value: keys[0].value,
                  interpolation: "linear" as const,
                },
              ]
            : keys,
      };
    });
  const Curves = activeTracks.map((track) => {
    const keys = track.keys;
    const Segments: number[] = [keys[0].frame / motion.fps, keys[0].value];
    for (let index = 1; index < keys.length; index++) {
      const left = keys[index - 1];
      const right = keys[index];
      const end = right.frame / motion.fps;
      if (left.interpolation === "smooth") {
        const start = left.frame / motion.fps;
        Segments.push(
          1,
          start + (end - start) / 3,
          left.value,
          start + (2 * (end - start)) / 3,
          right.value,
          end,
          right.value,
        );
      } else
        Segments.push(left.interpolation === "hold" ? 2 : 0, end, right.value);
    }
    return {
      Target: "Parameter",
      Id: targetId(doc, track.parameterId),
      Segments,
    };
  });
  if (!Curves.length) throw new Error("动作没有参数关键帧");
  return {
    Version: 3,
    Meta: {
      Duration: motion.duration / motion.fps,
      Fps: motion.fps,
      Loop: true,
      CurveCount: Curves.length,
      TotalSegmentCount: activeTracks.reduce(
        (sum, track) => sum + track.keys.length - 1,
        0,
      ),
      TotalPointCount: activeTracks.reduce(
        (sum, track) =>
          sum +
          1 +
          track.keys
            .slice(0, -1)
            .reduce(
              (count, key) => count + (key.interpolation === "smooth" ? 3 : 1),
              0,
            ),
        0,
      ),
    },
    Curves,
  };
}
