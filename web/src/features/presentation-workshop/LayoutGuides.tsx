import type { LayoutGuide } from "./layoutSnapping";
import "./layout-guides.css";

export function LayoutGuides({
  guides,
  scale,
}: {
  guides: LayoutGuide[];
  scale: number;
}) {
  return (
    <svg
      className="presentation-layout-guides"
      width="100%"
      height="100%"
      aria-hidden="true"
    >
      {guides.map((g, i) => (
        <g key={i} data-guide-kind={g.kind}>
          <line
            x1={g.x1}
            y1={g.y1}
            x2={g.x2}
            y2={g.y2}
            strokeWidth={1 / scale}
            strokeDasharray={
              g.kind === "align" ? `${4 / scale} ${3 / scale}` : undefined
            }
          />
          {g.label && (
            <g
              transform={`translate(${(g.x1 + g.x2) / 2} ${(g.y1 + g.y2) / 2}) scale(${1 / scale})`}
            >
              <rect
                x={-g.label.length * 3.5 - 5}
                y={-11}
                width={g.label.length * 7 + 10}
                height={20}
                rx={4}
              />
              <text textAnchor="middle" dominantBaseline="central" y={-1}>
                {g.label}
              </text>
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}
