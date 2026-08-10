import { useMemo, useRef, useState, type PointerEvent } from "react";
import {
  Braces,
  ExternalLink,
  Focus,
  GitBranch,
  Minus,
  Plus,
  RotateCcw,
  Variable,
} from "lucide-react";
import type {
  GalgameStoryBlock,
  GalgameStoryProject,
  GalgameStoryVariable,
} from "@features/galgame-workshop/api";
import { stableId } from "@features/galgame-workshop/editor/model";

type GraphNode = {
  id: string;
  kind: "chapter" | "fragment" | "logic";
  label: string;
  detail: string;
  x: number;
  y: number;
  chapterId: string;
  fragmentId?: string;
  blockId?: string;
};

type GraphEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  kind: "flow" | "branch" | "condition" | "call";
};

function targets(block: GalgameStoryBlock) {
  if (block.type === "branch")
    return block.choices.map((choice) => ({
      id: choice.targetFragmentId,
      label: choice.text || "选项",
      kind: "branch" as const,
    }));
  if (block.type === "if")
    return [
      { id: block.thenFragmentId, label: "满足", kind: "condition" as const },
      ...(block.elseFragmentId
        ? [
            {
              id: block.elseFragmentId,
              label: "否则",
              kind: "condition" as const,
            },
          ]
        : []),
    ];
  if (block.type === "callFragment")
    return [
      { id: block.targetFragmentId, label: "调用", kind: "call" as const },
    ];
  return [];
}

function variableReferenceCount(
  document: GalgameStoryProject,
  variableId: string,
) {
  let count = 0;
  for (const chapter of document.chapters ?? [])
    for (const fragment of chapter.fragments ?? [])
      for (const block of fragment.blocks ?? []) {
        if (block.type === "setVariable" && block.variableId === variableId)
          count += 1;
        if (block.type === "if" && block.condition.includes(variableId))
          count += 1;
      }
  return count;
}

function nextDefault(type: GalgameStoryVariable["type"]) {
  if (type === "number") return 0;
  if (type === "boolean") return false;
  return "";
}

export function NarrativeMapWorkspace({
  document,
  onDocument,
  onLocate,
}: {
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
  onLocate: (chapterId: string, fragmentId: string, blockId?: string) => void;
}) {
  const [tab, setTab] = useState<"variables" | "branches">("variables");
  const [scale, setScale] = useState(0.9);
  const [offset, setOffset] = useState({ x: 28, y: 28 });
  const [selectedNode, setSelectedNode] = useState<string>();
  const drag = useRef<
    { x: number; y: number; ox: number; oy: number } | undefined
  >(undefined);
  const { nodes, edges } = useMemo(() => {
    const nextNodes: GraphNode[] = [];
    const nextEdges: GraphEdge[] = [];
    const fragmentNode = new Map<string, string>();
    let y = 40;
    for (const chapter of [...(document.chapters ?? [])].sort(
      (a, b) => a.order - b.order,
    )) {
      const chapterNodeId = `chapter-${chapter.id}`;
      nextNodes.push({
        id: chapterNodeId,
        kind: "chapter",
        label: chapter.title,
        detail: chapter.disabled ? "已禁用" : `第 ${chapter.order} 章`,
        x: 40,
        y,
        chapterId: chapter.id,
      });
      const fragments = chapter.fragments ?? [];
      fragments.forEach((fragment, index) => {
        const id = `fragment-${chapter.id}-${fragment.id}`;
        fragmentNode.set(`${chapter.id}:${fragment.id}`, id);
        fragmentNode.set(fragment.id, id);
        const fragmentY = y + index * 118;
        nextNodes.push({
          id,
          kind: "fragment",
          label: fragment.title,
          detail: `${fragment.blocks?.length ?? 0} Blocks`,
          x: 300,
          y: fragmentY,
          chapterId: chapter.id,
          fragmentId: fragment.id,
        });
        nextEdges.push({
          id: `${chapterNodeId}-${id}`,
          from: chapterNodeId,
          to: id,
          kind: "flow",
          label: fragment.id === chapter.entryFragmentId ? "入口" : undefined,
        });
        let logicIndex = 0;
        for (const block of fragment.blocks ?? []) {
          if (
            !["branch", "if", "callFragment", "setVariable"].includes(
              block.type,
            )
          )
            continue;
          const logicId = `logic-${block.id}`;
          let blockLabel = "逻辑";
          if (block.type === "branch") blockLabel = "分支";
          else if (block.type === "if") blockLabel = "条件";
          else if (block.type === "callFragment") blockLabel = "调用";
          else if (block.type === "setVariable")
            blockLabel = `写入 ${block.variableId}`;
          nextNodes.push({
            id: logicId,
            kind: "logic",
            label: blockLabel,
            detail: block.id,
            x: 560,
            y: fragmentY + logicIndex * 82,
            chapterId: chapter.id,
            fragmentId: fragment.id,
            blockId: block.id,
          });
          logicIndex += 1;
          nextEdges.push({
            id: `${id}-${logicId}`,
            from: id,
            to: logicId,
            kind: "flow",
          });
          for (const target of targets(block))
            nextEdges.push({
              id: `${logicId}-${target.id}-${target.label}`,
              from: logicId,
              to: target.id,
              label: target.label,
              kind: target.kind,
            });
        }
      });
      y += Math.max(180, fragments.length * 118 + 70);
    }
    return {
      nodes: nextNodes,
      edges: nextEdges.map((edge) => ({
        ...edge,
        to: fragmentNode.get(edge.to) ?? edge.to,
      })),
    };
  }, [document]);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const connected = new Set<string>();
  if (selectedNode) {
    connected.add(selectedNode);
    for (const edge of edges)
      if (edge.from === selectedNode || edge.to === selectedNode) {
        connected.add(edge.from);
        connected.add(edge.to);
      }
  }
  const branchBlocks = (document.chapters ?? []).flatMap((chapter) =>
    (chapter.fragments ?? []).flatMap((fragment) =>
      (fragment.blocks ?? [])
        .filter((block) => block.type === "branch" || block.type === "if")
        .map((block) => ({ chapter, fragment, block })),
    ),
  );
  const updateVariable = (id: string, next: Partial<GalgameStoryVariable>) =>
    onDocument({
      ...document,
      variables: (document.variables ?? []).map((variable) =>
        variable.id === id ? { ...variable, ...next } : variable,
      ),
    });

  return (
    <div className="galgame-narrative-workspace">
      <aside className="galgame-narrative-sidebar">
        <nav aria-label="叙事数据">
          <button
            type="button"
            className={tab === "variables" ? "active" : ""}
            onClick={() => setTab("variables")}
          >
            <Variable aria-hidden /> 变量
          </button>
          <button
            type="button"
            className={tab === "branches" ? "active" : ""}
            onClick={() => setTab("branches")}
          >
            <GitBranch aria-hidden /> 分支选项
          </button>
        </nav>
        {tab === "variables" ? (
          <section>
            <header>
              <span>
                <small>VARIABLES</small>
                <strong>变量管理</strong>
              </span>
              <button
                type="button"
                aria-label="新增变量"
                onClick={() =>
                  onDocument({
                    ...document,
                    variables: [
                      ...(document.variables ?? []),
                      {
                        id: stableId(),
                        name: "新变量",
                        type: "string",
                        defaultValue: "",
                        persistence: "session",
                        description: "",
                      },
                    ],
                  })
                }
              >
                <Plus aria-hidden />
              </button>
            </header>
            {(document.variables ?? []).map((variable) => (
              <article key={variable.id}>
                <input
                  aria-label="变量名称"
                  value={variable.name}
                  onChange={(event) =>
                    updateVariable(variable.id, { name: event.target.value })
                  }
                />
                <div>
                  <select
                    aria-label="变量类型"
                    value={variable.type}
                    onChange={(event) => {
                      const type = event.target
                        .value as GalgameStoryVariable["type"];
                      updateVariable(variable.id, {
                        type,
                        defaultValue: nextDefault(type),
                      });
                    }}
                  >
                    <option value="string">文本</option>
                    <option value="number">数字</option>
                    <option value="boolean">布尔</option>
                  </select>
                  <select
                    aria-label="持久方式"
                    value={variable.persistence}
                    onChange={(event) =>
                      updateVariable(variable.id, {
                        persistence: event.target
                          .value as GalgameStoryVariable["persistence"],
                      })
                    }
                  >
                    <option value="session">当前存档</option>
                    <option value="project">跨存档</option>
                  </select>
                </div>
                {variable.type === "boolean" ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(variable.defaultValue)}
                      onChange={(event) =>
                        updateVariable(variable.id, {
                          defaultValue: event.target.checked,
                        })
                      }
                    />{" "}
                    默认开启
                  </label>
                ) : (
                  <input
                    aria-label="变量默认值"
                    type={variable.type === "number" ? "number" : "text"}
                    value={String(variable.defaultValue)}
                    onChange={(event) =>
                      updateVariable(variable.id, {
                        defaultValue:
                          variable.type === "number"
                            ? Number(event.target.value)
                            : event.target.value,
                      })
                    }
                  />
                )}
                <small>
                  {variableReferenceCount(document, variable.id)} 处引用 ·{" "}
                  {variable.id}
                </small>
              </article>
            ))}
          </section>
        ) : (
          <section className="galgame-branch-list">
            <header>
              <span>
                <small>ROUTES</small>
                <strong>分支与条件</strong>
              </span>
            </header>
            {branchBlocks.map(({ chapter, fragment, block }) => (
              <button
                type="button"
                key={block.id}
                onClick={() => onLocate(chapter.id, fragment.id, block.id)}
              >
                <GitBranch aria-hidden />
                <span>
                  <strong>
                    {block.type === "branch"
                      ? block.prompt || "未命名分支"
                      : block.condition}
                  </strong>
                  <small>
                    {chapter.title} / {fragment.title}
                  </small>
                </span>
                <ExternalLink aria-hidden />
              </button>
            ))}
          </section>
        )}
      </aside>
      <main className="galgame-narrative-canvas">
        <header>
          <span>
            <Braces aria-hidden />
            <strong>叙事地图</strong>
            <small>由 Story 文档实时派生</small>
          </span>
          <div>
            <button
              type="button"
              aria-label="缩小"
              onClick={() => setScale((value) => Math.max(0.45, value - 0.1))}
            >
              <Minus aria-hidden />
            </button>
            <output>{Math.round(scale * 100)}%</output>
            <button
              type="button"
              aria-label="放大"
              onClick={() => setScale((value) => Math.min(1.8, value + 0.1))}
            >
              <Plus aria-hidden />
            </button>
            <button
              type="button"
              title="适应画布"
              onClick={() => {
                setScale(0.9);
                setOffset({ x: 28, y: 28 });
              }}
            >
              <Focus aria-hidden />
            </button>
            <button
              type="button"
              title="重置高亮"
              onClick={() => setSelectedNode(undefined)}
            >
              <RotateCcw aria-hidden />
            </button>
          </div>
        </header>
        <div
          className="galgame-narrative-viewport"
          onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
            if ((event.target as Element).closest("button")) return;
            drag.current = {
              x: event.clientX,
              y: event.clientY,
              ox: offset.x,
              oy: offset.y,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            setOffset({
              x: drag.current.ox + event.clientX - drag.current.x,
              y: drag.current.oy + event.clientY - drag.current.y,
            });
          }}
          onPointerUp={() => {
            drag.current = undefined;
          }}
          onWheel={(event) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            setScale((value) =>
              Math.min(1.8, Math.max(0.45, value - event.deltaY * 0.001)),
            );
          }}
        >
          <svg
            width="1100"
            height={Math.max(720, ...nodes.map((node) => node.y + 120))}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            }}
          >
            <defs>
              <marker
                id="galgame-map-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const from = nodeById.get(edge.from);
              const to = nodeById.get(edge.to);
              if (!from || !to) return null;
              const active =
                !selectedNode ||
                (connected.has(edge.from) && connected.has(edge.to));
              const x1 = from.x + 176;
              const y1 = from.y + 36;
              const x2 = to.x;
              const y2 = to.y + 36;
              return (
                <g
                  key={edge.id}
                  className={`galgame-map-edge ${edge.kind}${active ? " active" : " muted"}`}
                >
                  <path
                    d={`M ${x1} ${y1} C ${x1 + 52} ${y1}, ${x2 - 52} ${y2}, ${x2} ${y2}`}
                    markerEnd="url(#galgame-map-arrow)"
                  />
                  {edge.label ? (
                    <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 7}>
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {nodes.map((node) => {
              const active = !selectedNode || connected.has(node.id);
              return (
                <foreignObject
                  key={node.id}
                  x={node.x}
                  y={node.y}
                  width="178"
                  height="74"
                >
                  <button
                    type="button"
                    className={`galgame-map-node ${node.kind}${active ? " active" : " muted"}${selectedNode === node.id ? " selected" : ""}`}
                    onClick={() => setSelectedNode(node.id)}
                    onDoubleClick={() =>
                      node.fragmentId &&
                      onLocate(node.chapterId, node.fragmentId, node.blockId)
                    }
                  >
                    <strong>{node.label}</strong>
                    <small>{node.detail}</small>
                  </button>
                </foreignObject>
              );
            })}
          </svg>
        </div>
      </main>
    </div>
  );
}
