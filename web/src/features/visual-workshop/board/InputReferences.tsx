import { useState } from "react";
import { useInfiniteQuery, useQueries } from "@tanstack/react-query";
import { Link2, Lock, Plus, X } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { getNodeOutput, getNodeOutputs, type VisualCanvasEdge } from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import { canConnectCanvasNodes } from "../canvas/canvasGraph";
import { nodeTypeNames, type BoardController } from "./boardTypes";

export function InputReferences({
  controller,
  nodeId,
}: {
  controller: BoardController;
  nodeId: string;
}) {
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [binding, setBinding] = useState<"final" | "fixed">("final");
  const [outputId, setOutputId] = useState("");
  const [purpose, setPurpose] =
    useState<NonNullable<VisualCanvasEdge["purpose"]>>("reference");
  const target = controller.nodes.find((node) => node.id === nodeId)!;
  const source = controller.nodes.find((node) => node.id === sourceId);
  const history = useInfiniteQuery({
    queryKey: visualWorkshopQueryKeys.nodeOutputs(
      controller.projectId,
      sourceId,
    ),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      getNodeOutputs(controller.projectId, sourceId, pageParam),
    getNextPageParam: (last, pages) =>
      pages.flatMap((page) => page.items).length < last.total
        ? pages.length + 1
        : undefined,
    enabled: open && binding === "fixed" && !!sourceId,
  });
  const incoming = controller.edges.filter(
    (edge) => edge.target_node_id === nodeId,
  );
  const boundVersions = useQueries({
    queries: incoming.map((edge) => {
      const upstream = controller.nodes.find(
        (node) => node.id === edge.source_node_id,
      );
      const id =
        edge.binding === "fixed" ? edge.output_id : upstream?.final_output_id;
      return {
        queryKey: visualWorkshopQueryKeys.nodeOutput(
          controller.projectId,
          edge.source_node_id,
          id ?? "",
        ),
        queryFn: () =>
          getNodeOutput(controller.projectId, edge.source_node_id, id!),
        enabled: !!id,
      };
    }),
  });
  const add = () => {
    if (
      !source ||
      !source.final_output_id ||
      (binding === "fixed" && !outputId)
    )
      return;
    const edge: VisualCanvasEdge = {
      id: `edge-${crypto.randomUUID()}`,
      source_node_id: sourceId,
      target_node_id: nodeId,
      binding,
      output_id: binding === "fixed" ? outputId : null,
      purpose: source.kind === "text" ? "context" : purpose,
    };
    controller.replaceEdges((edges) => [...edges, edge], true);
    setOpen(false);
    setSourceId("");
    setOutputId("");
  };
  return (
    <section className="board-inputs" aria-label="输入引用">
      <div className="board-output-heading">
        <h3>
          输入素材 <small>{incoming.length}</small>
        </h3>
        <button onClick={() => setOpen(!open)} aria-expanded={open}>
          <Plus size={15} /> 引用任务输出
        </button>
      </div>
      {incoming.map((edge, index) => {
        const upstream = controller.nodes.find(
          (node) => node.id === edge.source_node_id,
        );
        return (
          <div className="board-input-row" key={edge.id}>
            <Link2 size={15} />
            <span>
              <strong>{upstream?.title ?? "节点不存在"}</strong>
              <small>
                {edge.binding === "fixed" ? (
                  <>
                    <Lock size={11} /> 固定版本 ·{" "}
                    {boundVersions[index].data
                      ? `v${boundVersions[index].data.version}`
                      : "加载中"}
                  </>
                ) : (
                  `跟随最终输出 · ${upstream?.final_version ? `v${upstream.final_version}` : "等待输出"}`
                )}
              </small>
            </span>
            <button
              aria-label={`移除输入 ${upstream?.title}`}
              onClick={() =>
                controller.replaceEdges(
                  (edges) => edges.filter((item) => item.id !== edge.id),
                  true,
                )
              }
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
      {!incoming.length && (
        <p className="board-muted">引用其他节点的文本或素材作为创作输入。</p>
      )}
      {open && (
        <div className="board-reference-picker" aria-label="任务输出选择器">
          <CustomSelect
            ariaLabel="选择上游任务"
            value={sourceId}
            onChange={(value) => {
              setSourceId(value);
              setOutputId("");
              setPurpose("reference");
            }}
            options={[
              { value: "", label: "选择任务输出" },
              ...controller.nodes
                .filter((node) => node.id !== nodeId)
                .map((node) => ({
                  value: node.id,
                  label: `${node.title} · ${nodeTypeNames[node.kind]}${node.final_version ? ` · v${node.final_version}` : " · 暂无输出"}`,
                  disabled:
                    !node.final_output_id ||
                    !canConnectCanvasNodes(
                      controller.nodes,
                      controller.edges,
                      node.id,
                      nodeId,
                    ),
                })),
            ]}
          />
          <div
            className="board-binding-modes"
            role="group"
            aria-label="输入绑定方式"
          >
            <button
              aria-pressed={binding === "final"}
              onClick={() => setBinding("final")}
            >
              跟随最终输出
            </button>
            <button
              aria-pressed={binding === "fixed"}
              onClick={() => setBinding("fixed")}
            >
              固定版本
            </button>
          </div>
          {binding === "fixed" && (
            <CustomSelect
              ariaLabel="固定历史版本"
              value={outputId}
              onChange={setOutputId}
              options={[
                { value: "", label: "选择版本" },
                ...(
                  history.data?.pages.flatMap((page) => page.items) ?? []
                ).map((item) => ({
                  value: item.id,
                  label: `v${item.version} · ${item.source === "generated" ? "生成" : "上传 / 保存"}${item.is_final ? " · 最终输出" : ""}`,
                })),
              ]}
            />
          )}
          {binding === "fixed" && history.hasNextPage && (
            <button
              onClick={() => void history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
            >
              加载更早版本
            </button>
          )}
          {target.kind === "video" && source?.kind === "image" && (
            <CustomSelect
              ariaLabel="输入用途"
              value={purpose}
              onChange={(value) => setPurpose(value as typeof purpose)}
              options={[
                { value: "reference", label: "参考图" },
                { value: "first_frame", label: "首帧" },
                { value: "last_frame", label: "尾帧" },
              ]}
            />
          )}
          <p className="board-muted">
            {binding === "final"
              ? "上游最终版本更新后，下次生成使用新版本。"
              : "保持选定的历史版本，不随上游更新。"}
          </p>
          <button
            className="board-primary"
            disabled={
              !source?.final_output_id || (binding === "fixed" && !outputId)
            }
            onClick={add}
          >
            绑定输入
          </button>
        </div>
      )}
    </section>
  );
}
