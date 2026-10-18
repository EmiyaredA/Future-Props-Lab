export const infographicTemplates = [
  { value: "sequence-steps-simple", label: "步骤" },
  { value: "sequence-timeline-simple", label: "时间线" },
  { value: "compare-binary-horizontal-simple-fold", label: "对比" },
  { value: "hierarchy-structure", label: "层级" },
  { value: "relation-dagre-flow-lr-badge-card", label: "关系图" },
];

export function exampleSource(template: string) {
  if (template === "hierarchy-structure")
    return `infographic ${template}\ndata\n  title PPT Agent\n  root\n    label 生成流程\n    children\n      - label 内容准备\n        children\n          - label 资料检索\n          - label 文案整理\n      - label 页面制作\n        children\n          - label 视觉生图\n          - label 可编辑重建`;
  if (template.startsWith("relation"))
    return `infographic ${template}\ndata\n  title 页面重建流程\n  nodes\n    - id research\n      label 资料整理\n    - id visual\n      label 视觉生图\n    - id rebuild\n      label 原生重建\n  relations\n    - from research\n      to visual\n    - from visual\n      to rebuild`;
  if (template.startsWith("compare"))
    return `infographic ${template}\ndata\n  title 模板生成与整页生图\n  compares\n    - id template\n      children\n        - label 结构化模板\n          desc 视觉理解与 JSON 填充\n        - label 可控性\n          desc 版式复用与格式约束\n    - id image\n      children\n        - label 整页生图\n          desc 文案整理与视觉生成\n        - label 表现力\n          desc 丰富的构图与插画`;
  return `infographic ${template}\ndata\n  title PPT Agent 的技术演进\n  sequences\n    - label 结构化模板\n      desc 视觉理解与 JSON 填充\n    - label HTML 模板\n      desc 设计生图与 HTML 重建\n    - label 整页生图\n      desc 文案整理与原生重建`;
}
