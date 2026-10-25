import type { components } from "@generated/api";
import type { Deck, Slide, SlideElement } from "../types";
import { newElement, newSlide } from "../templates";
export type Definition = Omit<
  components["schemas"]["TemplateDefinition"],
  "layouts"
> & { layouts: Record<PageType, Layout> };
export type Layout = Omit<
  components["schemas"]["TemplatePageLayout"],
  "chapter" | "title" | "number" | "toc"
> & { chapter: Slot; title: Slot; number: Slot; toc: Slot };
export type Slot = Omit<components["schemas"]["TemplateSlot"], "style"> & {
  style: components["schemas"]["TemplateTextStyle"];
};
export type Fixed = components["schemas"]["TemplateFixedElement"];
export type Overrides = components["schemas"]["TemplateOverrides"];
export type Template = components["schemas"]["PresentationTemplateOut"];
export type Example = components["schemas"]["PresentationExampleOut"];
export type Change = components["schemas"]["TemplateChangeIn"];
export type Preview = components["schemas"]["TemplateChangePreview"];
export type PageType = NonNullable<Slide["page_type"]>;
export const pageTypes: { value: PageType; label: string }[] = [
  { value: "cover", label: "封面" },
  { value: "toc", label: "目录" },
  { value: "section", label: "章节过渡" },
  { value: "content", label: "内容页" },
  { value: "ending", label: "结束页" },
];
export function defaultDefinition(): Definition {
  const style = {
    font: "Microsoft YaHei" as const,
    size: 32,
    color: "#142B45",
    bold: false,
    align: "left" as const,
  };
  const slot = (
    x: number,
    y: number,
    width: number,
    height: number,
    size: number,
    bold = false,
  ): Slot => ({
    x,
    y,
    width,
    height,
    style: { ...style, size, bold },
    visible: true,
  });
  const definition: Definition = {
    version: 1,
    width: 1280,
    height: 720,
    font: "Microsoft YaHei",
    foreground: "#142B45",
    accent: "#EC805B",
    number_start: 1,
    number_total: false,
    number_hidden_types: ["cover"],
    fixed: [],
    layouts: Object.fromEntries(
      pageTypes.map(({ value }) => [
        value,
        {
          background: "#FAF8F3",
          background_asset_id: null,
          chapter: slot(64, 36, 1152, 32, 20),
          title: slot(64, 88, 1152, 64, 44, true),
          number: {
            ...slot(1116, 672, 100, 24, 14),
            style: { ...style, size: 14, color: "#7B8794", align: "right" },
          },
          toc: slot(64, 192, 1152, 408, 28),
          toc_capacity: 7,
          body_top: 176,
        },
      ]),
    ) as Definition["layouts"],
  };
  for (const type of ["cover", "ending", "section"] as const) {
    definition.layouts[type].title.y = 264;
    definition.layouts[type].title.height = 100;
    definition.layouts[type].title.style.size = 56;
    definition.layouts[type].chapter.y = 208;
    definition.layouts[type].body_top = 400;
  }
  for (const layout of Object.values(definition.layouts))
    layout.chapter.style.color = definition.accent;
  definition.layouts.ending.chapter.visible = false;
  return definition;
}
export function effectiveDefinition(deck: Deck): Definition | null {
  if (!deck.template) return null;
  const overrides = deck.template_overrides ?? {};
  return {
    ...deck.template.snapshot,
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([key, value]) => key !== "layouts" && value != null,
      ),
    ),
    layouts: {
      ...deck.template.snapshot.layouts,
      ...overrides.layouts,
    } as Definition["layouts"],
  };
}
export function chapterEntries(deck: Deck) {
  const names = new Map((deck.chapters ?? []).map((c) => [c.id, c.title]));
  const seen = new Set<string>();
  const start = effectiveDefinition(deck)?.number_start ?? 1;
  return deck.slides.flatMap((s, index) => {
    if (!s.chapter_id || seen.has(s.chapter_id)) return [];
    seen.add(s.chapter_id);
    return [
      {
        id: s.chapter_id,
        title: names.get(s.chapter_id) ?? "",
        page: start + index,
      },
    ];
  });
}
function resolvedStyle(
  style: Slot["style"],
  definition: Definition,
  deck: Deck,
) {
  return {
    ...style,
    font:
      style.font === deck.template!.snapshot.font
        ? definition.font
        : style.font,
    color:
      style.color === deck.template!.snapshot.foreground
        ? definition.foreground
        : style.color === deck.template!.snapshot.accent
          ? definition.accent
          : style.color,
  };
}

function masterElement(
  id: string,
  kind: "text" | "image" | "rect",
  box: Pick<Slot, "x" | "y" | "width" | "height">,
  text = "",
  style?: Slot["style"],
  asset_id: string | null = null,
  fill = "#FFFFFF",
  opacity = 1,
): SlideElement {
  const s = style ?? {
    font: "Microsoft YaHei",
    size: 32,
    color: "#142B45",
    bold: false,
    align: "left",
  };
  return newElement(kind, {
    ...box,
    id,
    name: `模板 · ${id.split("-").at(-1)}`,
    locked: true,
    fill,
    stroke: fill,
    stroke_width: 0,
    fill_opacity: kind === "rect" ? 1 : 0,
    opacity,
    asset_id,
    paragraphs:
      kind === "text"
        ? [
            {
              runs: [
                {
                  text,
                  font: s.font ?? "Microsoft YaHei",
                  size: s.size ?? 32,
                  color: s.color ?? "#142B45",
                  bold: s.bold ?? false,
                  italic: false,
                  underline: false,
                },
              ],
              align: s.align ?? "left",
              line_height: 1.2,
              bullet: false,
              numbered: false,
            },
          ]
        : [],
  });
}
export function resolveSlide(
  deck: Deck,
  source: Slide,
  index = deck.slides.findIndex((s) => s.id === source.id),
): Slide {
  const definition = effectiveDefinition(deck);
  if (
    !definition ||
    source.elements.some((e) => e.id.startsWith(`master-${index}-`))
  )
    return source;
  const type = source.page_type ?? "content";
  const layout = definition.layouts[type]!;
  const hidden = source.template_hidden ?? [];
  const prefix = `master-${index}`;
  const behind: SlideElement[] = [],
    front: SlideElement[] = [];
  const textSlot = (role: string, text: string, slot: Slot) => {
    if (!text || slot.visible === false || hidden.includes(role)) return;
    const style = resolvedStyle(slot.style, definition, deck);
    front.push(masterElement(`${prefix}-${role}`, "text", slot, text, style));
  };
  if (layout.background_asset_id && !hidden.includes("background"))
    behind.push(
      masterElement(
        `${prefix}-background`,
        "image",
        { x: 0, y: 0, width: deck.width, height: deck.height },
        "",
        undefined,
        layout.background_asset_id,
      ),
    );
  textSlot(
    "chapter",
    deck.chapters?.find((c) => c.id === source.chapter_id)?.title ?? "",
    layout.chapter!,
  );
  textSlot("title", source.title ?? "", layout.title!);
  if (!definition.number_hidden_types?.includes(type))
    textSlot(
      "number",
      `${(definition.number_start ?? 1) + index}${definition.number_total ? ` / ${deck.slides.length}` : ""}`,
      layout.number!,
    );
  if (
    type === "toc" &&
    !hidden.includes("toc") &&
    layout.toc?.visible !== false
  ) {
    const slot = layout.toc!,
      capacity = layout.toc_capacity ?? 7;
    chapterEntries(deck)
      .slice(source.toc_offset ?? 0, (source.toc_offset ?? 0) + capacity)
      .forEach((entry, row) =>
        textSlot(`toc-${row}`, `${entry.title}    ${entry.page}`, {
          ...slot,
          y: (slot.y ?? 192) + (row * (slot.height ?? 408)) / capacity,
          height: (slot.height ?? 408) / capacity,
        }),
      );
  }
  definition.fixed?.forEach((source, i) => {
    const item = {
      ...source,
      x: source.x ?? 64,
      y: source.y ?? 640,
      width: source.width ?? 160,
      height: source.height ?? 40,
      kind: source.kind ?? "text",
      text: source.text ?? "",
      asset_id: source.asset_id ?? null,
      fill: source.fill ?? "#FFFFFF",
      opacity: source.opacity ?? 1,
      layer: source.layer ?? "front",
      page_types: source.page_types ?? pageTypes.map((p) => p.value),
      style: source.style ?? {
        font: "Microsoft YaHei",
        size: 32,
        color: "#142B45",
        bold: false,
        align: "left",
      },
    };
    if (item.page_types?.includes(type) && !hidden.includes(item.id))
      (item.layer === "behind" ? behind : front).push(
        masterElement(
          `${prefix}-fixed-${i}`,
          item.kind ?? "text",
          item,
          item.text,
          resolvedStyle(item.style, definition, deck),
          item.asset_id,
          item.fill,
          item.opacity,
        ),
      );
  });
  return {
    ...source,
    background: layout.background ?? "#FAF8F3",
    background_style: null,
    connections: source.connections?.map((edge) => ({
      ...edge,
      layer: (edge.layer ?? 0) + behind.length,
    })),
    elements: [...behind, ...source.elements, ...front],
  };
}
export function templatePreview(
  definition: Definition,
  pageType: PageType = "content",
): Deck {
  return {
    version: 4,
    width: definition.width ?? 1280,
    height: definition.height ?? 720,
    template: { name: "模板预览", template_revision: 0, snapshot: definition },
    chapters: [{ id: "demo", title: "技术实践" }],
    slides: [
      {
        ...newSlide("blank"),
        id: "preview",
        page_type: pageType,
        title: pageType === "toc" ? "目录" : "让每一页，保持一致",
        chapter_id: "demo",
      },
    ],
  };
}
export function tocOverflow(deck: Deck, slide: Slide) {
  const definition = effectiveDefinition(deck);
  return (
    !!definition &&
    slide.page_type === "toc" &&
    chapterEntries(deck).length - (slide.toc_offset ?? 0) >
      (definition.layouts.toc?.toc_capacity ?? 7) &&
    !deck.slides.some(
      (s) =>
        s.page_type === "toc" &&
        s.toc_offset ===
          (slide.toc_offset ?? 0) + (definition.layouts.toc?.toc_capacity ?? 7),
    )
  );
}
