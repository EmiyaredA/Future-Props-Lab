import type { Fragment } from "../scene/model";
import { members } from "../scene/model";
import { newElement } from "../templates";
import type { Slide } from "../types";

const id = (v: unknown) =>
  typeof v === "string" && v.length > 0 && v.length <= 64;
const finite = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const color = (v: unknown) =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const invalid = (message: string): never => {
  throw new Error(`场景 JSON：${message}`);
};

export function validateFragment(fragment: Fragment): void {
  if (
    fragment &&
    Object.keys(fragment).some(
      (k) =>
        ![
          "elements",
          "groups",
          "connections",
          "infographics",
          "animations",
        ].includes(k),
    )
  )
    invalid("片段仅接受 elements、groups、connections 和 infographics");
  if (
    !fragment ||
    !Array.isArray(fragment.elements) ||
    !Array.isArray(fragment.groups) ||
    !Array.isArray(fragment.connections)
  )
    invalid("需要 elements、groups 和 connections 数组");
  if (
    !fragment.elements.length ||
    fragment.elements.length > 200 ||
    fragment.groups!.length > 200 ||
    fragment.connections!.length > 200 ||
    (fragment.infographics?.length ?? 0) > 50
  )
    invalid("元素、组或连接数量超限");
  const identifiers = [
    ...fragment.elements,
    ...fragment.groups!,
    ...fragment.connections!,
    ...(fragment.infographics ?? []),
  ].map((e) => e?.id);
  if (
    identifiers.some((v) => !id(v)) ||
    new Set(identifiers).size !== identifiers.length
  )
    invalid("所有对象 ID 必须非空、唯一且不超过 64 字符");
  const kinds = new Set([
    "text",
    "image",
    "vector",
    "rect",
    "roundRect",
    "ellipse",
    "triangle",
    "diamond",
    "arrow",
    "line",
    "rightTriangle",
    "pentagon",
    "hexagon",
    "star",
    "parallelogram",
    "trapezoid",
    "leftArrow",
    "upArrow",
    "downArrow",
    "doubleArrow",
    "callout",
    "roundCallout",
    "ellipseCallout",
  ]);
  if (fragment.animations?.length)
    invalid("信息图片段不接受放映动画，请在动画面板设置");
  const elementKeys = new Set(Object.keys(newElement("text")));
  for (const e of fragment.elements) {
    if (Object.keys(e).some((k) => !elementKeys.has(k)) || !kinds.has(e.kind))
      invalid("元素包含未知类型或字段");
    for (const key of ["x", "y"] as const)
      if (!finite(e[key], -10000, 10000)) invalid("元素坐标无效");
    for (const key of ["width", "height"] as const)
      if (!finite(e[key], 1, 10000)) invalid("元素尺寸无效");
    if (
      !finite(e.rotation, -360, 360) ||
      !finite(e.stroke_width, 0, 30) ||
      !color(e.fill) ||
      !color(e.stroke) ||
      typeof e.locked !== "boolean"
    )
      invalid("元素样式无效或缺少必填字段");
    for (const key of ["opacity", "fill_opacity"] as const)
      if (e[key] !== undefined && !finite(e[key], 0, 1))
        invalid("元素透明度无效");
    for (const key of ["flip_x", "flip_y", "image_border"] as const)
      if (e[key] !== undefined && typeof e[key] !== "boolean")
        invalid("元素开关格式无效");
    if (
      (e.vector_color != null &&
        (e.kind !== "vector" || !color(e.vector_color))) ||
      (e.corner_radius != null && !finite(e.corner_radius, 0, 5000))
    )
      invalid("矢量颜色或圆角无效");
    if (
      (e.stroke_dash && !["solid", "dash", "dot"].includes(e.stroke_dash)) ||
      [e.start_arrow, e.end_arrow].some(
        (v) =>
          v !== undefined &&
          !["none", "triangle", "open", "circle"].includes(v),
      )
    )
      invalid("图形线型无效");
    if (!Array.isArray(e.paragraphs) || e.paragraphs.length > 200 || !e.crop)
      invalid("元素需要 paragraphs 和 crop");
    for (const key of ["left", "right", "top", "bottom"] as const)
      if (!finite(e.crop[key], 0, 0.989999)) invalid("裁剪参数无效");
    if (
      e.crop.left + e.crop.right >= 0.99 ||
      e.crop.top + e.crop.bottom >= 0.99
    )
      invalid("裁剪必须保留可见区域");
    if (
      e.kind === "image" || e.kind === "vector"
        ? !id(e.asset_id)
        : e.asset_id !== null
    )
      invalid("素材引用与元素类型不匹配");
    if (e.kind === "text" ? !e.paragraphs.length : !!e.paragraphs.length)
      invalid("文字必须存入文本元素");
    for (const p of e.paragraphs) {
      if (
        !p ||
        !Array.isArray(p.runs) ||
        p.runs.length > 1000 ||
        !["left", "center", "right"].includes(p.align) ||
        !finite(p.line_height, 1, 3) ||
        typeof p.bullet !== "boolean" ||
        (p.numbered !== undefined && typeof p.numbered !== "boolean") ||
        (p.bullet && p.numbered)
      )
        invalid("段落格式无效");
      for (const r of p.runs)
        if (
          !r ||
          typeof r.text !== "string" ||
          r.text.length > 20000 ||
          !["Microsoft YaHei", "Arial", "Consolas"].includes(r.font) ||
          !finite(r.size, 6, 240) ||
          !color(r.color) ||
          [r.bold, r.italic, r.underline].some((v) => typeof v !== "boolean")
        )
          invalid("文字内容或字体格式无效");
    }
  }
  const elements = new Map(fragment.elements.map((e) => [e.id, e]));
  const groups = new Map(fragment.groups!.map((g) => [g.id, g]));
  const owned = new Set<string>();
  for (const g of groups.values()) {
    if (
      (g.name !== undefined && typeof g.name !== "string") ||
      Object.keys(g).some(
        (k) => !["id", "name", "parent_id", "element_ids"].includes(k),
      )
    )
      invalid("分组字段无效");
    if (!Array.isArray(g.element_ids) || (g.name?.length ?? 0) > 120)
      invalid("分组成员或名称无效");
    for (const member of g.element_ids!) {
      if (!elements.has(member) || owned.has(member))
        invalid("分组成员不存在或重复归属");
      owned.add(member);
    }
    const visited = new Set([g.id]);
    let parent = g.parent_id;
    while (parent) {
      if (!groups.has(parent) || visited.has(parent))
        invalid("分组父级不存在或形成循环");
      visited.add(parent);
      parent = groups.get(parent)!.parent_id;
    }
  }
  const roots = fragment.groups!.filter((g) => !g.parent_id);
  if (
    roots.length !== 1 ||
    members(fragment as Slide, roots[0].id).length !== elements.size
  )
    invalid("需要唯一根组，所有元素必须属于该组");
  const sides = ["left", "right", "top", "bottom"];
  for (const edge of fragment.connections!) {
    if (
      (edge.label !== undefined && typeof edge.label !== "string") ||
      (edge.arrow !== undefined && typeof edge.arrow !== "boolean") ||
      Object.keys(edge).some(
        (k) =>
          ![
            "id",
            "source_id",
            "target_id",
            "source_anchor",
            "target_anchor",
            "source_offset",
            "target_offset",
            "style",
            "label",
            "color",
            "width",
            "arrow",
            "layer",
            "waypoints",
          ].includes(k),
      )
    )
      invalid("连接字段无效");
    if (
      !elements.has(edge.source_id) ||
      !elements.has(edge.target_id) ||
      edge.source_id === edge.target_id ||
      [edge.source_id, edge.target_id].some(
        (v) => elements.get(v)!.kind === "line",
      )
    )
      invalid("连接引用了无效节点");
    if (
      (edge.source_anchor && !sides.includes(edge.source_anchor)) ||
      (edge.target_anchor && !sides.includes(edge.target_anchor)) ||
      (edge.source_offset !== undefined && !finite(edge.source_offset, 0, 1)) ||
      (edge.target_offset !== undefined && !finite(edge.target_offset, 0, 1)) ||
      (edge.style && !["straight", "step"].includes(edge.style)) ||
      (edge.label?.length ?? 0) > 500 ||
      (edge.color && !color(edge.color)) ||
      (edge.width !== undefined && !finite(edge.width, 0.5, 30)) ||
      (edge.layer !== undefined &&
        (!Number.isInteger(edge.layer) || !finite(edge.layer, 0, 200)))
    )
      invalid("连接样式无效");
    if (
      (edge.waypoints?.length ?? 0) > 32 ||
      (edge.waypoints ?? []).some(
        (p) => !finite(p.x, -10000, 10000) || !finite(p.y, -10000, 10000),
      )
    )
      invalid("连接路径无效");
  }
  const sources = new Set<string>();
  for (const info of fragment.infographics ?? []) {
    if (
      !groups.has(info.group_id) ||
      sources.has(info.group_id) ||
      !["antv", "scene"].includes(info.format) ||
      typeof info.source !== "string" ||
      info.source.length > 50000 ||
      (info.template?.length ?? 0) > 120
    )
      invalid("信息图来源无效");
    sources.add(info.group_id);
  }
}
