import { useEffect, useRef, useState } from "react";
import { ChevronDown, Shapes, Search, Upload, X } from "lucide-react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";
import { shapeCatalog } from "./shapeCatalog";
import { iconCatalog, iconSource } from "./iconCatalog";
import { PresentationShape } from "./PresentationShape";
import { newElement } from "./templates";
import type { SlideElement } from "./types";
import "./presentation-media.css";

export function PresentationShapePicker({
  onShape,
  onIcon,
  onSvg,
}: {
  onShape: (kind: SlideElement["kind"], patch?: Partial<SlideElement>) => void;
  onIcon: (svg: string, name: string) => void;
  onSvg: () => void;
}) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState("形状"),
    [category, setCategory] = useState("基础"),
    [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  useSelectPopover(open, trigger, menu, 480, 520, "start");
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (e: MouseEvent) => {
      if (
        !menu.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  const categories =
    tab === "形状"
      ? ["基础", "线条", "箭头", "标注"]
      : ["常用", "文件", "商务", "科技", "人物"];
  return (
    <>
      <button
        className="btn"
        ref={trigger}
        aria-label="插入图形"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Shapes size={18} />
        <span>形状</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          ref={menu}
          popover="manual"
          role="dialog"
          aria-label="形状与图标"
          className="presentation-shape-picker"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
            if (
              e.target instanceof HTMLButtonElement &&
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
              ].includes(e.key)
            ) {
              e.preventDefault();
              const nodes = Array.from(
                menu.current!.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              const i = nodes.indexOf(e.target);
              nodes[
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? nodes.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          nodes.length - 1,
                          i +
                            ({
                              ArrowLeft: -1,
                              ArrowRight: 1,
                              ArrowUp: -5,
                              ArrowDown: 5,
                            }[e.key] ?? 0),
                        ),
                      )
              ]?.focus();
            }
          }}
        >
          <header>
            <div role="tablist" aria-label="图形类型">
              {["形状", "图标"].map((value) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => {
                    setTab(value);
                    setCategory(value === "形状" ? "基础" : "常用");
                    setQuery("");
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
            <button
              className="icon-btn"
              aria-label="关闭图形面板"
              onClick={close}
            >
              <X size={16} />
            </button>
          </header>
          {tab === "图标" && (
            <label className="presentation-media-search">
              <Search size={16} />
              <input
                aria-label="搜索图标"
                placeholder="搜索图标名称…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
          <div className="presentation-shape-browser">
            <nav aria-label="图形分类">
              {categories.map((c) => (
                <button
                  key={c}
                  aria-pressed={category === c && !query}
                  onClick={() => {
                    setCategory(c);
                    setQuery("");
                  }}
                >
                  {c}
                </button>
              ))}
            </nav>
            <div className="presentation-shape-grid">
              {tab === "形状"
                ? shapeCatalog
                    .filter((s) => s.category === category)
                    .map((s) => (
                      <button
                        key={s.label}
                        title={s.label}
                        aria-label={s.label}
                        onClick={() => {
                          onShape(s.kind, s.patch);
                          close();
                        }}
                      >
                        <PresentationShape
                          element={newElement(s.kind, {
                            width: 48,
                            height: s.kind === "line" ? 1 : 40,
                            fill: "#FFFFFF",
                            fill_opacity: 0,
                            stroke: "#626873",
                            stroke_width: 2,
                            ...s.patch,
                          })}
                        />
                        <span>{s.label}</span>
                      </button>
                    ))
                : iconCatalog
                    .filter(([c, label]) =>
                      query
                        ? label.toLowerCase().includes(query.toLowerCase())
                        : c === category,
                    )
                    .map(([, label, Icon]) => (
                      <button
                        key={label}
                        title={label}
                        aria-label={`插入图标 ${label}`}
                        onClick={(e) => {
                          onIcon(
                            iconSource(e.currentTarget.querySelector("svg")!),
                            label.split(" ")[0],
                          );
                          close();
                        }}
                      >
                        <Icon size={30} />
                        <span>{label.split(" ")[0]}</span>
                      </button>
                    ))}
              {tab === "图标" &&
                query &&
                !iconCatalog.some(([, label]) =>
                  label.toLowerCase().includes(query.toLowerCase()),
                ) && <p>没有匹配的图标</p>}
            </div>
          </div>
          <footer>
            <button
              className="btn"
              onClick={() => {
                close();
                onSvg();
              }}
            >
              <Upload size={15} />
              导入自定义 SVG
            </button>
            <span>插入后可调整颜色与大小</span>
          </footer>
        </div>
      )}
    </>
  );
}
