import { describe, expect, it, vi } from "vitest";
import type { ElkNode } from "elkjs/lib/elk-api";

// jsdom has no browser Worker. Exercise the identical bundled ELK algorithm;
// the browser journey separately verifies the actual worker transport.
vi.mock("@features/presentation-workshop/infographics/elkLayout", () => ({
  layoutGraph: async (graph: ElkNode) => {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
    return new ELK().layout(graph);
  },
}));
import {
  newElement,
  newId,
  newSlide,
  copySlide,
} from "@features/presentation-workshop/templates";
import {
  appendFragment,
  cleanScene,
  cloneFragment,
  connectionPoints,
  groupSelection,
  members,
  selectionIds,
  ungroup,
  updateScene,
} from "@features/presentation-workshop/scene/model";
import { validateFragment } from "@features/presentation-workshop/infographics/validation";
import {
  exampleSource,
  infographicTemplates,
} from "@features/presentation-workshop/infographics/catalog";
import type { Connection } from "@features/presentation-workshop/scene/model";
import { semanticDiagram } from "@features/presentation-workshop/infographics/semantic";

function fixture() {
  const slide = newSlide();
  slide.elements = [
    newElement("rect", { id: "a", x: 20, y: 100 }),
    newElement("rect", { id: "b", x: 700, y: 100 }),
    newElement("text", { id: "label" }),
  ];
  slide.groups = [
    { id: "root", name: "图", element_ids: ["b"], parent_id: null },
    {
      id: "child",
      name: "节点",
      element_ids: ["a", "label"],
      parent_id: "root",
    },
  ];
  slide.connections = [
    {
      id: "edge",
      source_id: "a",
      target_id: "b",
      source_anchor: "right",
      target_anchor: "left",
      label: "",
      style: "step",
      waypoints: [{ x: 500, y: 100 }],
      color: "#123456",
      width: 2,
      arrow: true,
    },
  ];
  slide.infographics = [
    {
      id: "origin",
      group_id: "root",
      format: "antv",
      template: "sequence-steps-simple",
      source: "source",
    },
  ];
  return slide;
}

describe("信息图场景编辑", () => {
  it("组外选择整组，进入分组后可选择内部节点", () => {
    const s = fixture();
    expect(selectionIds(s, "a")).toEqual(["b", "a", "label"]);
    expect(selectionIds(s, "a", "root")).toEqual(["a", "label"]);
    expect(selectionIds(s, "a", "child")).toEqual(["a"]);
  });
  it("页面和片段复制重映射分组、连接及来源，位置偏移可控", () => {
    const s = fixture(),
      copied = copySlide(s);
    expect(copied.elements[0].x).toBe(s.elements[0].x);
    const f = cloneFragment(
      s,
      s.elements.map((e) => e.id),
      newId,
    );
    expect(f.elements[0].x).toBe(44);
    expect(f.connections![0].source_id).toBe(f.elements[0].id);
    expect(f.infographics![0].group_id).toBe(f.groups![0].id);
    expect(appendFragment(s, f).elements).toHaveLength(6);
    validateFragment(f);
  });
  it("删除节点清理关联边，移动节点丢弃过时的布局路径", () => {
    const s = fixture();
    const moved = updateScene(s, {
      ...s,
      elements: s.elements.map((e) => (e.id === "a" ? { ...e, x: 55 } : e)),
    });
    expect(moved.connections![0].waypoints).toEqual([]);
    const deleted = cleanScene({
      ...s,
      elements: s.elements.filter((e) => e.id !== "a"),
    });
    expect(deleted.connections).toEqual([]);
    expect(members(deleted, "root")).toEqual(["b", "label"]);
  });
  it("编组解组不丢元素，锁定成员不被编组", () => {
    const s = newSlide();
    s.elements = [newElement("rect"), newElement("text")];
    const grouped = groupSelection(
      s,
      s.elements.map((e) => e.id),
      "group",
      null,
    );
    expect(members(grouped, "group")).toHaveLength(2);
    expect(ungroup(grouped, "group").elements).toEqual(s.elements);
    s.elements[0].locked = true;
    expect(
      groupSelection(
        s,
        s.elements.map((e) => e.id),
        "locked-group",
        null,
      ),
    ).toBe(s);
  });
  it("组内再次编组转移直接成员归属，解组还原父级", () => {
    const s = fixture();
    const grouped = groupSelection(s, ["a", "label"], "nested", "child");
    expect(grouped.groups!.find((g) => g.id === "child")!.element_ids).toEqual(
      [],
    );
    expect(grouped.groups!.find((g) => g.id === "nested")!.parent_id).toBe(
      "child",
    );
    expect(members(ungroup(grouped, "nested"), "child")).toEqual([
      "a",
      "label",
    ]);
    expect(groupSelection(s, ["a", "b"], "partial", null)).toBe(s);
  });
  it("ELK 保留双分组、分支和正交端口，锁定组内文字阻止布局", async () => {
    const f = await semanticDiagram("relation-dagre-flow-lr-badge-card", {
      title: "双泳道",
      nodes: [
        { id: "a", label: "资料检索", group: "内容" },
        { id: "b", label: "文案整理", group: "内容" },
        { id: "c", label: "视觉生成", group: "制作" },
        { id: "d", label: "原生重建", group: "制作" },
      ],
      relations: [
        { from: "a", to: "b" },
        { from: "c", to: "d" },
        { from: "a", to: "c" },
        { from: "b", to: "d" },
      ],
    });
    validateFragment(f);
    expect(
      f.groups!.filter((g) => ["内容", "制作"].includes(g.name!)),
    ).toHaveLength(2);
    expect(f.connections).toHaveLength(4);
    expect(
      f.elements.every(
        (e) =>
          e.x >= 0 &&
          e.x + e.width <= 1280 &&
          e.y >= 0 &&
          e.y + e.height <= 720,
      ),
    ).toBe(true);
    const s = { ...newSlide(), ...f };
    const { layoutScene } =
      await import("@features/presentation-workshop/infographics/layout");
    s.elements.find(
      (e) => e.kind === "text" && e.paragraphs[0].runs[0].text === "资料检索",
    )!.locked = true;
    await expect(layoutScene(s)).rejects.toThrow("解锁");
  });
  it("连接使用节点边缘及旋转后的端口", () => {
    const s = fixture();
    s.connections![0].waypoints = [];
    const points = connectionPoints(s, s.connections![0] as Connection);
    expect(points[0]).toEqual({ x: 280, y: 190 });
    s.elements[0].rotation = 90;
    expect(connectionPoints(s, s.connections![0])[0].x).toBeCloseTo(150);
  });
  it("五类模板都有独立数据示例，非法原生片段被拒绝", () => {
    expect(infographicTemplates).toHaveLength(5);
    for (const t of infographicTemplates)
      expect(exampleSource(t.value)).toContain(t.value);
    expect(() =>
      validateFragment({
        elements: [],
        groups: [],
        connections: [],
        infographics: [],
      }),
    ).toThrow();
  });
});
