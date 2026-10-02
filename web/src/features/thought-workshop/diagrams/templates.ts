import { emptyScene, type CanvasElement, type CanvasScene } from "./model";
export const UML_TEMPLATES = [
  {
    title: "流程图",
    source:
      "flowchart LR\n  A[输入] --> B{校验通过?}\n  B -->|是| C[处理]\n  B -->|否| D[反馈错误]",
  },
  {
    title: "时序图",
    source:
      "sequenceDiagram\n  participant U as 用户\n  participant A as 应用\n  participant D as 数据库\n  U->>A: 提交修改\n  A->>D: 校验版本并保存\n  D-->>A: 新版本\n  A-->>U: 已保存",
  },
  {
    title: "类图",
    source:
      'classDiagram\n  class Project {\n    +String id\n    +String title\n    +save()\n  }\n  class Document {\n    +String content\n  }\n  Project "1" *-- "many" Document : 包含',
  },
  {
    title: "状态图",
    source:
      "stateDiagram-v2\n  [*] --> 草稿\n  草稿 --> 保存中: 保存\n  保存中 --> 已保存: 成功\n  保存中 --> 失败: 错误\n  失败 --> 保存中: 用户重试",
  },
  {
    title: "ER 图",
    source:
      "erDiagram\n  WORKSPACE ||--o{ PROJECT : owns\n  PROJECT ||--o{ DOCUMENT : contains\n  DOCUMENT {\n    string id PK\n    int revision\n  }",
  },
];
export function newElement(
  kind: CanvasElement["kind"],
  x = 80,
  y = 80,
): CanvasElement {
  return {
    id: crypto.randomUUID(),
    kind,
    x,
    y,
    width: kind === "frame" ? 560 : 180,
    height: kind === "frame" ? 300 : 90,
    text: kind === "frame" ? "分区" : "在属性面板中编辑",
    fill: "#eef5f3",
    stroke: "#365f62",
    ...(kind === "icon" ? { icon: "server" as const } : {}),
  };
}
export const BOARD_TEMPLATES = [
  "空白画板",
  "系统架构",
  "请求流程",
  "分层结构",
  "数据流",
  "对比说明",
];
export function canvasTemplate(index: number): CanvasScene {
  if (index === 0) return emptyScene();
  const titles = [
    ["客户端", "服务层", "数据库"],
    ["输入", "校验", "处理", "输出"],
    ["界面", "业务", "存储"],
    ["采集", "变换", "消费"],
    ["方案 A", "方案 B"],
  ][index - 1];
  const elements = titles.map((text, i) => ({
    ...newElement(
      index === 1 ? "icon" : "rounded",
      index === 3 ? 100 : 40 + i * 240,
      index === 3 ? 40 + i * 150 : 70,
    ),
    text,
    ...(index === 1
      ? { icon: (["user", "server", "database"] as const)[i] }
      : {}),
  }));
  return {
    sceneVersion: 1,
    title: BOARD_TEMPLATES[index],
    elements,
    edges:
      index === 5
        ? []
        : elements.slice(1).map((e, i) => ({
            id: crypto.randomUUID(),
            source: elements[i].id,
            target: e.id,
            label: "",
            arrow: true,
            style: "step",
          })),
  };
}
