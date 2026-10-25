import type { Slide } from "../../types";
import { newSlide } from "../../templates";
import { cleanScene } from "../../scene/model";
import {
  emptyScene,
  layerScene,
  writeScene,
  type Scene,
  type Scope,
} from "../nativeScenes";
import type { Definition, PageType } from "../model";
export const scopes: { value: Scope; label: string; impact: string }[] = [
  { value: "global", label: "全局固定", impact: "所有页型" },
  { value: "page", label: "页型固定", impact: "当前页型的所有页面" },
  { value: "defaults", label: "正文默认", impact: "新页；已有页面须预览套版" },
];
export function objectScope(id: string): Scope {
  return id.split(":")[0] as Scope;
}
export function objectId(id: string) {
  return id.slice(id.indexOf(":") + 1);
}
export function canvasScene(d: Definition, type: PageType): Slide {
  const slide = {
    ...newSlide(),
    id: `template-${type}`,
    background: d.layouts[type].background,
  };
  for (const { value: scope } of scopes) {
    const scene = structuredClone(layerScene(d, type, scope)),
      id = (s: string) => `${scope}:${s}`;
    const sampleTitle = {
      cover: "AI 应用实践",
      toc: "项目目录",
      section: "从技术选择到可控交付",
      content: "三条生成链路的技术选择",
      ending: "主要交付与下一步",
    }[type];
    for (const binding of scene.semantics ?? []) {
      const e = scene.elements?.find((e) => e.id === binding.element_id);
      const value =
        binding.role === "title"
          ? sampleTitle
          : binding.role === "chapter"
            ? "PPT Agent"
            : null;
      if (e && value && e.paragraphs[0]?.runs[0])
        e.paragraphs[0].runs[0].text = value;
    }
    const offset = slide.elements.length;
    slide.elements.push(
      ...(scene.elements ?? []).map((e) => ({
        ...e,
        id: id(e.id),
        locked: false,
      })),
    );
    slide.groups!.push(
      ...(scene.groups ?? []).map((g) => ({
        ...g,
        id: id(g.id),
        parent_id: g.parent_id ? id(g.parent_id) : null,
        element_ids: (g.element_ids ?? []).map(id),
      })),
    );
    slide.connections!.push(
      ...(scene.connections ?? []).map((c) => ({
        ...c,
        id: id(c.id),
        source_id: c.source_id ? id(c.source_id) : null,
        target_id: c.target_id ? id(c.target_id) : null,
        layer: (c.layer ?? 0) + offset,
      })),
    );
    slide.infographics!.push(
      ...(scene.infographics ?? []).map((i) => ({
        ...i,
        id: id(i.id),
        group_id: id(i.group_id),
      })),
    );
  }
  return slide;
}
export function commitCanvas(
  d: Definition,
  type: PageType,
  input: Slide,
): Definition {
  if (
    input.groups?.some(
      (g) =>
        (g.element_ids ?? []).some(
          (id) => objectScope(id) !== objectScope(g.id),
        ) ||
        (g.parent_id && objectScope(g.parent_id) !== objectScope(g.id)),
    ) ||
    input.connections?.some((c) =>
      [c.source_id, c.target_id].some(
        (id) => id && objectScope(id) !== objectScope(c.id),
      ),
    )
  )
    throw new Error("不能跨影响范围编组或连接，请先使用同一图层的对象。");
  const slide = cleanScene(input);
  let next = d,
    offset = 0;
  for (const { value: scope } of scopes) {
    const previous = layerScene(d, type, scope),
      elements = slide.elements.filter((e) => objectScope(e.id) === scope);
    const scene: Scene = {
      ...emptyScene(),
      elements: elements.map((e) => ({ ...e, id: objectId(e.id) })),
      groups: slide.groups
        ?.filter((g) => objectScope(g.id) === scope)
        .map((g) => ({
          ...g,
          id: objectId(g.id),
          parent_id: g.parent_id ? objectId(g.parent_id) : null,
          element_ids: (g.element_ids ?? []).map(objectId),
        })),
      connections: slide.connections
        ?.filter((c) => objectScope(c.id) === scope)
        .map((c) => ({
          ...c,
          id: objectId(c.id),
          source_id: c.source_id ? objectId(c.source_id) : null,
          target_id: c.target_id ? objectId(c.target_id) : null,
          layer: Math.min(
            elements.length,
            Math.max(0, (c.layer ?? 0) - offset),
          ),
        })),
      infographics: slide.infographics
        ?.filter((i) => objectScope(i.id) === scope)
        .map((i) => ({
          ...i,
          id: objectId(i.id),
          group_id: objectId(i.group_id),
        })),
      semantics: previous.semantics?.filter((s) =>
        elements.some((e) => objectId(e.id) === s.element_id),
      ),
      page_types: Object.fromEntries(
        Object.entries(previous.page_types ?? {}).filter(([id]) =>
          elements.some((e) => objectId(e.id) === id),
        ),
      ),
    };
    // Semantic source text is not editable preview content.
    scene.elements = scene.elements?.map((e) =>
      previous.semantics?.some((s) => s.element_id === e.id)
        ? {
            ...e,
            paragraphs: e.paragraphs.map((p, i) => ({
              ...p,
              runs: p.runs.map((r, j) => ({
                ...r,
                text:
                  previous.elements?.find((x) => x.id === e.id)?.paragraphs[i]
                    ?.runs[j]?.text ?? r.text,
              })),
            })),
          }
        : e,
    );
    next = writeScene(next, type, scope, scene);
    offset += elements.length;
  }
  return next;
}
export function semanticRole(d: Definition, type: PageType, id: string) {
  return layerScene(d, type, objectScope(id)).semantics?.find(
    (s) => s.element_id === objectId(id),
  )?.role;
}
