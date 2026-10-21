import { useEffect, useRef, useState } from "react";
import {
  X,
  BringToFront,
  ArrowUpToLine,
  ArrowDownToLine,
  SendToBack,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import type { Slide } from "../types";
import type { Connection } from "./model";
import { NumberField } from "../PresentationNumberField";
import { connectionEnd, translateConnection } from "./connectionGeometry";
import { validConnection } from "./connectionEditing";
import { sceneOrder, type OrderMode } from "./stacking";
import "./connection-panel.css";

const sides = [
  { value: "left", label: "左侧" },
  { value: "right", label: "右侧" },
  { value: "top", label: "顶部" },
  { value: "bottom", label: "底部" },
];

export function ConnectionPanel({
  slide,
  value,
  creating,
  onChange,
  onOrder,
  onCreate,
  onRemove,
  onClose,
  onComposition,
  restoreVersion = 0,
}: {
  slide: Slide;
  value: Connection;
  creating: boolean;
  onChange: (patch: Partial<Connection>, group?: string) => void;
  onOrder: (mode: OrderMode) => void;
  onCreate: () => void;
  onRemove: () => void;
  onClose: () => void;
  onComposition?: (active: boolean) => void;
  restoreVersion?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(creating);
  const [widthDraft, setWidthDraft] = useState<string | null>(null);
  const composing = useRef(false);
  useEffect(() => setWidthDraft(null), [restoreVersion]);
  useEffect(
    () => () => {
      if (composing.current) onComposition?.(false);
    },
    [onComposition],
  );
  const order = sceneOrder(slide);
  const index = order.findIndex((item) => item.id === value.id);
  const choices = slide.elements
    .filter((e) => e.kind !== "line")
    .map((e, i) => ({
      value: e.id,
      label:
        e.paragraphs
          .flatMap((p) => p.runs.map((r) => r.text))
          .join("")
          .slice(0, 22) || `${e.kind} ${i + 1}`,
    }));
  const close = () => {
    const canvas = root.current
      ?.closest(".presentation-workspace")
      ?.querySelector<HTMLElement>(".presentation-canvas");
    onClose();
    canvas?.focus();
  };
  return (
    <div
      ref={root}
      className="presentation-connection-panel"
      data-presentation-history={creating ? "local" : "document"}
      role="region"
      aria-label="连接线调节"
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
        if (
          !(event.ctrlKey || event.metaKey) ||
          !["s", "z", "y"].includes(event.key.toLowerCase())
        )
          event.stopPropagation();
      }}
    >
      <header>
        <strong>{creating ? "新建连接" : "连接线"}</strong>
        <button
          type="button"
          className="icon-btn"
          aria-label="关闭连接设置"
          onClick={close}
        >
          <X size={16} />
        </button>
      </header>
      <div className="presentation-connection-body">
        <div
          className="presentation-connection-row"
          role="group"
          aria-label="连接线型"
        >
          {(
            [
              { value: "straight", label: "直线" },
              { value: "step", label: "折线" },
            ] as const
          ).map((option) => (
            <button
              type="button"
              key={option.value}
              aria-pressed={(value.style ?? "step") === option.value}
              onClick={() => onChange({ style: option.value })}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            aria-label="显示箭头"
            aria-pressed={value.arrow !== false}
            onClick={() => onChange({ arrow: value.arrow === false })}
          >
            箭头
          </button>
        </div>
        <div className="presentation-connection-color">
          <span>颜色</span>
          <CustomColorPicker
            ariaLabel="连接颜色"
            value={value.color ?? "#365F62"}
            onChange={(color) => onChange({ color }, "color")}
          />
        </div>
        <button
          type="button"
          className="btn"
          disabled={!value.source_id && !value.target_id}
          onClick={() =>
            onChange(translateConnection(slide, value, { x: 0, y: 0 }))
          }
        >
          脱离节点，自由移动
        </button>
        <p className="muted">
          拖动线身可整体移动，Shift
          限定水平或垂直方向；自由端点会对齐另一端，靠近元素边缘时吸附。
        </p>
        <button
          type="button"
          className="btn"
          disabled={!value.waypoints?.length}
          onClick={() => onChange({ waypoints: [] })}
        >
          重置走线
        </button>
        <label className="presentation-connection-field">
          粗细
          <div className="presentation-connection-width">
            <input
              aria-label="连接粗细滑杆"
              type="range"
              min={0.5}
              max={30}
              step={0.5}
              value={value.width ?? 2}
              onChange={(e) =>
                onChange({ width: Number(e.target.value) }, "width")
              }
            />
            <input
              aria-label="连接粗细"
              type="number"
              min={0.5}
              max={30}
              step={0.5}
              value={widthDraft ?? value.width ?? 2}
              onBlur={() => setWidthDraft(null)}
              onChange={(e) => {
                setWidthDraft(e.target.value);
                const width = e.target.valueAsNumber;
                if (Number.isFinite(width) && width >= 0.5 && width <= 30)
                  onChange({ width }, "width");
              }}
            />
          </div>
        </label>
        <label className="presentation-connection-field">
          关系文字
          <input
            aria-label="连接标签"
            value={value.label ?? ""}
            maxLength={500}
            placeholder="添加关系说明"
            onCompositionStart={() => {
              composing.current = true;
              onComposition?.(true);
            }}
            onCompositionEnd={() => {
              composing.current = false;
              onComposition?.(false);
            }}
            onChange={(e) => onChange({ label: e.target.value }, "label")}
          />
        </label>
        {!creating && (
          <div className="presentation-connection-field">
            <span>层级</span>
            <div
              className="presentation-connection-layers"
              role="group"
              aria-label="连接线层级"
            >
              {(
                [
                  ["front", "置于顶层", BringToFront],
                  ["forward", "上移一层", ArrowUpToLine],
                  ["backward", "下移一层", ArrowDownToLine],
                  ["back", "置于底层", SendToBack],
                ] as const
              ).map(([mode, label, Icon]) => (
                <button
                  type="button"
                  key={mode}
                  disabled={
                    index < 0 ||
                    (mode === "front" || mode === "forward"
                      ? index === order.length - 1
                      : index === 0)
                  }
                  onClick={() => onOrder(mode)}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <button
          type="button"
          className="presentation-connection-disclosure"
          aria-expanded={expanded}
          aria-controls={`connection-ends-${value.id}`}
          onClick={() => setExpanded(!expanded)}
        >
          连接端点 <span aria-hidden="true">{expanded ? "−" : "+"}</span>
        </button>
        {expanded && (
          <div
            id={`connection-ends-${value.id}`}
            className="presentation-connection-ends"
          >
            {(["source", "target"] as const).map((end) => {
              const source = end === "source",
                id = source ? value.source_id : value.target_id;
              const opposite = source ? value.target_id : value.source_id;
              return (
                <div className="presentation-connection-field" key={end}>
                  <span>{source ? "起点" : "终点"}</span>
                  <CustomSelect
                    ariaLabel={source ? "连接起点" : "连接终点"}
                    value={id ?? "free"}
                    options={[
                      { value: "free", label: "自由端点" },
                      ...choices.map((c) => ({
                        ...c,
                        disabled: c.value === opposite,
                      })),
                    ]}
                    onChange={(id) => {
                      const point = connectionEnd(slide, value, end)!;
                      onChange(
                        source
                          ? {
                              source_id: id === "free" ? null : id,
                              source_point: id === "free" ? point : null,
                            }
                          : {
                              target_id: id === "free" ? null : id,
                              target_point: id === "free" ? point : null,
                            },
                      );
                    }}
                  />
                  {!id ? (
                    (["x", "y"] as const).map((axis) => (
                      <NumberField
                        key={axis}
                        label={`${source ? "起点" : "终点"} ${axis.toUpperCase()}`}
                        min={-10000}
                        max={10000}
                        value={connectionEnd(slide, value, end)?.[axis] ?? 0}
                        onChange={(coordinate) =>
                          onChange(
                            {
                              [`${end}_point`]: {
                                ...connectionEnd(slide, value, end)!,
                                [axis]: coordinate,
                              },
                            },
                            `${end}-${axis}`,
                          )
                        }
                      />
                    ))
                  ) : (
                    <>
                      <CustomSelect
                        ariaLabel={source ? "起点端口" : "终点端口"}
                        value={
                          (source
                            ? value.source_anchor
                            : value.target_anchor) ??
                          (source ? "right" : "left")
                        }
                        options={sides}
                        onChange={(v) =>
                          onChange(
                            source
                              ? {
                                  source_anchor:
                                    v as Connection["source_anchor"],
                                }
                              : {
                                  target_anchor:
                                    v as Connection["target_anchor"],
                                },
                          )
                        }
                      />
                      <label>
                        沿边位置（%）
                        <input
                          aria-label={source ? "起点沿边位置" : "终点沿边位置"}
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={
                            Math.round(
                              ((source
                                ? value.source_offset
                                : value.target_offset) ?? 0.5) * 1000,
                            ) / 10
                          }
                          onChange={(event) => {
                            const percent = event.target.valueAsNumber;
                            if (
                              Number.isFinite(percent) &&
                              percent >= 0 &&
                              percent <= 100
                            )
                              onChange(
                                source
                                  ? { source_offset: percent / 100 }
                                  : { target_offset: percent / 100 },
                                `${end}-offset`,
                              );
                          }}
                        />
                      </label>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!validConnection(slide, value) && (
          <p role="alert">请选择有效节点或自由端点坐标</p>
        )}
      </div>
      <footer>
        {creating ? (
          <button
            type="button"
            className="btn primary"
            disabled={!validConnection(slide, value)}
            onClick={onCreate}
          >
            创建连接
          </button>
        ) : (
          <button type="button" className="btn" onClick={onRemove}>
            删除连接
          </button>
        )}
        <span>{creating ? "预览尚未加入文稿" : "修改即时生效"}</span>
      </footer>
    </div>
  );
}
