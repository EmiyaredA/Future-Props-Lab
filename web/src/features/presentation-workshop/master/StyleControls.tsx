import { PresentationImages } from "../PresentationImages";
import { useEffect, useRef, useState } from "react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { uploadImage } from "../api";
import { newId } from "../templates";
import {
  pageTypes,
  type Definition,
  type Slot,
  type Fixed,
  type PageType,
} from "./model";

export function Numeric({
  label,
  value,
  onChange,
  min = 0,
  max = 4096,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="master-field">
      {label}
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = e.currentTarget.valueAsNumber;
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
      />
    </label>
  );
}
function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="master-color">
      {label}
      <CustomColorPicker ariaLabel={label} value={value} onChange={onChange} />
    </label>
  );
}
function SlotControls({
  name,
  slot,
  onChange,
  width,
  height,
}: {
  name: string;
  slot: Slot;
  onChange: (s: Slot) => void;
  width: number;
  height: number;
}) {
  const patch = (value: Partial<Slot>) => onChange({ ...slot, ...value });
  return (
    <fieldset className="master-settings-group">
      <legend>{name}</legend>
      <label className="master-check">
        <input
          type="checkbox"
          checked={slot.visible !== false}
          onChange={(e) => patch({ visible: e.target.checked })}
        />
        显示{name}
      </label>
      <div className="master-field-grid">
        <Numeric
          label={`${name} X`}
          value={slot.x}
          max={width - slot.width}
          onChange={(x) => patch({ x })}
        />
        <Numeric
          label={`${name} Y`}
          value={slot.y}
          max={height - slot.height}
          onChange={(y) => patch({ y })}
        />
        <Numeric
          label={`${name}宽度`}
          value={slot.width}
          min={1}
          max={width - slot.x}
          onChange={(width) => patch({ width })}
        />
        <Numeric
          label={`${name}高度`}
          value={slot.height}
          min={1}
          max={height - slot.y}
          onChange={(height) => patch({ height })}
        />
      </div>
      <label className="master-field">
        字体
        <CustomSelect
          ariaLabel={`${name}字体`}
          value={slot.style.font}
          options={["Microsoft YaHei", "Arial", "Consolas"].map((value) => ({
            value,
            label: value,
          }))}
          onChange={(font) =>
            patch({
              style: { ...slot.style, font: font as Slot["style"]["font"] },
            })
          }
        />
      </label>
      <div className="master-field-grid">
        <Numeric
          label={`${name}字号`}
          value={slot.style.size}
          min={6}
          max={240}
          onChange={(size) => patch({ style: { ...slot.style, size } })}
        />
        <Color
          label={`${name}颜色`}
          value={slot.style.color}
          onChange={(color) => patch({ style: { ...slot.style, color } })}
        />
      </div>
      <label className="master-check">
        <input
          type="checkbox"
          checked={slot.style.bold}
          onChange={(e) =>
            patch({ style: { ...slot.style, bold: e.target.checked } })
          }
        />
        加粗
      </label>
      <CustomSelect
        ariaLabel={`${name}对齐`}
        value={slot.style.align}
        options={[
          { value: "left", label: "左对齐" },
          { value: "center", label: "居中" },
          { value: "right", label: "右对齐" },
        ]}
        onChange={(align) =>
          patch({
            style: { ...slot.style, align: align as Slot["style"]["align"] },
          })
        }
      />
    </fieldset>
  );
}
export function StyleControls({
  definition,
  onChange,
  pageType,
  onBusyChange,
}: {
  definition: Definition;
  onChange: (d: Definition) => void;
  pageType: PageType;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [tab, setTab] = useState("titles"),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState(false);
  useEffect(() => {
    onBusyChange?.(uploading);
    return () => onBusyChange?.(false);
  }, [onBusyChange, uploading]);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [picker, setPicker] = useState<"logo" | "background" | null>(null);
  const layout = definition.layouts[pageType];
  const patch = (value: Partial<Definition>) =>
    onChange({ ...definition, ...value });
  const page = (value: Partial<typeof layout>) =>
    patch({
      layouts: { ...definition.layouts, [pageType]: { ...layout, ...value } },
    });
  const fixed = (index: number, value: Partial<Fixed>) =>
    patch({
      fixed: definition.fixed?.map((item, i) =>
        i === index ? { ...item, ...value } : item,
      ),
    });
  return (
    <fieldset className="master-controls" disabled={uploading}>
      <div className="master-tabs" role="tablist" aria-label="模板设置分类">
        {[
          ["theme", "主题与字体"],
          ["titles", "标题与页码"],
          ["background", "背景与固定元素"],
        ].map(([id, label]) => (
          <button
            role="tab"
            aria-selected={tab === id}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "theme" && (
        <>
          <h3>全局主题</h3>
          <p>所有页型共用，槽位可单独调整。</p>
          <label className="master-field">
            全局字体
            <CustomSelect
              ariaLabel="全局字体"
              value={definition.font}
              options={["Microsoft YaHei", "Arial", "Consolas"].map(
                (value) => ({ value, label: value }),
              )}
              onChange={(font) =>
                onChange({
                  ...definition,
                  font: font as Definition["font"],
                  layouts: Object.fromEntries(
                    Object.entries(definition.layouts).map(([kind, item]) => [
                      kind,
                      {
                        ...item,
                        ...Object.fromEntries(
                          (["chapter", "title", "number", "toc"] as const).map(
                            (key) => [
                              key,
                              {
                                ...item[key],
                                style: { ...item[key].style, font },
                              },
                            ],
                          ),
                        ),
                      },
                    ]),
                  ) as Definition["layouts"],
                })
              }
            />
          </label>
          <Color
            label="全局文字颜色"
            value={definition.foreground}
            onChange={(foreground) =>
              onChange({
                ...definition,
                foreground,
                layouts: Object.fromEntries(
                  Object.entries(definition.layouts).map(([kind, item]) => [
                    kind,
                    {
                      ...item,
                      ...Object.fromEntries(
                        (["chapter", "title", "toc"] as const).map((key) => [
                          key,
                          {
                            ...item[key],
                            style: { ...item[key].style, color: foreground },
                          },
                        ]),
                      ),
                    },
                  ]),
                ) as Definition["layouts"],
              })
            }
          />
          <Color
            label="强调色"
            value={definition.accent}
            onChange={(accent) =>
              patch({
                accent,
                layouts: Object.fromEntries(
                  Object.entries(definition.layouts).map(([kind, item]) => [
                    kind,
                    {
                      ...item,
                      ...Object.fromEntries(
                        (["chapter", "title", "number", "toc"] as const).map(
                          (key) => [
                            key,
                            {
                              ...item[key],
                              style: {
                                ...item[key].style,
                                color:
                                  item[key].style.color === definition.accent
                                    ? accent
                                    : item[key].style.color,
                              },
                            },
                          ],
                        ),
                      ),
                    },
                  ]),
                ) as Definition["layouts"],
              })
            }
          />
          <button
            className="btn"
            onClick={() =>
              patch({
                layouts: Object.fromEntries(
                  Object.entries(definition.layouts).map(([key, item]) => [
                    key,
                    { ...item, background: layout.background },
                  ]),
                ) as Definition["layouts"],
              })
            }
          >
            当前背景应用到全部页型
          </button>
        </>
      )}
      {tab === "titles" && (
        <>
          <p>
            正在配置：{pageTypes.find((p) => p.value === pageType)?.label}
            。章节来自页面所属章节，页标题来自页面内容。
          </p>
          {(["chapter", "title", "number"] as const).map((key, i) => (
            <SlotControls
              key={key}
              name={["章节标题", "页标题", "页码"][i]}
              slot={layout[key]}
              width={definition.width}
              height={definition.height}
              onChange={(slot) => page({ [key]: slot })}
            />
          ))}
          <Numeric
            label="页码起始值"
            value={definition.number_start}
            max={9999}
            onChange={(number_start) => patch({ number_start })}
          />
          <label className="master-check">
            <input
              type="checkbox"
              checked={definition.number_total}
              onChange={(e) => patch({ number_total: e.target.checked })}
            />
            显示总页数
          </label>
          <fieldset className="master-settings-group">
            <legend>隐藏页码的页型（仍计入序号）</legend>
            {pageTypes.map((p) => (
              <label className="master-check" key={p.value}>
                <input
                  type="checkbox"
                  checked={definition.number_hidden_types?.includes(p.value)}
                  onChange={(e) =>
                    patch({
                      number_hidden_types: e.target.checked
                        ? [...(definition.number_hidden_types ?? []), p.value]
                        : (definition.number_hidden_types ?? []).filter(
                            (t) => t !== p.value,
                          ),
                    })
                  }
                />
                {p.label}
              </label>
            ))}
          </fieldset>
          {pageType === "toc" && (
            <>
              <SlotControls
                name="目录内容"
                slot={layout.toc}
                width={definition.width}
                height={definition.height}
                onChange={(toc) => page({ toc })}
              />
              <Numeric
                label="每页目录项"
                value={layout.toc_capacity}
                min={1}
                max={20}
                onChange={(toc_capacity) => page({ toc_capacity })}
              />
            </>
          )}
          <Numeric
            label="正文安全区起点"
            value={layout.body_top}
            max={definition.height}
            onChange={(body_top) => page({ body_top })}
          />
          <button
            className="btn"
            onClick={() =>
              patch({
                layouts: Object.fromEntries(
                  Object.entries(definition.layouts).map(([key, item]) => [
                    key,
                    {
                      ...item,
                      chapter: layout.chapter,
                      title: layout.title,
                      number: layout.number,
                    },
                  ]),
                ) as Definition["layouts"],
              })
            }
          >
            标题与页码应用到全部页型
          </button>
        </>
      )}
      {tab === "background" && (
        <>
          <Color
            label="当前页型背景"
            value={layout.background}
            onChange={(background) => page({ background })}
          />
          <p>固定内容独立于正文。Logo 使用上传的正式图片。</p>
          <div className="master-actions">
            <button
              className="btn"
              onClick={() =>
                patch({
                  fixed: [
                    ...(definition.fixed ?? []),
                    {
                      id: newId(),
                      kind: "text",
                      text: "固定文字",
                      asset_id: null,
                      x: 64,
                      y: 640,
                      width: 200,
                      height: 32,
                      style: {
                        font: definition.font,
                        size: 16,
                        color: definition.foreground,
                        bold: false,
                        align: "left",
                      },
                      fill: "#FFFFFF",
                      opacity: 1,
                      layer: "front",
                      page_types: pageTypes.map((p) => p.value),
                    },
                  ],
                })
              }
            >
              添加固定文字
            </button>
            <button
              className="btn"
              disabled={uploading}
              onClick={() => input.current?.click()}
            >
              {uploading ? "正在上传…" : "上传固定 Logo"}
            </button>
            <button
              className="btn"
              disabled={uploading}
              onClick={() => {
                input.current?.setAttribute("data-background", "true");
                input.current?.click();
              }}
            >
              上传背景
            </button>
          </div>
          <div className="master-actions">
            <button className="btn" onClick={() => setPicker("logo")}>
              从文件库选择 Logo
            </button>
            <button className="btn" onClick={() => setPicker("background")}>
              从文件库选择背景
            </button>
          </div>
          {picker && (
            <PresentationImages
              title={picker === "logo" ? "选择固定 Logo" : "选择背景图片"}
              onClose={() => setPicker(null)}
              onChoose={(asset_id) => {
                if (picker === "background")
                  page({ background_asset_id: asset_id });
                else
                  patch({
                    fixed: [
                      ...(definition.fixed ?? []),
                      {
                        id: newId(),
                        kind: "image",
                        text: "",
                        asset_id,
                        x: 1100,
                        y: 32,
                        width: 116,
                        height: 40,
                        style: layout.number.style,
                        fill: "#FFFFFF",
                        opacity: 1,
                        layer: "front",
                        page_types: pageTypes.map((p) => p.value),
                      },
                    ],
                  });
                setPicker(null);
              }}
            />
          )}
          <input
            hidden
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(event) => {
              const file = event.target.files?.[0],
                background = event.currentTarget.dataset.background === "true";
              event.currentTarget.removeAttribute("data-background");
              event.currentTarget.value = "";
              if (!file) return;
              setUploading(true);
              setError("");
              void uploadImage(file)
                .then((asset) => {
                  if (!alive.current) return;
                  if (background) page({ background_asset_id: asset.id });
                  else
                    patch({
                      fixed: [
                        ...(definition.fixed ?? []),
                        {
                          id: newId(),
                          kind: "image",
                          text: "",
                          asset_id: asset.id,
                          x: 1100,
                          y: 32,
                          width: 116,
                          height: 40,
                          style: layout.number.style,
                          fill: "#FFFFFF",
                          opacity: 1,
                          layer: "front",
                          page_types: pageTypes.map((p) => p.value),
                        },
                      ],
                    });
                })
                .catch((e) =>
                  setError(e instanceof Error ? e.message : "上传失败"),
                )
                .finally(() => setUploading(false));
            }}
          />
          {layout.background_asset_id && (
            <button
              className="btn"
              onClick={() => page({ background_asset_id: null })}
            >
              移除背景图片
            </button>
          )}
          {error && <p role="alert">{error}</p>}
          {definition.fixed?.map((item, index) => (
            <fieldset className="master-settings-group" key={item.id}>
              <legend>
                {item.kind === "image" ? "固定图片 / Logo" : "固定文字"}{" "}
                {index + 1}
              </legend>
              {item.kind === "text" && (
                <label className="master-field">
                  文字
                  <input
                    aria-label={`固定文字 ${index + 1}`}
                    value={item.text}
                    maxLength={2000}
                    onChange={(e) => fixed(index, { text: e.target.value })}
                  />
                </label>
              )}
              <div className="master-field-grid">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <Numeric
                    key={key}
                    label={`固定元素 ${index + 1} ${key}`}
                    value={item[key]}
                    min={key === "width" || key === "height" ? 1 : 0}
                    max={
                      key === "x"
                        ? definition.width - item.width
                        : key === "y"
                          ? definition.height - item.height
                          : key === "width"
                            ? definition.width - item.x
                            : definition.height - item.y
                    }
                    onChange={(n) => fixed(index, { [key]: n })}
                  />
                ))}
              </div>
              {item.kind === "text" && (
                <>
                  <Numeric
                    label="固定文字字号"
                    value={item.style!.size}
                    min={6}
                    max={240}
                    onChange={(size) =>
                      fixed(index, { style: { ...item.style!, size } })
                    }
                  />
                  <Color
                    label="固定文字颜色"
                    value={item.style!.color}
                    onChange={(color) =>
                      fixed(index, { style: { ...item.style!, color } })
                    }
                  />
                </>
              )}
              <CustomSelect
                ariaLabel="固定元素层级"
                value={item.layer}
                options={[
                  { value: "front", label: "正文前方" },
                  { value: "behind", label: "正文后方" },
                ]}
                onChange={(layer) =>
                  fixed(index, { layer: layer as Fixed["layer"] })
                }
              />
              <fieldset>
                <legend>适用页型</legend>
                {pageTypes.map((p) => (
                  <label className="master-check" key={p.value}>
                    <input
                      type="checkbox"
                      checked={item.page_types?.includes(p.value)}
                      onChange={(e) =>
                        fixed(index, {
                          page_types: e.target.checked
                            ? [...(item.page_types ?? []), p.value]
                            : (item.page_types ?? []).filter(
                                (t) => t !== p.value,
                              ),
                        })
                      }
                    />
                    {p.label}
                  </label>
                ))}
              </fieldset>
              <button
                className="btn"
                onClick={() =>
                  patch({
                    fixed: definition.fixed?.filter((_, i) => i !== index),
                  })
                }
              >
                移除此固定元素
              </button>
            </fieldset>
          ))}
        </>
      )}
    </fieldset>
  );
}
