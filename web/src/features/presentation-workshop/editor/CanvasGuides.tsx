import type { PageSize } from "../types";

export function CanvasGuides({
  size,
  scale,
  grid,
  rulers,
}: {
  size: PageSize;
  scale: number;
  grid: boolean;
  rulers: boolean;
}) {
  return (
    <>
      {grid && (
        <div
          className="presentation-grid"
          aria-hidden="true"
          style={{
            backgroundSize: "20px 20px",
            backgroundImage:
              "radial-gradient(circle, #60708088 1px, transparent 1px)",
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      )}
      {rulers && (
        <svg
          aria-label="页面标尺"
          className="presentation-rulers"
          width={size.width}
          height={size.height}
          style={{
            position: "absolute",
            inset: 0,
            overflow: "visible",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          {Array.from({ length: Math.floor(size.width / 100) + 1 }, (_, i) => (
            <g key={`x${i}`} transform={`translate(${i * 100} 0)`}>
              <path
                d={`M0 ${-14 / scale}V0`}
                stroke="var(--muted)"
                strokeWidth={1 / scale}
              />
              <text
                x={3 / scale}
                y={-5 / scale}
                fontSize={10 / scale}
                fill="var(--muted)"
              >
                {i * 100}
              </text>
            </g>
          ))}
          {Array.from({ length: Math.floor(size.height / 100) + 1 }, (_, i) => (
            <g key={`y${i}`} transform={`translate(0 ${i * 100})`}>
              <path
                d={`M${-14 / scale} 0H0`}
                stroke="var(--muted)"
                strokeWidth={1 / scale}
              />
              <text
                x={-5 / scale}
                y={12 / scale}
                textAnchor="end"
                fontSize={10 / scale}
                fill="var(--muted)"
              >
                {i * 100}
              </text>
            </g>
          ))}
        </svg>
      )}
    </>
  );
}
