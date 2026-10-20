import { defaultPageSize, type PageSize } from "./types";
import type { Slide, SlideElement } from "./types";
import { members } from "./scene/model";
import { rotatedBounds, type Rect } from "./selectionGeometry";

export type LayoutCommand =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom"
  | "horizontal"
  | "vertical"
  | "width"
  | "height"
  | "size";
export const layoutCommands: { mode: LayoutCommand; label: string }[] = [
  { mode: "left", label: "左对齐" },
  { mode: "center", label: "水平居中" },
  { mode: "right", label: "右对齐" },
  { mode: "top", label: "顶部对齐" },
  { mode: "middle", label: "垂直居中" },
  { mode: "bottom", label: "底部对齐" },
  { mode: "horizontal", label: "水平分布" },
  { mode: "vertical", label: "垂直分布" },
  { mode: "width", label: "统一宽度" },
  { mode: "height", label: "统一高度" },
  { mode: "size", label: "统一宽高" },
];
export type LayoutObject = {
  id: string;
  name: string;
  elements: SlideElement[];
  box: Rect;
  width: number;
  height: number;
  locked: boolean;
  proportional: boolean;
};
export type LayoutControls = ReturnType<typeof layoutControls>;

/** Only direct children of the current editing scope are layout objects. */
export function layoutObjects(slide: Slide, scope: string | null) {
  const allowed = new Set(
    scope ? members(slide, scope) : slide.elements.map((e) => e.id),
  );
  const children = (slide.groups ?? []).filter(
    (g) => (g.parent_id ?? null) === scope,
  );
  const assigned = new Set(children.flatMap((g) => members(slide, g.id)));
  const objects: LayoutObject[] = [];
  const add = (
    id: string,
    name: string,
    elements: SlideElement[],
    group: boolean,
  ) => {
    if (!elements.length) return;
    const box = rotatedBounds(elements);
    objects.push({
      id,
      name,
      elements,
      box,
      width: group ? box.width : elements[0].width,
      height: group ? box.height : elements[0].height,
      locked: elements.some((e) => e.locked),
      proportional: elements.some(
        (e) =>
          e.kind === "image" ||
          e.kind === "vector" ||
          (group && e.rotation % 180 !== 0),
      ),
    });
  };
  for (const group of children) {
    const ids = new Set(members(slide, group.id));
    add(
      `group:${group.id}`,
      group.name,
      slide.elements.filter((e) => allowed.has(e.id) && ids.has(e.id)),
      true,
    );
  }
  for (const e of slide.elements) {
    if (allowed.has(e.id) && !assigned.has(e.id))
      add(
        `element:${e.id}`,
        e.paragraphs
          ?.flatMap((p) => p.runs.map((r) => r.text))
          .join("")
          .slice(0, 24) ||
          ({ text: "文本框", image: "图片", vector: "矢量图" }[
            e.kind as string
          ] ??
            "形状"),
        [e],
        false,
      );
  }
  // Stable document order also determines marquee reference order.
  const order = new Map(slide.elements.map((e, i) => [e.id, i]));
  return objects.sort(
    (a, b) =>
      Math.min(...a.elements.map((e) => order.get(e.id)!)) -
      Math.min(...b.elements.map((e) => order.get(e.id)!)),
  );
}

export function layoutContext(
  slide: Slide,
  ids: string[],
  scope: string | null,
  size: PageSize = defaultPageSize,
) {
  const objects = layoutObjects(slide, scope);
  const chosen = new Set(ids);
  const selected = objects.filter((o) =>
    o.elements.every((e) => chosen.has(e.id)),
  );
  selected.sort(
    (a, b) =>
      Math.min(...a.elements.map((e) => ids.indexOf(e.id))) -
      Math.min(...b.elements.map((e) => ids.indexOf(e.id))),
  );
  const scopeIds = new Set(scope ? members(slide, scope) : []);
  const scopedElements = slide.elements.filter((e) => scopeIds.has(e.id));
  const container = scopedElements.length
    ? rotatedBounds(scopedElements)
    : { x: 0, y: 0, ...size };
  return {
    selected,
    others: objects.filter((o) => !o.elements.some((e) => chosen.has(e.id))),
    container,
  };
}

export function layoutControls(
  slide: Slide,
  ids: string[],
  scope: string | null = null,
  readOnly = false,
  size: PageSize = defaultPageSize,
) {
  const { selected } = layoutContext(slide, ids, scope, size);
  const reference = selected[0];
  const reason = (mode: LayoutCommand) => {
    if (readOnly) return "只读文稿不可修改";
    if (!selected.length) return "请选择对象";
    if (selected.some((o) => o.locked)) return "请先解锁所选对象及其成员";
    const sizing = ["width", "height", "size"].includes(mode);
    if ((mode === "horizontal" || mode === "vertical") && selected.length < 3)
      return "至少选择三个对象";
    if (sizing && selected.length < 2) return "至少选择两个对象";
    if (
      mode === "size" &&
      selected.some(
        (o) =>
          o.proportional &&
          Math.abs(o.width / o.height - reference.width / reference.height) >
            1e-6,
      )
    )
      return "统一宽高会改变图片、矢量图或旋转分组的比例，请改用统一宽度或高度";
    if (
      sizing &&
      selected.some((o) => {
        const sx =
          mode === "height"
            ? o.proportional
              ? reference.height / o.height
              : 1
            : reference.width / o.width;
        const sy =
          mode === "width"
            ? o.proportional
              ? sx
              : 1
            : reference.height / o.height;
        const cx = o.box.x + o.box.width / 2,
          cy = o.box.y + o.box.height / 2;
        return o.elements.some((e) => {
          const x = cx + (e.x + e.width / 2 - cx) * sx - (e.width * sx) / 2;
          const y = cy + (e.y + e.height / 2 - cy) * sy - (e.height * sy) / 2;
          return (
            Math.abs(x) > 10000 ||
            Math.abs(y) > 10000 ||
            e.width * sx < 1 ||
            e.height * sy < 1 ||
            e.width * sx > 10000 ||
            e.height * sy > 10000
          );
        });
      })
    )
      return "目标尺寸超出允许范围";
    return undefined;
  };
  return {
    reference: reference
      ? `${reference.name} · ${+reference.width.toFixed(2)} × ${+reference.height.toFixed(2)}`
      : undefined,
    commands: layoutCommands.map((command) => ({
      ...command,
      reason: reason(command.mode),
    })),
  };
}

export function applyLayout(
  slide: Slide,
  ids: string[],
  scope: string | null,
  mode: LayoutCommand,
  pageSize: PageSize = defaultPageSize,
): Slide {
  if (
    layoutControls(slide, ids, scope, false, pageSize).commands.find(
      (c) => c.mode === mode,
    )?.reason
  )
    return slide;
  const { selected, container } = layoutContext(slide, ids, scope, pageSize);
  if (!selected.length) return slide;
  const box =
    selected.length === 1
      ? container
      : rotatedBounds(selected.flatMap((o) => o.elements));
  const replacements = new Map<string, SlideElement>();
  const reference = selected[0];
  const axis = mode === "horizontal" ? "x" : "y";
  const size = axis === "x" ? "width" : "height";
  const ordered = [...selected].sort((a, b) => a.box[axis] - b.box[axis]);
  const gap =
    (box[size] - selected.reduce((sum, o) => sum + o.box[size], 0)) /
    (selected.length - 1);
  let position = box[axis];
  for (const o of ordered) {
    let dx = 0,
      dy = 0;
    let sx = 1,
      sy = 1;
    if (["width", "height", "size"].includes(mode)) {
      sx = mode === "height" ? 1 : reference.width / o.width;
      sy = mode === "width" ? 1 : reference.height / o.height;
      if (o.proportional && mode === "width") sy = sx;
      if (o.proportional && mode === "height") sx = sy;
    } else {
      if (mode === "left") dx = box.x - o.box.x;
      if (mode === "center")
        dx = box.x + box.width / 2 - o.box.x - o.box.width / 2;
      if (mode === "right") dx = box.x + box.width - o.box.x - o.box.width;
      if (mode === "top") dy = box.y - o.box.y;
      if (mode === "middle")
        dy = box.y + box.height / 2 - o.box.y - o.box.height / 2;
      if (mode === "bottom") dy = box.y + box.height - o.box.y - o.box.height;
      if (mode === "horizontal") dx = position - o.box.x;
      if (mode === "vertical") dy = position - o.box.y;
    }
    const cx = o.box.x + o.box.width / 2,
      cy = o.box.y + o.box.height / 2;
    for (const e of o.elements) {
      replacements.set(e.id, {
        ...e,
        x: cx + (e.x + e.width / 2 - cx) * sx - (e.width * sx) / 2 + dx,
        y: cy + (e.y + e.height / 2 - cy) * sy - (e.height * sy) / 2 + dy,
        width: e.width * sx,
        height: e.height * sy,
      });
    }
    position += o.box[size] + gap;
  }
  const elements = slide.elements.map((e) => replacements.get(e.id) ?? e);
  if (
    elements.every((e, i) =>
      ["x", "y", "width", "height"].every(
        (k) =>
          e[k as keyof SlideElement] ===
          slide.elements[i][k as keyof SlideElement],
      ),
    )
  )
    return slide;
  return { ...slide, elements };
}
