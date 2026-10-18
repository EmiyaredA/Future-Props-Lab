import {
  newElement,
  newId,
} from "../src/features/presentation-workshop/templates";
import { textElement } from "../src/features/presentation-workshop/infographics/semantic";
import type { Fragment } from "../src/features/presentation-workshop/scene/model";

// Editable evidence diagrams reconstructed against the generated three-stage
// visual master. Illustrative mountains are intentionally not synthesized here.
export function nativeOverview(): Fragment {
  const root = newId();
  const title = textElement(
    "PPT Agent 的三次技术选择",
    48,
    30,
    1184,
    90,
    56,
    "#101C3E",
    true,
  );
  const subtitle = textElement(
    "项目演进与核心流程",
    48,
    120,
    1184,
    50,
    25,
    "#697382",
  );
  for (const e of [title, subtitle]) e.paragraphs[0].align = "left";
  const fragment: Fragment = {
    elements: [title, subtitle],
    groups: [
      {
        id: root,
        name: "三阶段总览",
        element_ids: [title.id, subtitle.id],
        parent_id: null,
      },
    ],
    connections: [],
    infographics: [],
  };
  const stages = [
    {
      name: "结构化模板",
      color: "#2877DA",
      detail: "视觉理解与 JSON 填充",
      steps: [
        "模板 PPT",
        "多模态分类与页面 JSON",
        "页面选择与内容生成",
        "格式校验与文字约束",
      ],
    },
    {
      name: "HTML 模板",
      color: "#159E98",
      detail: "设计生图与 HTML 重建",
      steps: [
        "设计生图",
        "HTML 模板重建",
        "模板匹配与文案生成",
        "搜索增强与页面交付",
      ],
    },
    {
      name: "直接生成幻灯片",
      color: "#D35936",
      detail: "资料检索与整页生图",
      steps: [
        "资料检索",
        "语料整理与文案约束",
        "整页视觉生成",
        "探索可编辑重建",
      ],
    },
  ];
  stages.forEach((stage, index) => {
    const x = 48 + index * 408,
      column = newId();
    const headings = [
      textElement(`0${index + 1}`, x, 185, 110, 65, 46, stage.color, true),
      textElement(stage.name, x, 248, 368, 60, 31, "#101C3E", true),
      textElement(stage.detail, x, 305, 368, 40, 21, "#697382"),
    ];
    headings.forEach((e) => (e.paragraphs[0].align = "left"));
    fragment.elements.push(...headings);
    fragment.groups!.push({
      id: column,
      name: stage.name,
      element_ids: headings.map((e) => e.id),
      parent_id: root,
    });
    let previous = "";
    stage.steps.forEach((label, row) => {
      const rectangle = newElement("roundRect", {
        x,
        y: 360 + row * 76,
        width: 352,
        height: 55,
        fill: "#F5F7FA",
        stroke: stage.color,
        stroke_width: 1.5,
      });
      const text = textElement(
        label,
        x + 6,
        rectangle.y + 2,
        340,
        51,
        22,
        "#24344B",
        row === 3,
      );
      fragment.elements.push(rectangle, text);
      fragment.groups!.push({
        id: newId(),
        name: label,
        element_ids: [rectangle.id, text.id],
        parent_id: column,
      });
      if (previous)
        fragment.connections!.push({
          id: newId(),
          source_id: previous,
          target_id: rectangle.id,
          source_anchor: "bottom",
          target_anchor: "top",
          style: "straight",
          arrow: true,
          color: stage.color,
          width: 1.5,
          label: "",
          waypoints: [],
        });
      previous = rectangle.id;
    });
  });
  return fragment;
}

export const doubleLaneSource = `infographic relation-dagre-flow-lr-badge-card
data
  title 内容准备与视觉制作
  nodes
    - id search
      label 资料检索
      group 内容准备
    - id copy
      label 文案整理
      group 内容准备
    - id image
      label 视觉生图
      group 视觉制作
    - id rebuild
      label 原生重建
      group 视觉制作
  relations
    - from search
      to copy
      label 核实
    - from image
      to rebuild
      label 对照
    - from search
      to image
      label 素材
    - from copy
      to rebuild
      label 定稿`;
