/** Portable native template scenes; all coordinates use the document canvas. */
import type { components } from "@generated/api";
import type { Deck, Slide, SlideElement } from "../types";
import { newElement, newSlide, newId } from "../templates";
import { cloneFragment } from "../scene/model";
import type { Definition, PageType, Slot } from "./model";
export type Scene = components["schemas"]["TemplateScene"];
export type Scope = "global" | "page" | "defaults";
export const emptyScene = (): Scene => ({
  elements: [],
  groups: [],
  connections: [],
  infographics: [],
  semantics: [],
});
export function slotElement(
  id: string,
  slot: Slot,
  text: string,
): SlideElement {
  return newElement("text", {
    id,
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    name: text,
    fill_opacity: 0,
    text_layout: {
      padding: 0,
      align: "top",
      auto_fit: false,
      letter_spacing: 0,
      vertical: false,
    },
    paragraphs: [
      {
        align: slot.style.align,
        line_height: 1.25,
        bullet: false,
        numbered: false,
        runs: [
          {
            text,
            font: slot.style.font,
            size: slot.style.size,
            color: slot.style.color,
            bold: slot.style.bold,
            italic: false,
            underline: false,
          },
        ],
      },
    ],
    hidden: slot.visible === false,
  });
}
/** Deliberate v1 conversion copies only explicitly configured slots and decorations. */
export function editableDefinition(input: Definition): Definition {
  if (input.version === 2) return structuredClone(input);
  const d = structuredClone(input);
  d.version = 2;
  d.global_scene = emptyScene();
  for (const [type, layout] of Object.entries(d.layouts)) {
    const scene = emptyScene();
    if (layout.background_asset_id)
      scene.elements!.push(
        newElement("image", {
          id: "background",
          name: "背景图片",
          x: 0,
          y: 0,
          width: d.width,
          height: d.height,
          asset_id: layout.background_asset_id,
        }),
      );
    for (const item of d.fixed ?? [])
      if (
        (
          item.page_types ?? ["cover", "toc", "section", "content", "ending"]
        ).includes(type as PageType)
      ) {
        const e =
          item.kind === "text"
            ? slotElement(
                item.id,
                { ...item, visible: true, style: item.style! },
                item.text ?? "固定文字",
              )
            : newElement(item.kind ?? "rect", {
                id: item.id,
                x: item.x,
                y: item.y,
                width: item.width,
                height: item.height,
                asset_id: item.asset_id,
                fill: item.fill,
                opacity: item.opacity,
                name: "固定元素",
                fill_opacity: 1,
              });
        if (item.layer === "behind") scene.elements!.unshift(e);
        else scene.elements!.push(e);
      }
    const names = {
      chapter: "章节标题",
      title: "幻灯片标题",
      number: "9",
      toc: "目录由章节自动生成",
    };
    for (const role of ["chapter", "title", "number", "toc"] as const) {
      const slot = layout[role];
      const e = slotElement(`slot-${role}`, slot, names[role]);
      e.hidden =
        e.hidden ||
        (role === "toc" && type !== "toc") ||
        (role === "number" &&
          !!d.number_hidden_types?.includes(type as PageType));
      scene.elements!.push(e);
      scene.semantics!.push({ element_id: e.id, role });
    }
    layout.scene = scene;
    layout.defaults = emptyScene();
    layout.background_asset_id = null;
  }
  d.fixed = [];
  return d;
}
export function layerScene(d: Definition, type: PageType, scope: Scope): Scene {
  return scope === "global"
    ? (d.global_scene ?? emptyScene())
    : (d.layouts[type][scope === "page" ? "scene" : "defaults"] ??
        emptyScene());
}
export function writeScene(
  d: Definition,
  type: PageType,
  scope: Scope,
  scene: Scene,
): Definition {
  return scope === "global"
    ? { ...d, global_scene: scene }
    : {
        ...d,
        layouts: {
          ...d.layouts,
          [type]: {
            ...d.layouts[type],
            [scope === "page" ? "scene" : "defaults"]: scene,
          },
        },
      };
}
export function sceneSlide(d: Definition, type: PageType, scope: Scope): Slide {
  const scene = layerScene(d, type, scope);
  return {
    ...newSlide(),
    id: `template-${type}-${scope}`,
    background: d.layouts[type].background,
    ...scene,
    elements: (scene.elements ?? []).map((e) => ({ ...e, locked: false })),
  };
}
function idsFor(scene: Scene, prefix: string) {
  const roles = new Map(scene.semantics?.map((s) => [s.element_id, s.role]));
  return new Map(
    [
      ...(scene.elements ?? []),
      ...(scene.groups ?? []),
      ...(scene.connections ?? []),
      ...(scene.infographics ?? []),
    ].map((e, i) => [e.id, `${prefix}${roles.get(e.id) ?? "object"}-${i}`]),
  );
}
function instance(
  scene: Scene,
  prefix: string,
  texts: Record<string, string>,
  hidden: string[],
  d: Definition,
  deck: Deck,
  pageType: PageType,
): Scene {
  const ids = idsFor(scene, prefix),
    roles = new Map(scene.semantics?.map((s) => [s.element_id, s.role]));
  return {
    ...scene,
    elements: (scene.elements ?? []).map((e) => {
      const role = roles.get(e.id),
        text = role ? (texts[role] ?? "") : null;
      const paragraphs = role
        ? [
            {
              ...e.paragraphs[0],
              runs: [{ ...e.paragraphs[0].runs[0], text: text! }],
            },
          ]
        : e.paragraphs;
      return {
        ...e,
        id: ids.get(e.id)!,
        locked: true,
        hidden:
          (!!scene.page_types?.[e.id] &&
            !scene.page_types[e.id].includes(pageType)) ||
          e.hidden ||
          hidden.includes(e.id) ||
          (!!role && (hidden.includes(role) || !text)),
        paragraphs: paragraphs.map((p) => ({
          ...p,
          runs: p.runs.map((r) => ({
            ...r,
            font: r.font === deck.template!.snapshot.font ? d.font : r.font,
            color:
              r.color === deck.template!.snapshot.foreground
                ? d.foreground
                : r.color === deck.template!.snapshot.accent
                  ? d.accent
                  : r.color,
          })),
        })),
      };
    }),
    groups: scene.groups?.map((g) => ({
      ...g,
      id: ids.get(g.id)!,
      parent_id: g.parent_id ? ids.get(g.parent_id) : null,
      element_ids: (g.element_ids ?? []).map((id) => ids.get(id)!),
    })),
    connections: scene.connections?.map((c) => ({
      ...c,
      id: ids.get(c.id)!,
      source_id: c.source_id ? ids.get(c.source_id) : null,
      target_id: c.target_id ? ids.get(c.target_id) : null,
    })),
    infographics: scene.infographics?.map((i) => ({
      ...i,
      id: ids.get(i.id)!,
      group_id: ids.get(i.group_id)!,
    })),
  };
}
export function resolveNativeSlide(
  deck: Deck,
  source: Slide,
  index: number,
  d: Definition,
  entries: { title: string; page: number }[],
): Slide {
  const layout = d.layouts[source.page_type ?? "content"];
  const texts = {
    title: source.title ?? "",
    chapter:
      deck.chapters?.find((c) => c.id === source.chapter_id)?.title ?? "",
    number: d.number_hidden_types?.includes(source.page_type ?? "content")
      ? ""
      : `${(d.number_start ?? 1) + index}${d.number_total ? ` / ${deck.slides.length}` : ""}`,
    toc:
      source.page_type === "toc"
        ? entries
            .slice(
              source.toc_offset ?? 0,
              (source.toc_offset ?? 0) + (layout.toc_capacity ?? 7),
            )
            .map((e) => `${e.title}    ${e.page}`)
            .join("\n")
        : "",
  };
  const global = instance(
    d.global_scene ?? emptyScene(),
    `master-${index}-global-`,
    texts,
    source.template_hidden ?? [],
    d,
    deck,
    source.page_type ?? "content",
  );
  const page = instance(
    layout.scene ?? emptyScene(),
    `master-${index}-page-`,
    texts,
    source.template_hidden ?? [],
    d,
    deck,
    source.page_type ?? "content",
  );
  const offset = (global.elements?.length ?? 0) + (page.elements?.length ?? 0);
  return {
    ...source,
    background: layout.background,
    background_style: null,
    elements: [
      ...(global.elements ?? []),
      ...(page.elements ?? []),
      ...source.elements,
    ],
    groups: [
      ...(global.groups ?? []),
      ...(page.groups ?? []),
      ...(source.groups ?? []),
    ],
    connections: [
      ...(global.connections ?? []),
      ...(page.connections ?? []).map((c) => ({
        ...c,
        layer: (c.layer ?? 0) + (global.elements?.length ?? 0),
      })),
      ...(source.connections ?? []).map((c) => ({
        ...c,
        layer: (c.layer ?? 0) + offset,
      })),
    ],
    infographics: [
      ...(global.infographics ?? []),
      ...(page.infographics ?? []),
      ...(source.infographics ?? []),
    ],
  };
}
export function defaultPage(
  d: Definition,
  type: PageType,
  binding?: Deck["template"],
): Slide {
  const scene = d.layouts[type].defaults ?? emptyScene();
  const base = {
    ...newSlide(),
    elements: scene.elements ?? [],
    groups: scene.groups ?? [],
    connections: scene.connections ?? [],
    infographics: scene.infographics ?? [],
  };
  const ids = new Map<string, string>();
  const clone = cloneFragment(
    base,
    base.elements.map((e) => e.id),
    () => newId(),
    0,
  );
  base.elements.forEach((e, i) => ids.set(e.id, clone.elements[i].id));
  return {
    ...base,
    ...clone,
    id: newId(),
    page_type: type,
    layout_source: {
      template_id: binding?.template_id,
      template_revision: binding?.template_revision ?? 0,
      page_type: type,
      objects: base.elements.map((e) => ({
        element_id: ids.get(e.id)!,
        default_id: e.id,
      })),
    },
  };
}
