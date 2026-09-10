import type { SlideElement } from "./types";
type Kind = SlideElement["kind"];
export const shapeCatalog: {
  category: string;
  label: string;
  kind: Kind;
  patch?: Partial<SlideElement>;
}[] = [
  ...(
    [
      ["rect", "矩形"],
      ["roundRect", "圆角矩形"],
      ["ellipse", "椭圆"],
      ["triangle", "三角形"],
      ["rightTriangle", "直角三角形"],
      ["diamond", "菱形"],
      ["pentagon", "五边形"],
      ["hexagon", "六边形"],
      ["star", "星形"],
      ["parallelogram", "平行四边形"],
      ["trapezoid", "梯形"],
    ] as [Kind, string][]
  ).map(([kind, label]) => ({ category: "基础", kind, label })),
  ...(
    [
      ["none", "直线"],
      ["open", "开放箭头"],
      ["triangle", "三角箭头"],
      ["circle", "圆点连线"],
    ] as const
  ).map(([end_arrow, label]) => ({
    category: "线条",
    kind: "line" as const,
    label,
    patch: { end_arrow },
  })),
  {
    category: "线条",
    kind: "line",
    label: "双向连线",
    patch: { start_arrow: "triangle", end_arrow: "triangle" },
  },
  ...(
    [
      ["arrow", "向右箭头"],
      ["leftArrow", "向左箭头"],
      ["upArrow", "向上箭头"],
      ["downArrow", "向下箭头"],
      ["doubleArrow", "双向箭头"],
    ] as [Kind, string][]
  ).map(([kind, label]) => ({ category: "箭头", kind, label })),
  ...(
    [
      ["callout", "矩形标注"],
      ["roundCallout", "圆角标注"],
      ["ellipseCallout", "椭圆标注"],
    ] as [Kind, string][]
  ).map(([kind, label]) => ({ category: "标注", kind, label })),
];
export function polygonFor(kind: Kind, w: number, h: number): string | null {
  let points: number[][] | null = null;
  if (kind === "rightTriangle")
    points = [
      [0, 0],
      [w, h],
      [0, h],
    ];
  if (kind === "parallelogram")
    points = [
      [w * 0.25, 0],
      [w, 0],
      [w * 0.75, h],
      [0, h],
    ];
  if (kind === "trapezoid")
    points = [
      [w * 0.2, 0],
      [w * 0.8, 0],
      [w, h],
      [0, h],
    ];
  if (kind === "pentagon" || kind === "hexagon" || kind === "star") {
    const count = kind === "star" ? 10 : kind === "pentagon" ? 5 : 6;
    points = Array.from({ length: count }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
      const r = kind === "star" && i % 2 ? 0.42 : 1;
      return [
        w / 2 + ((Math.cos(a) * w) / 2) * r,
        h / 2 + ((Math.sin(a) * h) / 2) * r,
      ];
    });
  }
  const arrow = [
    [0, 0.25],
    [0.65, 0.25],
    [0.65, 0],
    [1, 0.5],
    [0.65, 1],
    [0.65, 0.75],
    [0, 0.75],
  ];
  if (["leftArrow", "upArrow", "downArrow"].includes(kind))
    points = arrow.map(([x, y]) =>
      kind === "leftArrow"
        ? [(1 - x) * w, y * h]
        : kind === "upArrow"
          ? [y * w, (1 - x) * h]
          : [(1 - y) * w, x * h],
    );
  if (kind === "doubleArrow")
    points = [
      [0, 0.5],
      [0.25, 0],
      [0.25, 0.25],
      [0.75, 0.25],
      [0.75, 0],
      [1, 0.5],
      [0.75, 1],
      [0.75, 0.75],
      [0.25, 0.75],
      [0.25, 1],
    ].map(([x, y]) => [x * w, y * h]);
  if (kind === "callout")
    points = [
      [0, 0],
      [w, 0],
      [w, h * 0.75],
      [w * 0.4, h * 0.75],
      [w * 0.18, h],
      [w * 0.22, h * 0.75],
      [0, h * 0.75],
    ];
  if (kind === "roundCallout") {
    const r = Math.min(16, w / 4, h / 4);
    points = [];
    for (const [cx, cy, start] of [
      [w - r, r, -90],
      [w - r, h * 0.75 - r, 0],
      [r, h * 0.75 - r, 90],
      [r, r, 180],
    ]) {
      for (let i = 0; i <= 8; i++) {
        const a = ((start + (i * 90) / 8) * Math.PI) / 180;
        points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      if (start === 0)
        points.push([w * 0.4, h * 0.75], [w * 0.18, h], [w * 0.22, h * 0.75]);
    }
  }
  if (kind === "ellipseCallout") {
    points = Array.from({ length: 65 }, (_, i) => {
      const a = ((120 + (i * 330) / 64) * Math.PI) / 180;
      return [w / 2 + (Math.cos(a) * w) / 2, h * 0.38 + Math.sin(a) * h * 0.38];
    });
    points.push([w * 0.15, h]);
  }
  return points?.map((p) => p.join(",")).join(" ") ?? null;
}
