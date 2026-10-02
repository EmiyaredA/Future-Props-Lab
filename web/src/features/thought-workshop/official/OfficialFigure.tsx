import { useEffect, useState } from "react";
import { MermaidDiagram } from "../diagrams/MermaidDiagram";
import { CanvasSvg } from "../diagrams/CanvasSvg";
import { canvasSvgText } from "../diagrams/export";
import { DiagramViewer } from "../diagrams/DiagramViewer";
import { type CanvasScene } from "../diagrams/model";
import { loadOfficialCanvas } from "./figures";
export type OfficialFigureData =
  { type: "mermaid"; source: string } | { type: "canvas"; scene: CanvasScene };
export function OfficialFigure({
  kind,
  source,
  onCopy,
}: {
  kind: "mermaid" | "canvas";
  source: string;
  onCopy?: (figure: OfficialFigureData) => void;
}) {
  const [scene, setScene] = useState<CanvasScene | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setScene(null);
    setError("");
    if (kind === "canvas")
      void loadOfficialCanvas(source.trim())
        .then((v) => {
          if (active) setScene(v);
        })
        .catch(() => {
          if (active) setError("官方画板资源无法读取");
        });
    return () => {
      active = false;
    };
  }, [source, kind]);
  if (kind === "mermaid")
    return (
      <MermaidDiagram
        source={source}
        onCopy={onCopy ? () => onCopy({ type: "mermaid", source }) : undefined}
      />
    );
  if (error) return <p role="alert">{error}</p>;
  if (!scene) return <p role="status">正在加载信息图…</p>;
  return (
    <DiagramViewer
      title={scene.title}
      svg={() => canvasSvgText(scene)}
      onCopy={onCopy ? () => onCopy({ type: "canvas", scene }) : undefined}
    >
      <CanvasSvg scene={scene} />
    </DiagramViewer>
  );
}
