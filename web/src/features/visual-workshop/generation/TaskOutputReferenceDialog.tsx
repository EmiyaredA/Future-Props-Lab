import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { SearchablePickerField } from "@shared/ui/SearchablePickerDialog";
import { getNodeOutputs, type VisualCanvasEdge } from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import { canConnectCanvasNodes } from "../canvas/canvasGraph";
import { apiErrorMessage } from "@platform/api/errors";
import type { CanvasReferenceContext } from "./generationDrawerTypes";

export function TaskOutputReferenceDialog({
  projectId,
  nodeId,
  context,
  edge,
  onClose,
}: {
  projectId: string;
  nodeId: string;
  context: CanvasReferenceContext;
  edge?: VisualCanvasEdge;
  onClose: () => void;
}) {
  const [sourceId, setSourceId] = useState(edge?.source_node_id ?? "");
  const [binding, setBinding] = useState<"fixed" | "final">(
    edge?.binding ?? "final",
  );
  const [outputId, setOutputId] = useState(edge?.output_id ?? "");
  const [purpose, setPurpose] = useState<
    NonNullable<VisualCanvasEdge["purpose"]>
  >(edge?.purpose ?? "reference");
  const [error, setError] = useState("");
  const source = context.nodes.find((node) => node.id === sourceId);
  const history = useInfiniteQuery({
    queryKey: visualWorkshopQueryKeys.nodeOutputs(projectId, sourceId),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => getNodeOutputs(projectId, sourceId, pageParam),
    getNextPageParam: (last, pages) =>
      pages.flatMap((page) => page.items).length < last.total
        ? pages.length + 1
        : undefined,
    enabled: binding === "fixed" && Boolean(sourceId),
  });
  const save = () => {
    if (!source || (binding === "fixed" && !outputId)) return;
    const next: VisualCanvasEdge = {
      id: edge?.id ?? `edge-${crypto.randomUUID()}`,
      source_node_id: sourceId,
      target_node_id: nodeId,
      binding,
      output_id: binding === "fixed" ? outputId : null,
      purpose: source.kind === "text" ? "context" : purpose,
    };
    try {
      context.replaceEdges(
        (edges) =>
          edge
            ? edges.map((item) => (item.id === edge.id ? next : item))
            : [...edges, next],
        true,
      );
      onClose();
    } catch (failure) {
      setError(apiErrorMessage(failure));
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="reference-dialog-overlay" />
        <Dialog.Content
          className="reference-dialog"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <header>
            <Dialog.Title>
              {edge ? "管理输入引用" : "引用任务输出"}
            </Dialog.Title>
            <Dialog.Close aria-label="关闭引用设置">
              <X size={18} />
            </Dialog.Close>
          </header>
          <Dialog.Description>
            选择上游输出及绑定版本。跟随最终输出会在下次生成时使用更新后的版本。
          </Dialog.Description>
          <SearchablePickerField
            title="选择上游任务"
            value={sourceId}
            disabled={Boolean(edge)}
            searchLabel="搜索任务"
            items={context.nodes
              .filter(
                (node) =>
                  node.id !== nodeId &&
                  (edge?.source_node_id === node.id ||
                    canConnectCanvasNodes(
                      context.nodes,
                      context.edges,
                      node.id,
                      nodeId,
                    )),
              )
              .map((node) => ({
                id: node.id,
                label: node.title,
                detail: node.kind,
                disabled:
                  !node.final_output_id &&
                  !(node.kind !== "text" && node.asset_id),
              }))}
            onChange={(id) => {
              setSourceId(id);
              setOutputId("");
            }}
          />
          <CustomSelect
            ariaLabel="输入绑定方式"
            value={binding}
            onChange={(value) => setBinding(value as "fixed" | "final")}
            options={[
              { value: "final", label: "跟随最终输出" },
              { value: "fixed", label: "固定版本" },
            ]}
          />
          {binding === "fixed" && (
            <>
              <CustomSelect
                ariaLabel="固定历史版本"
                value={outputId}
                onChange={setOutputId}
                options={[
                  {
                    value: "",
                    label: history.isPending ? "读取版本中…" : "选择版本",
                  },
                  ...(
                    history.data?.pages.flatMap((page) => page.items) ?? []
                  ).map((item) => ({
                    value: item.id,
                    label: `v${item.version}${item.is_final ? " · 最终输出" : ""}`,
                  })),
                ]}
              />
              {history.isError && (
                <p role="alert">
                  {apiErrorMessage(history.error)}{" "}
                  <button type="button" onClick={() => void history.refetch()}>
                    重试
                  </button>
                </p>
              )}
              {history.hasNextPage && (
                <button
                  type="button"
                  disabled={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  加载更早版本
                </button>
              )}
            </>
          )}
          {source?.kind === "image" && (
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
          {error && <p role="alert">{error}</p>}
          <footer>
            {edge && (
              <button
                type="button"
                onClick={() => {
                  context.removeEdge(edge.id);
                  onClose();
                }}
              >
                移除引用
              </button>
            )}
            <button
              type="button"
              className="board-primary"
              disabled={!source || (binding === "fixed" && !outputId)}
              onClick={save}
            >
              {edge ? "保存引用" : "绑定输入"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
