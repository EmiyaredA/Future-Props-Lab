import { slideTheme } from "../slideTheme";
import { defaultRun, newElement, newId } from "../templates";
import type { Fragment, Connection, Group } from "../scene/model";
import type { SlideElement } from "../types";
import { layoutScene } from "./layout";

type Datum = {
  id?: string;
  label?: string;
  desc?: string;
  group?: string;
  children?: Datum[];
};
export type DiagramData = {
  title?: string;
  desc?: string;
  nodes?: Datum[];
  relations?: {
    from: string;
    to: string;
    label?: string;
    direction?: string;
    showArrow?: boolean;
  }[];
  root?: Datum;
};

export function textElement(
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  size = 24,
  color: string = slideTheme.navy,
  bold = false,
): SlideElement {
  return newElement("text", {
    x,
    y,
    width,
    height,
    fill_opacity: 0,
    paragraphs: [
      {
        align: "center",
        line_height: 1.3,
        bullet: false,
        numbered: false,
        runs: [{ ...defaultRun(text), size, color, bold }],
      },
    ],
  });
}

export async function semanticDiagram(
  template: string,
  data: DiagramData,
): Promise<Fragment> {
  const nodes: Datum[] = [],
    links: {
      from: string;
      to: string;
      label?: string;
      direction?: string;
      showArrow?: boolean;
    }[] = [];
  const flatten = (datum: Datum, parent?: string) => {
    const id = datum.id ?? `node-${nodes.length}`;
    nodes.push({ ...datum, id });
    if (parent) links.push({ from: parent, to: id });
    for (const child of datum.children ?? []) flatten(child, id);
  };
  if (template === "hierarchy-structure") {
    if (!data.root) throw new Error("层级图需要 data.root");
    flatten(data.root);
  } else {
    nodes.push(...(data.nodes ?? []));
    links.push(...(data.relations ?? []));
  }
  if (!nodes.length || nodes.length > 30)
    throw new Error("关系图需要 1–30 个节点，复杂内容请拆页");
  const keys = nodes.map((n) => n.id ?? n.label ?? "");
  if (keys.some((id) => !id) || new Set(keys).size !== keys.length)
    throw new Error("节点 ID 不能为空或重复");
  const root = newId(),
    ids = new Map(keys.map((id) => [id, newId()]));
  const elements: SlideElement[] = [],
    groups: Group[] = [];
  const groupMap = new Map<string, string>();
  nodes.forEach((node, index) => {
    const rectangle = newElement("roundRect", {
      id: ids.get(keys[index])!,
      x: 80 + index * 220,
      y: 260,
      width: 190,
      height: node.desc ? 135 : 90,
      fill: slideTheme.fill,
      stroke: slideTheme.border,
      stroke_width: 1.5,
    });
    const label = textElement(
      node.label ?? keys[index],
      rectangle.x + 8,
      rectangle.y + 12,
      174,
      65,
      24,
      slideTheme.navy,
      true,
    );
    elements.push(rectangle, label);
    const itemIds = [rectangle.id, label.id];
    if (node.desc) {
      const description = textElement(
        node.desc,
        rectangle.x + 8,
        rectangle.y + 72,
        174,
        55,
        17,
      );
      elements.push(description);
      itemIds.push(description.id);
    }
    let parent: string = root;
    if (node.group) {
      if (!groupMap.has(node.group)) {
        const id = newId();
        groupMap.set(node.group, id);
        groups.push({ id, name: node.group, parent_id: root, element_ids: [] });
      }
      parent = groupMap.get(node.group)!;
    }
    groups.push({
      id: newId(),
      name: node.label ?? keys[index],
      parent_id: parent,
      element_ids: itemIds,
    });
  });
  const connections: Connection[] = links.flatMap((link) => {
    if (!ids.has(link.from) || !ids.has(link.to) || link.from === link.to)
      throw new Error("关系引用了缺失节点或节点自身");
    const edge: Connection = {
      id: newId(),
      source_id: ids.get(link.from)!,
      target_id: ids.get(link.to)!,
      source_anchor: "right",
      target_anchor: "left",
      label: link.label ?? "",
      style: "step",
      arrow: link.showArrow !== false && link.direction !== "none",
      color: slideTheme.teal,
      width: 1.5,
      layer: 0,
      waypoints: [],
    };
    return link.direction === "both"
      ? [
          edge,
          {
            ...edge,
            id: newId(),
            source_id: edge.target_id,
            target_id: edge.source_id,
          },
        ]
      : [edge];
  });
  const title = textElement(
    data.title ?? "信息图",
    80,
    45,
    1120,
    85,
    44,
    slideTheme.navy,
    true,
  );
  title.paragraphs[0].align = "left";
  elements.push(title);
  groups.push({
    id: root,
    name: data.title ?? "信息图",
    element_ids: [title.id],
    parent_id: null,
  });
  const slide = {
    id: newId(),
    background: slideTheme.background,
    notes: "",
    elements,
    groups,
    connections,
    infographics: [],
    reference: null,
  };
  const laid = connections.length ? await layoutScene(slide, root) : slide;
  return {
    elements: laid.elements,
    groups: laid.groups,
    connections: laid.connections,
    infographics: [],
  };
}
