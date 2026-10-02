import { useEffect, useId, useState } from "react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { renderDiagram } from "../diagram";
import { DiagramViewer } from "./DiagramViewer";
import { UML_TEMPLATES } from "./templates";
export function MermaidDiagram({
  source,
  onChange,
  onCopy,
}: {
  source: string;
  onChange?: (source: string) => void;
  onCopy?: () => void;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState(""),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false);
  useEffect(() => {
    let active = true;
    setSvg("");
    setError("");
    const timer = setTimeout(() => {
      void renderDiagram(source, `diagram-${id}-${Date.now()}`)
        .then((v) => {
          if (active) setSvg(v);
        })
        .catch(() => {
          if (active) setError("图表语法有误，请编辑源码");
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [source, id]);
  return (
    <div className="thought-diagram">
      {onChange && (
        <button
          type="button"
          className="btn small"
          onClick={() => setEditing(!editing)}
        >
          {editing ? "收起源码" : "编辑图表"}
        </button>
      )}
      {editing && onChange && (
        <div className="diagram-source">
          <CustomSelect
            ariaLabel="UML 模板"
            value=""
            options={[
              { value: "", label: "选择图表模板" },
              ...UML_TEMPLATES.map((t, i) => ({
                value: String(i),
                label: t.title,
              })),
            ]}
            onChange={(v) => {
              if (v !== "") onChange(UML_TEMPLATES[Number(v)].source);
            }}
          />
          <textarea
            aria-label="Mermaid 源码"
            value={source}
            onChange={(e) => onChange(e.target.value)}
            rows={8}
          />
        </div>
      )}
      {error ? (
        <p role="status">{error}</p>
      ) : svg ? (
        <DiagramViewer
          title="UML / Mermaid 图表"
          svg={async () => svg}
          onCopy={onCopy}
        >
          <div
            className="thought-mermaid-preview"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </DiagramViewer>
      ) : (
        <p role="status">正在绘制图表…</p>
      )}
    </div>
  );
}
