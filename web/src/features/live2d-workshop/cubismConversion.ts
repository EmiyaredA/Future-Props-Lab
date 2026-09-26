import { strFromU8, strToU8, zipSync, unzipSync } from "fflate";
import type { CharacterDocument, Part, Point } from "./types";
import { inspectCubismImport } from "./cubismInterchange";
import { CubismRuntime, type CubismDrawable, type CubismMetadata } from "./cubismRuntime";

export interface ConversionResult {
  report: string[];
  blockers: string[];
  package: Blob | null;
  preview: Blob | null;
  parts: number;
  parameters: number;
}

function destination(pointX: number, pointY: number, sourceWidth: number, sourceHeight: number, width: number, height: number): Point {
  return {
    x: (pointX / sourceWidth + 0.5) * width,
    y: (0.5 - pointY / sourceHeight) * height,
  };
}

function triangleImage(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  source: [Point, Point, Point],
  target: [Point, Point, Point],
) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = target;
  const determinant = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(determinant) < 1e-8) return;
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / determinant;
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / determinant;
  const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / determinant;
  const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / determinant;
  const e = d0.x - a * s0.x - c * s0.y;
  const f = d0.y - b * s0.x - d * s0.y;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();
}

async function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("无法生成转换图层 PNG");
  return blob;
}

function layerImage(drawable: CubismDrawable, bitmap: ImageBitmap): HTMLCanvasElement {
  const uvPoints = Array.from({ length: drawable.uvs.length / 2 }, (_, i) => ({
    x: drawable.uvs[i * 2] * bitmap.width,
    y: drawable.uvs[i * 2 + 1] * bitmap.height,
  }));
  const left = Math.max(0, Math.floor(Math.min(...uvPoints.map((p) => p.x))));
  const top = Math.max(0, Math.floor(Math.min(...uvPoints.map((p) => p.y))));
  const right = Math.min(bitmap.width, Math.ceil(Math.max(...uvPoints.map((p) => p.x))));
  const bottom = Math.min(bitmap.height, Math.ceil(Math.max(...uvPoints.map((p) => p.y))));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, right - left);
  canvas.height = Math.max(1, bottom - top);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法建立图层画布");
  ctx.beginPath();
  for (let i = 0; i < drawable.triangles.length; i += 3) {
    const [a, b, c] = drawable.triangles.slice(i, i + 3).map((index) => uvPoints[index]);
    ctx.moveTo(a.x - left, a.y - top);
    ctx.lineTo(b.x - left, b.y - top);
    ctx.lineTo(c.x - left, c.y - top);
    ctx.closePath();
  }
  ctx.clip();
  ctx.drawImage(bitmap, -left, -top);
  return canvas;
}

function uvBounds(drawable: CubismDrawable, bitmap: ImageBitmap) {
  const left = Math.max(0, Math.floor(Math.min(...drawable.uvs.filter((_, i) => i % 2 === 0)) * bitmap.width));
  const top = Math.max(0, Math.floor(Math.min(...drawable.uvs.filter((_, i) => i % 2 === 1)) * bitmap.height));
  const right = Math.min(bitmap.width, Math.ceil(Math.max(...drawable.uvs.filter((_, i) => i % 2 === 0)) * bitmap.width));
  const bottom = Math.min(bitmap.height, Math.ceil(Math.max(...drawable.uvs.filter((_, i) => i % 2 === 1)) * bitmap.height));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export async function convertCubism(
  source: Blob,
  metadata: CubismMetadata,
  template: CharacterDocument,
  stateBindings: Record<string, { motion?: string; expression?: string }>,
): Promise<ConversionResult> {
  const report: string[] = [];
  const blockers: string[] = [];
  const probe = document.createElement("canvas");
  probe.width = 64; probe.height = 64;
  const runtime = await CubismRuntime.open(probe, source, metadata);
  try {
    const drawables = runtime.drawables();
    const parameters = runtime.parameters();
    if (drawables.length > 128) blockers.push(`绘制部件 ${drawables.length} 个，超过 FPL 的 128 个上限`);
    if (parameters.length > 128) blockers.push(`参数 ${parameters.length} 个，超过 FPL 的 128 个上限`);
    for (const drawable of drawables) {
      if (drawable.positions.length / 2 > 4096 || drawable.triangles.length > 24576)
        blockers.push(`${drawable.id} 网格超过 FPL 顶点或三角索引上限`);
      if (drawable.masks.length > 1) report.push(`${drawable.id} 使用多个遮罩；FPL 仅支持单遮罩，转换将近似`);
      if (drawable.blendMode !== 0) report.push(`${drawable.id} 使用非普通混合；FPL 将按普通混合近似`);
    }
    if (metadata.physics) report.push("Cubism 物理不会变为 FPL 骨骼弹性，转换后需手动绑定");
    if (metadata.pose) report.push("Cubism 姿势切换不能完整还原，转换后需检查可见性");
    report.push("Cubism 运行包不含原始骨骼树、变形器或可编辑源工程；转换副本不生成伪骨骼");
    for (let index = 0; index < parameters.length; index++) {
      if (runtime.parameterKeys(index).length > 32)
        blockers.push(`${parameters[index].id} 关键参数值超过 FPL 的 32 个关键形上限`);
    }
    if (blockers.length) return { report, blockers, package: null, preview: null, parts: drawables.length, parameters: parameters.length };
    const canvasSize = runtime.canvasSize();
    if (canvasSize.width <= 0 || canvasSize.height <= 0)
      throw new Error("Cubism 画布尺寸无效");
    const width = 1200;
    const height = Math.max(32, Math.min(4096, Math.round(width * canvasSize.height / canvasSize.width)));
    const doc = structuredClone(template);
    doc.schemaVersion = 3;
    doc.width = width; doc.height = height;
    doc.parts = []; doc.deformers = []; doc.bones = [];
    doc.parameters = []; doc.expressions = []; doc.motions = [];
    doc.stateBindings = {};
    doc.cubismParameterIds = {};
    doc.idleBehavior = {
      blinkParameter: null, gazeXParameter: null, gazeYParameter: null,
      breathParameter: null, swayParameter: null, springBones: [], intensity: 0,
    };
    const side = Math.min(width, height * 0.6);
    doc.cameras = {
      avatar: { x: (width - side) / 2, y: 0, width: side, height: side },
      stage: { x: 0, y: 0, width, height },
    };
    const files = unzipSync(new Uint8Array(await source.arrayBuffer()));
    const textures = await Promise.all(metadata.textures.map((path) =>
      createImageBitmap(new Blob([new Uint8Array(files[path])], { type: "image/png" }))));
    const packageFiles: Record<string, Uint8Array> = {};
    const preview = document.createElement("canvas");
    preview.width = 480; preview.height = Math.round(480 * height / width);
    const previewContext = preview.getContext("2d");
    if (!previewContext) throw new Error("无法生成转换对照图");
    try {
      for (const [index, drawable] of drawables.entries()) {
        const bitmap = textures[drawable.textureIndex];
        if (!bitmap) throw new Error(`${drawable.id} 引用了缺失贴图`);
        const bounds = uvBounds(drawable, bitmap);
        const layer = layerImage(drawable, bitmap);
        const png = await toPng(layer);
        const assetId = crypto.randomUUID();
        const partId = crypto.randomUUID();
        packageFiles[`assets/${assetId}.png`] = new Uint8Array(await png.arrayBuffer());
        const world = Array.from({ length: drawable.positions.length / 2 }, (_, vertex) =>
          destination(drawable.positions[vertex * 2], drawable.positions[vertex * 2 + 1], canvasSize.width, canvasSize.height, width, height));
        const x = Math.min(...world.map((point) => point.x));
        const y = Math.min(...world.map((point) => point.y));
        const part: Part = {
          id: partId, assetId, name: drawable.id.slice(0, 120), group: "Cubism 绘制部件", parentId: null,
          x, y, width: bounds.width, height: bounds.height,
          vertices: world.map((point) => ({ x: point.x - x, y: point.y - y })),
          uvs: Array.from({ length: drawable.uvs.length / 2 }, (_, vertex) => ({
            x: Math.max(0, Math.min(1, (drawable.uvs[vertex * 2] * bitmap.width - bounds.left) / bounds.width)),
            y: Math.max(0, Math.min(1, (drawable.uvs[vertex * 2 + 1] * bitmap.height - bounds.top) / bounds.height)),
          })),
          triangles: drawable.triangles,
          opacity: drawable.opacity,
          order: drawable.order,
          visible: true,
          locked: false,
          maskId: null,
        };
        doc.parts.push(part);
        if (drawable.masks.length === 1) {
          // Resolve after every converted part has a stable ID.
          part.maskId = `index:${drawable.masks[0]}`;
        }
        const scale = preview.width / width;
        const ctx = previewContext;
        ctx.globalAlpha = part.opacity;
        for (let n = 0; n < drawable.triangles.length; n += 3) {
          const vertices = drawable.triangles.slice(n, n + 3);
          const sourcePoints = vertices.map((v) => ({ x: drawable.uvs[v * 2] * bitmap.width, y: drawable.uvs[v * 2 + 1] * bitmap.height })) as [Point, Point, Point];
          const targetPoints = vertices.map((v) => ({ x: world[v].x * scale, y: world[v].y * scale })) as [Point, Point, Point];
          triangleImage(ctx, bitmap, sourcePoints, targetPoints);
        }
        ctx.globalAlpha = 1;
        if (index % 20 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } finally { textures.forEach((texture) => texture.close()); }
    for (const part of doc.parts) {
      if (part.maskId?.startsWith("index:")) {
        const mask = Number(part.maskId.slice(6));
        part.maskId = doc.parts[mask]?.id ?? null;
      }
    }
    for (const [index, parameter] of parameters.entries()) {
      const parameterId = crypto.randomUUID();
      doc.cubismParameterIds[parameterId] = parameter.id;
      const valueKeys = [...new Set([parameter.minimum, parameter.defaultValue, parameter.maximum, ...runtime.parameterKeys(index)])].sort((a, b) => a - b);
      const bindings: CharacterDocument["parameters"][number]["bindings"] = [];
      const samples = valueKeys.map((value) => ({ value, drawables: runtime.sampleParameter(index, value) }));
      for (const [partIndex, part] of doc.parts.entries()) {
        const defaultDrawable = drawables[partIndex];
        const keys = samples.map(({ value, drawables: posed }) => {
          const current = posed[partIndex];
          const positions = Array.from({ length: current.positions.length / 2 }, (_, vertex) =>
            destination(current.positions[vertex * 2], current.positions[vertex * 2 + 1], canvasSize.width, canvasSize.height, width, height));
          return { value, points: positions.map((point) => ({ x: point.x - part.x, y: point.y - part.y })), opacity: current.opacity };
        });
        const changed = keys.some((key) => key.points.some((point, vertex) =>
          Math.abs(point.x - part.vertices[vertex].x) + Math.abs(point.y - part.vertices[vertex].y) > 0.05) ||
          Math.abs(key.opacity - defaultDrawable.opacity) > 0.001);
        if (changed) bindings.push({ targetId: part.id, keys });
      }
      doc.parameters.push({ id: parameterId, name: parameter.id.slice(0, 120),
        minimum: parameter.minimum, maximum: parameter.maximum, default: parameter.defaultValue, bindings });
    }
    const motionIds = new Map<string, string>();
    const expressionIds = new Map<string, string>();
    for (const [group, paths] of Object.entries(metadata.motions)) {
      for (const [index, path] of paths.entries()) {
        const parsed = inspectCubismImport(JSON.parse(strFromU8(files[path])), path, doc);
        report.push(...parsed.issues.map((issue) => `${group}:${index}：${issue.message}`));
        if (!parsed.issues.some((issue) => issue.level === "error") && parsed.motion) {
          doc.motions.push(parsed.motion); motionIds.set(`${group}:${index}`, parsed.motion.id);
        }
      }
    }
    for (const item of metadata.expressions) {
      const parsed = inspectCubismImport(JSON.parse(strFromU8(files[item.path])), item.path, doc);
      report.push(...parsed.issues.map((issue) => `${item.name}：${issue.message}`));
      if (!parsed.issues.some((issue) => issue.level === "error") && parsed.expression) {
        doc.expressions.push(parsed.expression); expressionIds.set(item.name, parsed.expression.id);
      }
    }
    for (const [state, binding] of Object.entries(stateBindings)) {
      const motionId = binding.motion ? motionIds.get(binding.motion) : undefined;
      const expressionId = binding.expression ? expressionIds.get(binding.expression) : undefined;
      if ((binding.motion && !motionId) || (binding.expression && !expressionId)) {
        report.push(`${state}：状态绑定引用了未能转换的动作或表情`);
        continue;
      }
      doc.stateBindings[state as keyof typeof doc.stateBindings] = {
        motionId: motionId ?? null, expressionId: expressionId ?? null,
        playback: ["success", "error", "paused"].includes(state) ? "onceHold" : "loop",
      };
    }
    packageFiles["manifest.json"] = strToU8(JSON.stringify({
      format: "fpllive2d", version: 3, title: "Cubism 转换副本", document: doc,
    }));
    return {
      report, blockers, package: new Blob([zipSync(packageFiles, { level: 1 })], { type: "application/zip" }),
      preview: await toPng(preview), parts: drawables.length, parameters: parameters.length,
    };
  } finally { runtime.close(); }
}
