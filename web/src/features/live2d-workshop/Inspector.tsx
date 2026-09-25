import { Plus, Trash2 } from "lucide-react";
import { Choice, Numeric } from "./Controls";
import { clearBindings, grid, id, triangulate } from "./model";
import type {
  CharacterDocument,
  Deformer,
  Mode,
  Parameter,
  Part,
} from "./types";
export type Edit = (
  update: (doc: CharacterDocument) => void,
  checkpoint?: boolean,
) => void;
function parents(doc: CharacterDocument, nodeId: string) {
  return doc.deformers.filter((d) => {
    let parent: string | null | undefined = d.id;
    const seen = new Set<string>();
    while (parent) {
      if (parent === nodeId || seen.has(parent)) return false;
      seen.add(parent);
      parent = doc.deformers.find((p) => p.id === parent)?.parentId;
    }
    return true;
  });
}
export function Inspector({
  doc,
  selected,
  posed,
  mode,
  edit,
  editShape,
  parameterId,
  onParameter,
  parameterValue,
  onValue,
  vertexIndex,
  setVertexIndex,
  readOnly,
  onFitMesh,
  confirm,
}: {
  doc: CharacterDocument;
  selected: string;
  posed?: Part | Deformer;
  mode: Mode;
  edit: Edit;
  editShape: (
    fn: (node: Part | Deformer) => void,
    checkpoint?: boolean,
  ) => void;
  parameterId: string;
  onParameter: (id: string) => void;
  parameterValue: number;
  onValue: (value: number) => void;
  vertexIndex: number;
  setVertexIndex: (i: number) => void;
  readOnly: boolean;
  onFitMesh: () => void;
  confirm: (message: string, action: () => void) => void;
}) {
  const node =
    posed ??
    doc.parts.find((p) => p.id === selected) ??
    doc.deformers.find((d) => d.id === selected);
  const parameter = doc.parameters.find((p) => p.id === parameterId);
  const locked = readOnly || (!!node && "locked" in node && node.locked);
  const property = (name: string, value: unknown) =>
    edit((d) => {
      const target =
        d.parts.find((p) => p.id === selected) ??
        d.deformers.find((p) => p.id === selected);
      if (target) Object.assign(target, { [name]: value });
    });
  const topology = (fn: (p: Part) => void) => {
    const action = () =>
      edit((d) => {
        clearBindings(d, selected);
        fn(d.parts.find((p) => p.id === selected)!);
      });
    if (
      doc.parameters.some((p) =>
        p.bindings.some((b) => b.targetId === selected),
      )
    )
      confirm("此操作会清除该部件的所有参数绑定。操作后仍可撤销。", action);
    else action();
  };
  return (
    <>
      <div className="l2-panel-heading">
        <h2>{mode === "rig" ? "参数与关键形" : "对象属性"}</h2>
      </div>
      {mode === "rig" && (
        <>
          <Choice
            label="当前参数"
            value={parameterId}
            options={doc.parameters.map((p) => ({
              value: p.id,
              label: p.name,
            }))}
            onChange={onParameter}
          />
          {parameter && (
            <>
              <div className="l2-range">
                <input
                  aria-label={parameter.name}
                  type="range"
                  min={parameter.minimum}
                  max={parameter.maximum}
                  step={(parameter.maximum - parameter.minimum) / 100}
                  value={parameterValue}
                  onChange={(e) => onValue(Number(e.target.value))}
                />
                <Numeric
                  label="参数值"
                  value={parameterValue}
                  min={parameter.minimum}
                  max={parameter.maximum}
                  step={0.1}
                  onChange={onValue}
                />
              </div>
              <p className="l2-hint">
                调整滑杆预览；编辑顶点或变形器会记录当前位置的参数关键形。
              </p>
              <details>
                <summary>参数设置</summary>
                <label className="l2-field">
                  名称
                  <input
                    disabled={readOnly}
                    value={parameter.name}
                    onChange={(e) =>
                      edit((d) => {
                        d.parameters.find((p) => p.id === parameterId)!.name =
                          e.target.value;
                      })
                    }
                  />
                </label>
                {(
                  [
                    ["minimum", "最小值"],
                    ["maximum", "最大值"],
                    ["default", "默认值"],
                  ] as const
                ).map(([field, label]) => (
                  <Numeric
                    key={field}
                    label={label}
                    value={parameter[field]}
                    disabled={readOnly || parameter.bindings.length > 0}
                    onChange={(v) =>
                      edit((d) => {
                        const p = d.parameters.find(
                          (p) => p.id === parameterId,
                        )!;
                        p[field] = v;
                        if (p.minimum >= p.maximum) p.maximum = p.minimum + 1;
                        p.default = Math.max(
                          p.minimum,
                          Math.min(p.maximum, p.default),
                        );
                      })
                    }
                  />
                ))}
              </details>
            </>
          )}
          <button
            className="l2-full"
            disabled={readOnly}
            onClick={() =>
              edit((d) => {
                const p: Parameter = {
                  id: id(),
                  name: "新参数",
                  minimum: 0,
                  maximum: 1,
                  default: 0,
                  bindings: [],
                };
                d.parameters.push(p);
                onParameter(p.id);
              })
            }
          >
            <Plus size={14} />
            新建参数
          </button>
          <hr />
        </>
      )}
      {!node ? (
        <p className="l2-hint">选择一个部件或变形器查看属性。</p>
      ) : (
        <>
          <label className="l2-field">
            名称
            <input
              value={node.name}
              disabled={readOnly}
              onChange={(e) => property("name", e.target.value)}
            />
          </label>
          {mode === "rig" && (
            <p className="l2-hint">
              当前编辑参数关键形；位置、枢轴、层级和遮罩属于基础模型，请在“模型”页调整。默认值处的关键形定义基础形态。
            </p>
          )}
          <Choice
            label="父变形器"
            value={node.parentId ?? ""}
            options={[
              { value: "", label: "无（画布坐标）" },
              ...parents(doc, node.id).map((d) => ({
                value: d.id,
                label: d.name,
              })),
            ]}
            disabled={locked || mode === "rig"}
            onChange={(v) => property("parentId", v || null)}
          />
          <div className="l2-two">
            <Numeric
              label={
                "kind" in node && node.kind === "rotation" ? "枢轴 X" : "位置 X"
              }
              value={node.x}
              disabled={locked || mode === "rig"}
              onChange={(v) => property("x", v)}
            />
            <Numeric
              label={
                "kind" in node && node.kind === "rotation" ? "枢轴 Y" : "位置 Y"
              }
              value={node.y}
              disabled={locked || mode === "rig"}
              onChange={(v) => property("y", v)}
            />
          </div>
          {"vertices" in node ? (
            <>
              {mode === "model" && (
                <button
                  className="l2-full"
                  disabled={locked}
                  onClick={onFitMesh}
                >
                  按透明像素重建贴合网格
                </button>
              )}
              <div className="l2-two">
                <Numeric
                  label="宽度"
                  value={node.width}
                  min={1}
                  max={8192}
                  disabled={locked || mode === "rig"}
                  onChange={(v) =>
                    topology((p) => {
                      const ratio = v / p.width;
                      p.width = v;
                      p.vertices.forEach((n) => (n.x *= ratio));
                    })
                  }
                />
                <Numeric
                  label="高度"
                  value={node.height}
                  min={1}
                  max={8192}
                  disabled={locked || mode === "rig"}
                  onChange={(v) =>
                    topology((p) => {
                      const ratio = v / p.height;
                      p.height = v;
                      p.vertices.forEach((n) => (n.y *= ratio));
                    })
                  }
                />
              </div>
              <Numeric
                label="不透明度"
                value={node.opacity}
                step={0.05}
                min={0}
                max={1}
                disabled={locked}
                onChange={(v) =>
                  editShape((n) => {
                    if ("opacity" in n) n.opacity = v;
                  })
                }
              />
              <Numeric
                label="绘制顺序"
                value={node.order}
                min={-10000}
                max={10000}
                disabled={locked || mode === "rig"}
                onChange={(v) => property("order", Math.round(v))}
              />
              <Choice
                label="透明度遮罩"
                value={node.maskId ?? ""}
                disabled={locked || mode === "rig"}
                options={[
                  { value: "", label: "无" },
                  ...doc.parts
                    .filter((p) => {
                      let cursor: string | null | undefined = p.id;
                      const seen = new Set<string>();
                      while (cursor) {
                        if (cursor === node.id || seen.has(cursor))
                          return false;
                        seen.add(cursor);
                        cursor = doc.parts.find((n) => n.id === cursor)?.maskId;
                      }
                      return true;
                    })
                    .map((p) => ({ value: p.id, label: p.name })),
                ]}
                onChange={(v) => property("maskId", v || null)}
              />
              <hr />
              <strong>三角网格 · {node.vertices.length} 顶点</strong>
              <Numeric
                label="选中顶点"
                value={Math.min(vertexIndex + 1, node.vertices.length)}
                min={1}
                max={node.vertices.length}
                onChange={(v) => setVertexIndex(Math.round(v) - 1)}
              />
              {node.vertices[vertexIndex] && (
                <div className="l2-two">
                  {(["x", "y"] as const).map((axis) => (
                    <Numeric
                      key={axis}
                      label={axis.toUpperCase()}
                      value={node.vertices[vertexIndex][axis]}
                      disabled={locked}
                      onChange={(v) =>
                        editShape((n) => {
                          if ("vertices" in n)
                            n.vertices[vertexIndex][axis] = v;
                        })
                      }
                    />
                  ))}
                </div>
              )}
              <div className="l2-stack">
                <button
                  disabled={locked || mode === "rig"}
                  onClick={() =>
                    topology((p) => Object.assign(p, grid(p.width, p.height)))
                  }
                >
                  重新生成 4 × 4 网格
                </button>
                <button
                  disabled={
                    locked || mode === "rig" || node.vertices.length <= 3
                  }
                  onClick={() =>
                    topology((p) => {
                      const index = Math.min(
                        vertexIndex,
                        p.vertices.length - 1,
                      );
                      p.vertices.splice(index, 1);
                      p.uvs.splice(index, 1);
                      triangulate(p);
                      setVertexIndex(0);
                    })
                  }
                >
                  删除选中顶点
                </button>
              </div>
            </>
          ) : node.kind === "rotation" ? (
            <>
              <Numeric
                label="旋转角度"
                value={node.rotation}
                min={-360}
                max={360}
                disabled={locked}
                onChange={(v) =>
                  editShape((n) => {
                    if ("rotation" in n) n.rotation = v;
                  })
                }
              />
              <Numeric
                label="缩放"
                value={node.scale}
                step={0.05}
                min={0.01}
                max={10}
                disabled={locked}
                onChange={(v) =>
                  editShape((n) => {
                    if ("scale" in n) n.scale = v;
                  })
                }
              />
            </>
          ) : (
            <p className="l2-hint">
              {node.columns} × {node.rows} 曲面格点；拖动画布控制点进行变形。
            </p>
          )}
          <button
            className="l2-full l2-danger"
            disabled={readOnly}
            onClick={() =>
              confirm(
                "删除此对象及其参数绑定？子部件会解除父级，引用它的遮罩也会解除。",
                () =>
                  edit((d) => {
                    clearBindings(d, selected);
                    d.parts = d.parts
                      .filter((p) => p.id !== selected)
                      .map((p) => ({
                        ...p,
                        parentId: p.parentId === selected ? null : p.parentId,
                        maskId: p.maskId === selected ? null : p.maskId,
                      }));
                    d.deformers = d.deformers
                      .filter((p) => p.id !== selected)
                      .map((p) => ({
                        ...p,
                        parentId: p.parentId === selected ? null : p.parentId,
                      }));
                  }),
              )
            }
          >
            <Trash2 size={14} />
            删除对象
          </button>
        </>
      )}
    </>
  );
}
