import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  NodeResizer,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
} from "@xyflow/react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { uploadImage } from "../api";
import { CanvasConnection } from "./CanvasConnection";
import { CanvasShape } from "./CanvasSvg";
import {
  type CanvasElement,
  type CanvasScene,
  type CanvasEdge,
  SHAPES,
  ICONS,
  canvasTextHeight,
  parseCanvasScene,
} from "./model";
import { BOARD_TEMPLATES, canvasTemplate, newElement } from "./templates";
import {
  alignElements,
  insertCanvasTemplate,
  duplicateElements,
  groupElements,
  removeElements,
} from "./sceneOperations";
import "@xyflow/react/dist/style.css";
import "./diagrams.css";
type FlowNode = Node<{ element: CanvasElement }, "shape">;
const shapeNames = [
  "矩形",
  "圆角矩形",
  "椭圆",
  "菱形",
  "文字",
  "图标",
  "图片",
  "分区",
];
function ShapeNode({ data, selected }: NodeProps<FlowNode>) {
  return (
    <div className="canvas-node">
      <NodeResizer isVisible={selected} minWidth={40} minHeight={40} />
      <svg viewBox={`0 0 ${data.element.width} ${data.element.height}`}>
        <CanvasShape element={data.element} />
      </svg>
      {[Position.Left,Position.Right,Position.Top,Position.Bottom].map(side => <span key={side}><Handle id={side} type="target" position={side} /><Handle id={side} type="source" position={side} /></span>)}
    </div>
  );
}
const edgeTypes = { canvas: CanvasConnection };
const nodeTypes = { shape: ShapeNode };
function flowNodes(scene: CanvasScene): FlowNode[] {
  return [...scene.elements]
    .sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId))
    .map((e) => {
      const p = scene.elements.find((n) => n.id === e.parentId);
      return {
        id: e.id,
        type: "shape",
        ariaLabel: `${shapeNames[SHAPES.indexOf(e.kind)]}：${e.text.slice(0, 200)}`,
        data: { element: e },
        position: { x: e.x - (p?.x || 0), y: e.y - (p?.y || 0) },
        parentId: e.parentId,
        style: { width: e.width, height: e.height },
        zIndex: e.kind === "frame" ? -1 : 0,
      };
    });
}
function fromNodes(scene: CanvasScene, nodes: FlowNode[]): CanvasScene {
  return {
    ...scene,
    elements: nodes.map((n) => {
      const p = nodes.find((e) => e.id === n.parentId);
      return {
        ...n.data.element,
        x: n.position.x + (p?.position.x || 0),
        y: n.position.y + (p?.position.y || 0),
        width: n.width || Number(n.style?.width) || n.data.element.width,
        height: n.height || Number(n.style?.height) || n.data.element.height,
      };
    }),
  };
}
export function CanvasEditor({
  scene,
  onChange,
  onClose,
  onUndo,
  onRedo,
}: {
  scene: CanvasScene;
  onChange: (scene: CanvasScene) => void;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const [nodes, setNodes] = useState(() => flowNodes(scene));
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const [returnFocus] = useState(
    () => document.activeElement as HTMLElement | null,
  );
  const latestScene = useRef(scene);
  latestScene.current = scene;
  const active = useRef(true);
  const uploading = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [pendingTemplate, setPendingTemplate] = useState<number | null>(null);
  useEffect(() => {
    setNodes((old) =>
      flowNodes(scene).map((n) => ({
        ...n,
        selected: old.find((o) => o.id === n.id)?.selected,
      })),
    );
  }, [scene]);
  const commit = (next: CanvasScene) => {
    try {
      parseCanvasScene(next);
      setError("");
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "画板修改失败");
    }
  };
  const ids = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
  const selected = scene.elements.find((e) => ids.has(e.id));
  const edge = scene.edges.find((e) => selectedEdges.includes(e.id));
  const update = (patch: Partial<CanvasElement>) =>
    commit({
      ...scene,
      sceneVersion: 2,
      elements: scene.elements.map((e) =>
        ids.has(e.id) ? { ...e, ...patch } : e,
      ),
    });
  const updateEdge = (patch: Partial<CanvasEdge>) =>
    commit({
      ...scene,
      edges: scene.edges.map((e) =>
        selectedEdges.includes(e.id) ? { ...e, ...patch } : e,
      ),
    });
  const connect = (connection: Connection, old?: string) => {
    if (
      !connection.source ||
      !connection.target ||
      connection.source === connection.target
    )
      return;
    commit({
      ...scene,
      sceneVersion: 2,
      edges: [
        ...scene.edges.filter((e) => e.id !== old),
        {
          ...(scene.edges.find(e => e.id === old) ?? {label:"",arrow:true,style:"step" as const}),
          id: old || crypto.randomUUID(),
          source: connection.source,
          target: connection.target,
          sourceAnchor: (connection.sourceHandle || "right") as CanvasEdge["sourceAnchor"],
          targetAnchor: (connection.targetHandle || "left") as CanvasEdge["targetAnchor"],
        },
      ],
    });
  };
  const edges: Edge[] = scene.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: "canvas",
    sourceHandle: e.sourceAnchor ?? "right",
    targetHandle: e.targetAnchor ?? "left",
    data: {style:e.style},
    selected: selectedEdges.includes(e.id),
    markerEnd: e.arrow
      ? { type: "arrowclosed" as const, color: "#365f62" }
      : undefined,
  }));
  const add = (kind: CanvasElement["kind"]) => {
    if (kind === "image") {
      imageInput.current?.click();
      return;
    }
    const element = newElement(
      kind,
      60 + (scene.elements.length % 6) * 30,
      60 + (scene.elements.length % 6) * 30,
    );
    commit({ ...scene, sceneVersion:2, elements: [...scene.elements, element] });
  };
  const upload = async (file: File) => {
    if (uploading.current) return;
    uploading.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await uploadImage(file);
      if (!active.current) return;
      const element = {
        ...newElement("image"),
        assetId: result.asset_id,
        text: file.name,
      };
      commit({
        ...latestScene.current,
        elements: [...latestScene.current.elements, element],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "图片上传失败");
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="diagram-overlay" />
        <Dialog.Content
          className="diagram-fullscreen canvas-editor"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(
              () => returnFocus?.isConnected && returnFocus.focus(),
            );
          }}
          onKeyDown={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest("input,textarea,[contenteditable=true]")) return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
              e.preventDefault();
              e.stopPropagation();
              if (e.shiftKey) onRedo();
              else onUndo();
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
              e.preventDefault();
              commit(duplicateElements(scene, ids));
            }
          }}
        >
          <div className="diagram-toolbar">
            <Dialog.Title>编辑画板</Dialog.Title>
            <span>修改会随笔记自动保存</span>
            <button type="button" className="btn" onClick={onUndo}>
              撤销
            </button>
            <button type="button" className="btn" onClick={onRedo}>
              重做
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={onClose}
            >
              返回笔记
            </button>
          </div>
          <div className="diagram-toolbar">
            <CustomSelect
              ariaLabel="添加图形"
              value=""
              options={[
                { value: "", label: "添加图形" },
                ...SHAPES.map((s, i) => ({ value: s, label: shapeNames[i] })),
              ]}
              onChange={(v) => {
                if (v) add(v as CanvasElement["kind"]);
              }}
            />
            <CustomSelect
              ariaLabel="画板模板"
              value=""
              options={[
                { value: "", label: "插入模板" },
                ...BOARD_TEMPLATES.map((t, i) => ({
                  value: String(i),
                  label: t,
                })),
              ]}
              onChange={(v) => {
                if (v !== "") commit(insertCanvasTemplate(scene,canvasTemplate(Number(v))));
              }}
            />
            <CustomSelect ariaLabel="替换画板模板" value="" options={[{value:"",label:"替换整板…"},...BOARD_TEMPLATES.map((t,i)=>({value:String(i),label:t}))]} onChange={v=>{if(v!=="")setPendingTemplate(Number(v));}} />
            {pendingTemplate !== null && (
              <>
                <span>替换当前画板内容？可撤销。</span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    commit(canvasTemplate(pendingTemplate));
                    setPendingTemplate(null);
                  }}
                >
                  应用模板
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPendingTemplate(null)}
                >
                  取消
                </button>
              </>
            )}
            <input
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
            {busy && <span role="status">正在上传图片…</span>}
            {error && <span role="alert">{error}</span>}
          </div>
          <div className="canvas-workspace">
            <div className="canvas-stage">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                minZoom={0.1}
                maxZoom={4}
                selectionOnDrag
                deleteKeyCode={["Backspace", "Delete"]}
                multiSelectionKeyCode={["Shift", "Meta", "Control"]}
                panOnDrag={[1, 2]}
                snapToGrid
                snapGrid={[10, 10]}
                elevateNodesOnSelect={false}
                ariaLabelConfig={{
                  "controls.ariaLabel": "画板视图",
                  "controls.zoomIn.ariaLabel": "放大画板",
                  "controls.zoomOut.ariaLabel": "缩小画板",
                  "controls.fitView.ariaLabel": "适应画板窗口",
                  "handle.ariaLabel": "连接端点",
                  "node.a11yDescription.default":
                    "按 Enter 或空格选择图形，方向键移动，Delete 删除，Escape 取消选择。",
                  "edge.a11yDescription.default":
                    "按 Enter 或空格选择连接线，Delete 删除，Escape 取消选择。",
                  "node.a11yDescription.ariaLiveMessage": ({ x, y }) =>
                    `图形位置：${x}，${y}`,
                }}
                onDelete={({ nodes: removedNodes, edges: removedEdges }) =>
                  commit(
                    removeElements(
                      latestScene.current,
                      new Set(
                        [...removedNodes, ...removedEdges].map(
                          (item) => item.id,
                        ),
                      ),
                    ),
                  )
                }
                onNodesChange={(changes) => {
                  const next = applyNodeChanges(changes, nodes);
                  setNodes(next);
                  if (changes.some((c) => c.type === "remove")) {
                    return;
                  }
                  if (
                    changes.some(
                      (c) =>
                        (c.type === "position" && c.dragging === false) ||
                        (c.type === "dimensions" && c.resizing === false),
                    )
                  )
                    commit(fromNodes(scene, next));
                }}
                onEdgesChange={(changes) => {
                  setSelectedEdges((old) => {
                    let next = [...old];
                    for (const c of changes)
                      if (c.type === "select")
                        next = c.selected
                          ? [...next.filter((id) => id !== c.id), c.id]
                          : next.filter((id) => id !== c.id);
                    return next;
                  });
                }}
                onConnect={(c) => connect(c)}
                onReconnect={(old, c) => connect(c, old.id)}
              >
                <Background />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
            <aside className="canvas-inspector" aria-label="画板属性">
              <label>
                画板标题
                <input
                  aria-label="画板标题"
                  value={scene.title}
                  maxLength={240}
                  onChange={(e) => commit({ ...scene, title: e.target.value })}
                />
              </label>
              <p>
                拖动端点连接图形；Shift
                多选。空白处拖动框选，鼠标中键或触控板平移。
              </p>
              {selected && (
                <>
                  <label>
                    文字
                    <textarea
                      aria-label="图形文字"
                      rows={3}
                      value={selected.text}
                      onChange={(e) => update({ text: e.target.value })}
                    />
                  </label>
                  <CustomSelect ariaLabel="图形字号" value={String(selected.fontSize ?? 15)} options={[10,12,15,18,24,32,48,72].map(size=>({value:String(size),label:`${size} px`}))} onChange={value=>update({fontSize:Number(value)})} />
                  <CustomSelect ariaLabel="文字对齐" value={selected.textAlign ?? "center"} options={[{value:"left",label:"左对齐"},{value:"center",label:"居中"},{value:"right",label:"右对齐"}]} onChange={value=>update({textAlign:value as CanvasElement["textAlign"]})} />
                  {selected.kind !== "image" && canvasTextHeight(selected)>selected.height && <p role="status">文字超出图形高度<button className="btn" onClick={()=>update({height:Math.ceil(canvasTextHeight(selected))})}>适配高度</button></p>}
                  <CustomColorPicker
                    ariaLabel="填充颜色"
                    value={selected.fill}
                    onChange={(fill) => update({ fill })}
                  />
                  <CustomColorPicker
                    ariaLabel="边框颜色"
                    value={selected.stroke}
                    onChange={(stroke) => update({ stroke })}
                  />
                  {selected.kind === "icon" && (
                    <CustomSelect
                      ariaLabel="图标"
                      value={selected.icon || "server"}
                      options={ICONS.map((v, i) => ({
                        value: v,
                        label: [
                          "服务器",
                          "数据库",
                          "用户",
                          "文件",
                          "云",
                          "处理器", "网络", "锁", "邮件", "时钟", "全球", "代码",
                        ][i],
                      }))}
                      onChange={(v) =>
                        update({ icon: v as CanvasElement["icon"] })
                      }
                    />
                  )}
                  <div className="canvas-actions">
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => commit(duplicateElements(scene, ids))}
                    >
                      复制元素
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => commit(removeElements(scene, ids))}
                    >
                      删除元素
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => commit(groupElements(scene, ids))}
                    >
                      分组
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        const frames = new Set(
                          scene.elements
                            .filter((e) => ids.has(e.id) && e.kind === "frame")
                            .map((e) => e.id),
                        );
                        const next = removeElements(scene, frames);
                        commit({
                          ...next,
                          elements: next.elements.map((e) => {
                            if (!ids.has(e.id)) return e;
                            const copy = { ...e };
                            delete copy.parentId;
                            return copy;
                          }),
                        });
                      }}
                    >
                      解除分组
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() =>
                        commit({
                          ...scene,
                          elements: [
                            ...scene.elements.filter((e) => !ids.has(e.id)),
                            ...scene.elements.filter((e) => ids.has(e.id)),
                          ],
                        })
                      }
                    >
                      置顶
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() =>
                        commit({
                          ...scene,
                          elements: [
                            ...scene.elements.filter((e) => ids.has(e.id)),
                            ...scene.elements.filter((e) => !ids.has(e.id)),
                          ],
                        })
                      }
                    >
                      置底
                    </button>
                    {(["left", "right", "top", "bottom", "centerX", "centerY", "horizontal", "vertical"] as const).map(
                      (m, i) => (
                        <button
                          type="button"
                          className="btn small"
                          key={m}
                          onClick={() => commit(alignElements(scene, ids, m))}
                        >
                          {["左对齐", "右对齐", "顶对齐", "底对齐", "水平居中", "垂直居中", "水平分布", "垂直分布"][i]}
                        </button>
                      ),
                    )}
                  </div>
                </>
              )}
              {edge && (
                <>
                  <label>
                    连接线标签
                    <input
                      aria-label="连接线标签"
                      value={edge.label}
                      onChange={(e) => updateEdge({ label: e.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn"
                    aria-pressed={edge.arrow}
                    onClick={() => updateEdge({ arrow: !edge.arrow })}
                  >
                    箭头
                  </button>
                  <CustomSelect
                    ariaLabel="连线样式"
                    value={edge.style}
                    options={[
                      { value: "step", label: "折线" },
                      { value: "straight", label: "直线" },
                    ]}
                    onChange={(style) =>
                      updateEdge({ style: style as CanvasEdge["style"] })
                    }
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      commit({
                        ...scene,
                        edges: scene.edges.filter(
                          (e) => !selectedEdges.includes(e.id),
                        ),
                      })
                    }
                  >
                    删除连线
                  </button>
                </>
              )}
            </aside>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
