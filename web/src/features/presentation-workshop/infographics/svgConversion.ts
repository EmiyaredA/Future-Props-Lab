import { slideTheme } from "../slideTheme";
import type { SlideElement } from "../types";
import { newElement, newId } from "../templates";
import { textElement } from "./semantic";
import type { Connection, Fragment } from "../scene/model";

export type Decoration = { elementId: string; svg: string };
export type Conversion = {
  fragment: Fragment;
  decorations: Decoration[];
  notices: string[];
};

const color = (value: string, fallback = "#24344B") => {
  if (/^#[\da-f]{6}$/i.test(value)) return value;
  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return rgb
    ? `#${rgb
        .slice(1)
        .map((v) => Number(v).toString(16).padStart(2, "0"))
        .join("")}`
    : fallback;
};

function referencedDefinitions(svg: SVGSVGElement, node: SVGElement): string {
  const found = new Map<string, SVGElement>();
  const visit = (source: string) => {
    for (const match of source.matchAll(/(?:url\(#|href=["']#)([\w.-]+)/g)) {
      if (found.has(match[1])) continue;
      const definition = [
        ...svg.querySelectorAll<SVGElement>("defs [id]"),
      ].find((e) => e.id === match[1]);
      if (
        !definition ||
        !["linearGradient", "radialGradient", "clipPath", "mask"].includes(
          definition.tagName,
        )
      )
        throw new Error("装饰引用了尚不支持的 SVG 资源，已停止转换");
      const clone = definition.cloneNode(true) as SVGElement;
      for (const item of [clone, ...clone.querySelectorAll("*")])
        for (const attr of [...item.attributes])
          if (attr.name.startsWith("data-") || attr.name === "class")
            item.removeAttribute(attr.name);
      found.set(match[1], clone);
      visit(clone.outerHTML);
    }
  };
  visit(node.outerHTML);
  return [...found.values()].map((d) => d.outerHTML).join("");
}

export function convertSvg(
  svg: SVGSVGElement,
  template: string,
  heading?: { title?: string; desc?: string },
): Conversion {
  const root = svg.getBoundingClientRect();
  if (!root.width || !root.height) throw new Error("信息图尚未完成渲染");
  const top = heading ? (heading.desc ? 240 : 180) : 80;
  const availableHeight = 640 - top;
  const scale = Math.min(1120 / root.width, availableHeight / root.height);
  const dx = (1280 - root.width * scale) / 2,
    dy = top + (availableHeight - root.height * scale) / 2;
  const elements: SlideElement[] = [],
    decorations: Decoration[] = [],
    labels: string[] = [];
  const rootId = newId();
  for (const node of svg.querySelectorAll<SVGGraphicsElement>(
    "rect,circle,ellipse,path,polygon,polyline,line,text,foreignObject",
  )) {
    if (
      node.closest("defs,marker,clipPath,mask") ||
      node.closest('[data-element-type="btns-group"]') ||
      node.dataset.elementType === "background"
    )
      continue;
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const rect = node.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    const box = {
      x: dx + (rect.x - root.x) * scale,
      y: dy + (rect.y - root.y) * scale,
      width: Math.max(1, rect.width * scale),
      height: Math.max(1, rect.height * scale),
    };
    if (node.tagName === "foreignObject" || node.tagName === "text") {
      const text = node.textContent ?? "";
      if (!text.trim()) continue;
      if (text.length > 20000) throw new Error("信息图文字过长，请拆页");
      const span = node.querySelector("span") ?? node;
      const textStyle = getComputedStyle(span);
      const localWidth = Number(node.getAttribute("width")) || rect.width;
      const textScale = (rect.width / localWidth) * scale;
      const size = Math.max(
        6,
        Math.min(240, (parseFloat(textStyle.fontSize) || 18) * textScale),
      );
      const item = textElement(
        text,
        box.x - 8,
        box.y - 8,
        box.width + 16,
        box.height + 16,
        size,
        color(node.tagName === "text" ? style.fill : textStyle.color),
        Number(textStyle.fontWeight) >= 600 || textStyle.fontWeight === "bold",
      );
      const alignment = textStyle.textAlign;
      item.paragraphs[0].align =
        alignment === "left" || alignment === "right" ? alignment : "center";
      elements.push(item);
      if (node.dataset.elementType === "item-label") labels.push(item.id);
      continue;
    }
    const sequencing = template.startsWith("sequence");
    if (
      sequencing &&
      ["path", "polygon", "polyline", "line"].includes(node.tagName)
    )
      continue;
    const simple =
      ["rect", "ellipse", "circle"].includes(node.tagName) &&
      !style.fill.includes("url(") &&
      !style.stroke.includes("url(");
    if (simple) {
      const kind =
        node.tagName === "rect"
          ? Number(node.getAttribute("rx"))
            ? "roundRect"
            : "rect"
          : "ellipse";
      elements.push(
        newElement(kind, {
          ...box,
          fill: color(style.fill, "#FFFFFF"),
          fill_opacity: style.fill === "none" ? 0 : Number(style.fillOpacity),
          stroke: color(style.stroke),
          stroke_width:
            style.stroke === "none"
              ? 0
              : Math.min(30, (parseFloat(style.strokeWidth) || 0) * scale),
          opacity: Number(style.opacity),
          ...(kind === "roundRect" ? { corner_radius: 12 } : {}),
        }),
      );
      continue;
    }
    const matrix = node.getScreenCTM();
    if (!matrix) throw new Error("无法读取信息图的几何变换");
    const clone = node.cloneNode(true) as SVGElement;
    clone.removeAttribute("transform");
    for (const descendant of [clone, ...clone.querySelectorAll("*")]) {
      for (const attribute of [...descendant.attributes])
        if (
          attribute.name.startsWith("data-") ||
          ["class", "style"].includes(attribute.name)
        )
          descendant.removeAttribute(attribute.name);
    }
    for (const key of [
      "fill",
      "stroke",
      "stroke-width",
      "opacity",
      "fill-opacity",
      "stroke-opacity",
    ]) {
      clone.setAttribute(
        key,
        style
          .getPropertyValue(key)
          .replace(/url\([^)]*#([^"')]+)["']?\)/g, "url(#$1)"),
      );
    }
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rect.width || 1} ${rect.height || 1}"><defs>${referencedDefinitions(svg, clone)}</defs><g transform="matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e - rect.x} ${matrix.f - rect.y})">${clone.outerHTML}</g></svg>`;
    const item = newElement("vector", { ...box, asset_id: newId() });
    elements.push(item);
    decorations.push({ elementId: item.id, svg: source });
  }
  if (heading?.title) {
    const title = textElement(
      heading.title,
      72,
      48,
      1120,
      100,
      44,
      slideTheme.navy,
      true,
    );
    title.paragraphs[0].align = "left";
    elements.push(title);
  }
  if (heading?.desc) {
    const desc = textElement(
      heading.desc,
      72,
      146,
      1120,
      75,
      24,
      slideTheme.muted,
    );
    desc.paragraphs[0].align = "left";
    elements.push(desc);
  }
  if (!elements.length || elements.length > 200)
    throw new Error("转换结果为空或超过每页 200 个元素，请拆页");
  const allText = [...svg.querySelectorAll("foreignObject,text")]
    .filter(
      (n) =>
        !n.closest("defs,marker") &&
        getComputedStyle(n).visibility !== "hidden",
    )
    .map((n) => n.textContent?.trim())
    .filter(Boolean);
  for (const text of allText)
    if (
      !elements.some((e) =>
        e.paragraphs.some((p) => p.runs.some((r) => r.text.trim() === text)),
      )
    )
      throw new Error("存在未能转换的关键文字，已停止应用");
  const connections: Connection[] = template.startsWith("sequence")
    ? labels.slice(1).map((id, index) => ({
        id: newId(),
        source_id: labels[index],
        target_id: id,
        source_anchor: "right",
        target_anchor: "left",
        label: "",
        style: "straight",
        arrow: true,
        color: slideTheme.teal,
        width: 1.5,
        layer: 0,
        waypoints: [],
      }))
    : [];
  return {
    fragment: {
      elements,
      groups: [
        {
          id: rootId,
          name: "信息图",
          element_ids: elements.map((e) => e.id),
          parent_id: null,
        },
      ],
      connections,
      infographics: [],
    },
    decorations,
    notices: decorations.length
      ? [`${decorations.length} 个复杂装饰保留为独立 SVG，文字与基础图形可编辑`]
      : ["文字与基础图形已转换为原生元素"],
  };
}
