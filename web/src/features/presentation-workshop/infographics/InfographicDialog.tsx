import { slideTheme } from "../slideTheme";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import type { Fragment, Infographic } from "../scene/model";
import { SlideSurface } from "../SlideSurface";
import { newId } from "../templates";
import { exampleSource, infographicTemplates } from "./catalog";
import { compileInfographic, materialize } from "./compiler";
import type { Conversion } from "./svgConversion";

export default function InfographicDialog({
  info,
  onClose,
  onApply,
}: {
  info?: Infographic;
  onClose: () => void;
  onApply: (fragment: Fragment) => void;
}) {
  const engineHost = useRef<HTMLDivElement>(null);
  const [template, setTemplate] = useState(
    info?.template || infographicTemplates[0].value,
  );
  const [format, setFormat] = useState<"antv" | "scene">(
    info?.format ?? "antv",
  );
  const [source, setSource] = useState(info?.source ?? exampleSource(template));
  const [result, setResult] = useState<Conversion | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const root = useDrawerFocus<HTMLDivElement>(
    () => {
      if (!busy) onClose();
    },
    true,
    false,
  );
  const generation = useRef(0);
  const change = (text: string) => {
    generation.current++;
    setSource(text);
    setResult(null);
    setError("");
  };
  const preview = async () => {
    if (!engineHost.current) return;
    const revision = ++generation.current;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const next = await compileInfographic(source, format, engineHost.current);
      if (revision === generation.current) setResult(next);
    } catch (e) {
      if (revision === generation.current)
        setError(e instanceof Error ? e.message : "转换失败");
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      onApply(await materialize(result));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "应用失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="presentation-modal-backdrop">
      <div
        ref={root}
        className="presentation-scene-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="插入与编辑信息图"
      >
        <header>
          <h3>{info ? "更新信息图" : "插入信息图"}</h3>
          <button
            className="icon-btn"
            aria-label="关闭信息图"
            onClick={onClose}
            disabled={busy}
          >
            <X size={20} />
          </button>
        </header>
        <div className="presentation-scene-fields">
          <CustomSelect
            ariaLabel="信息图输入格式"
            value={format}
            options={[
              { value: "antv", label: "AntV 信息图语法" },
              { value: "scene", label: "工坊场景 JSON" },
            ]}
            disabled={busy}
            onChange={(value) => {
              setFormat(value as "antv" | "scene");
              change(
                value === "antv"
                  ? exampleSource(template)
                  : '{"elements": [], "groups": [], "connections": [], "infographics": []}',
              );
            }}
          />
          {format === "antv" && (
            <CustomSelect
              ariaLabel="信息图模板"
              value={template}
              options={infographicTemplates}
              disabled={busy}
              onChange={(value) => {
                setTemplate(value);
                change(exampleSource(value));
              }}
            />
          )}
        </div>
        <label>
          模板数据与源码
          <textarea
            aria-label="信息图源码"
            value={source}
            maxLength={50000}
            disabled={busy}
            onChange={(e) => change(e.target.value)}
            spellCheck={false}
          />
        </label>
        {info && (
          <p>
            应用更新会替换这一信息图中的对象及其手动调整，其他页面内容不受影响。可撤销恢复。
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {result && (
          <>
            <div className="presentation-scene-preview">
              <SlideSurface
                slide={{
                  id: newId(),
                  background: slideTheme.background,
                  notes: "",
                  ...result.fragment,
                  elements: result.fragment.elements.filter(
                    (e) =>
                      !result.decorations.some((d) => d.elementId === e.id),
                  ),
                }}
              />
              {result.decorations.map((d) => {
                const e = result.fragment.elements.find(
                  (v) => v.id === d.elementId,
                )!;
                return (
                  <img
                    key={d.elementId}
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`}
                    alt="保留为矢量的装饰"
                    style={{
                      left: `${e.x / 12.8}%`,
                      top: `${e.y / 7.2}%`,
                      width: `${e.width / 12.8}%`,
                      height: `${e.height / 7.2}%`,
                    }}
                  />
                );
              })}
            </div>
            <p role="status">
              {result.fragment.elements.length} 个原生元素，
              {result.fragment.connections?.length ?? 0} 条连接。
              {result.notices.join("；")}
            </p>
          </>
        )}
        <footer>
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="btn"
            onClick={() => void preview()}
            disabled={busy}
          >
            {busy ? "正在处理…" : "预览转换结果"}
          </button>
          <button
            className="btn primary"
            onClick={() => void apply()}
            disabled={busy || !result}
          >
            应用{info ? "更新" : "到当前页"}
          </button>
        </footer>
        <div
          ref={engineHost}
          className="presentation-infographic-measure"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
