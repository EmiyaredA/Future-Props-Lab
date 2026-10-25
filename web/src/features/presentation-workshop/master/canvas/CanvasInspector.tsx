import { CustomSelect } from "@shared/ui/CustomSelect";
import { Numeric, Color } from "../StyleFields";
import { TemplateSlotEditor } from "../TemplateSlotEditor";
import { pageTypes, type Definition, type PageType, type Slot } from "../model";
import type { Slide, SlideElement } from "../../types";
import { objectScope, scopes, semanticRole } from "./canvasModel";
import { layerScene } from "../nativeScenes";
import { writeScene } from "../nativeScenes";
import { objectId } from "./canvasModel";
import { themeChange } from "./themeChange";
export function CanvasInspector({
  definition,
  pageType,
  slide,
  selected,
  onPatch,
  onDefinition,
  select,
}: {
  definition: Definition;
  pageType: PageType;
  slide: Slide;
  selected: string[];
  onPatch: (patch: Partial<SlideElement>) => void;
  onDefinition: (d: Definition) => void;
  select: (ids: string[]) => void;
}) {
  const e = slide.elements.find((e) => e.id === selected[0]),
    role = e ? semanticRole(definition, pageType, e.id) : null;
  const chosenScopes = [...new Set(selected.map(objectScope))];
  const run = e?.paragraphs[0]?.runs[0];
  const layout = definition.layouts[pageType];
  return (
    <div className="master-canvas-inspector">
      <div className="master-inspector-heading">
        <strong>
          {selected.length > 1
            ? `已选择 ${selected.length} 个对象`
            : e?.name || "页面与主题"}
        </strong>
        <span>
          {chosenScopes
            .map((s) => scopes.find((x) => x.value === s)?.label)
            .join(" + ")}
        </span>
      </div>
      {e ? (
        <>
          <p className="master-scope-notice">
            影响范围：
            {chosenScopes
              .map((s) => scopes.find((x) => x.value === s)?.impact)
              .join("；")}
          </p>
          {selected.length === 1 && objectScope(e.id) === "global" && (
            <div className="master-fixed-page-types">
              <small>适用页型</small>
              {pageTypes.map((type) => (
                <label className="master-check" key={type.value}>
                  <input
                    type="checkbox"
                    checked={
                      !definition.global_scene?.page_types?.[objectId(e.id)] ||
                      definition.global_scene.page_types[
                        objectId(e.id)
                      ].includes(type.value)
                    }
                    onChange={() => {
                      const scene = layerScene(definition, pageType, "global"),
                        id = objectId(e.id),
                        current =
                          scene.page_types?.[id] ??
                          pageTypes.map((t) => t.value);
                      onDefinition(
                        writeScene(definition, pageType, "global", {
                          ...scene,
                          page_types: {
                            ...scene.page_types,
                            [id]: current.includes(type.value)
                              ? current.filter((t) => t !== type.value)
                              : [...current, type.value],
                          },
                        }),
                      );
                    }}
                  />
                  {type.label}
                </label>
              ))}
            </div>
          )}
          {role && (
            <p className="master-scope-notice">
              动态
              {
                {
                  chapter: "章节标题",
                  title: "页标题",
                  number: "页码",
                  toc: "目录",
                }[role]
              }{" "}
              · 内容来自文稿，示例文字不会写入正文。
            </p>
          )}
          {!role && e.kind === "text" && selected.length === 1 && (
            <label className="master-field">
              <span>内容</span>
              <textarea
                aria-label="对象文字"
                rows={3}
                value={e.paragraphs
                  .map((p) => p.runs.map((r) => r.text).join(""))
                  .join("\n")}
                onChange={(event) =>
                  onPatch({
                    paragraphs: [
                      {
                        ...e.paragraphs[0],
                        runs: [{ ...run!, text: event.target.value }],
                      },
                    ],
                  })
                }
              />
            </label>
          )}
          {run && selected.length === 1 ? (
            <TemplateSlotEditor
              name="所选对象"
              width={10000}
              height={10000}
              slot={{
                x: e.x,
                y: e.y,
                width: e.width,
                height: e.height,
                visible: !e.hidden,
                style: {
                  font: run.font,
                  size: run.size,
                  color: run.color,
                  bold: run.bold,
                  align: e.paragraphs[0].align,
                },
              }}
              onChange={(slot: Slot) =>
                onPatch({
                  x: slot.x,
                  y: slot.y,
                  width: slot.width,
                  height: slot.height,
                  hidden: !slot.visible,
                  paragraphs: e.paragraphs.map((p) => ({
                    ...p,
                    align: slot.style.align,
                    runs: p.runs.map((r) => ({
                      ...r,
                      font: slot.style.font,
                      size: slot.style.size,
                      color: slot.style.color,
                      bold: slot.style.bold,
                      text: r.text,
                    })),
                  })),
                })
              }
            />
          ) : (
            <div className="master-coordinates">
              {(["x", "y", "width", "height"] as const).map((key) => (
                <Numeric
                  key={key}
                  label={`所选对象 ${key}`}
                  value={e[key]}
                  min={key === "width" || key === "height" ? 1 : -10000}
                  max={10000}
                  onChange={(v) => onPatch({ [key]: v })}
                />
              ))}
            </div>
          )}
          <Numeric
            label="旋转"
            value={e.rotation}
            min={-360}
            max={360}
            onChange={(rotation) => onPatch({ rotation })}
          />
          {!run && (
            <Color
              label="填充颜色"
              value={e.fill}
              onChange={(fill) => onPatch({ fill })}
            />
          )}
          <Numeric
            label="不透明度"
            value={e.opacity ?? 1}
            min={0}
            max={1}
            onChange={(opacity) => onPatch({ opacity })}
          />
          {!run && (
            <label className="master-check">
              <input
                type="checkbox"
                checked={!e.hidden}
                onChange={() => onPatch({ hidden: !e.hidden })}
              />
              显示所选对象
            </label>
          )}
        </>
      ) : (
        <>
          <Color
            label="全局背景"
            value={layout.background}
            onChange={(background) =>
              onDefinition({
                ...definition,
                layouts: Object.fromEntries(
                  Object.entries(definition.layouts).map(([key, value]) => [
                    key,
                    { ...value, background },
                  ]),
                ) as Definition["layouts"],
              })
            }
          />
          <Color
            label="当前页型背景"
            value={layout.background}
            onChange={(background) =>
              onDefinition({
                ...definition,
                layouts: {
                  ...definition.layouts,
                  [pageType]: { ...layout, background },
                },
              })
            }
          />
          <Color
            label="全局文字颜色"
            value={definition.foreground}
            onChange={(foreground) =>
              onDefinition(themeChange(definition, { foreground }))
            }
          />
          <Color
            label="全局强调色"
            value={definition.accent}
            onChange={(accent) =>
              onDefinition(themeChange(definition, { accent }))
            }
          />
          <label className="master-field">
            <span>全局字体</span>
            <CustomSelect
              ariaLabel="模板全局字体"
              value={definition.font}
              options={[
                { value: "Microsoft YaHei", label: "微软雅黑" },
                { value: "Arial", label: "Arial" },
                { value: "Consolas", label: "Consolas" },
              ]}
              onChange={(font) =>
                onDefinition(
                  themeChange(definition, {
                    font: font as Definition["font"],
                  }),
                )
              }
            />
          </label>
          <Numeric
            label="页码起始值"
            value={definition.number_start ?? 1}
            max={9999}
            onChange={(number_start) =>
              onDefinition({ ...definition, number_start })
            }
          />
          <label className="master-check">
            <input
              type="checkbox"
              checked={definition.number_total}
              onChange={() =>
                onDefinition({
                  ...definition,
                  number_total: !definition.number_total,
                })
              }
            />
            显示总页数
          </label>
          <label className="master-check">
            <input
              type="checkbox"
              checked={!definition.number_hidden_types?.includes(pageType)}
              onChange={() =>
                onDefinition({
                  ...definition,
                  number_hidden_types: definition.number_hidden_types?.includes(
                    pageType,
                  )
                    ? definition.number_hidden_types.filter(
                        (t) => t !== pageType,
                      )
                    : [...(definition.number_hidden_types ?? []), pageType],
                })
              }
            />
            当前页型显示页码
          </label>
          {pageType === "toc" && (
            <Numeric
              label="单页目录容量"
              value={layout.toc_capacity ?? 7}
              min={1}
              max={20}
              onChange={(toc_capacity) =>
                onDefinition({
                  ...definition,
                  layouts: {
                    ...definition.layouts,
                    toc: { ...layout, toc_capacity },
                  },
                })
              }
            />
          )}
        </>
      )}
      <details open className="master-object-list">
        <summary>对象与动态槽位</summary>
        {scopes.map((scope) => (
          <div key={scope.value}>
            <small>{scope.label}</small>
            {layerScene(definition, pageType, scope.value).elements?.map(
              (e) => (
                <button
                  key={e.id}
                  aria-pressed={selected.includes(`${scope.value}:${e.id}`)}
                  onClick={() => select([`${scope.value}:${e.id}`])}
                >
                  {e.hidden ? "○" : "●"} {e.name || e.kind}
                  {layerScene(
                    definition,
                    pageType,
                    scope.value,
                  ).semantics?.some((s) => s.element_id === e.id)
                    ? " · 动态"
                    : ""}
                </button>
              ),
            )}
          </div>
        ))}
      </details>
    </div>
  );
}
