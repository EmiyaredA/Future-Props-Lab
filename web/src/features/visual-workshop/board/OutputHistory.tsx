import { useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Check, Eye, Upload } from "lucide-react";
import {
  getNodeOutputs,
  getNodeOutput,
  deleteNodeOutput,
  selectNodeFinalOutput,
  uploadNodeOutput,
  type VisualCanvasDocument,
  type VisualNodeOutput,
  type GenerationTask,
  type GenerationBatch,
} from "../api";
import { nodeGenerationActivity } from "../generation/generationActivityModel";
import {
  GenerationActivity,
  GenerationSpinner,
} from "../generation/GenerationActivity";
import { visualWorkshopQueryKeys } from "../queryKeys";
import { OutputPreview } from "./OutputPreview";
import type { BoardController } from "./boardTypes";

export function OutputHistory({
  controller,
  nodeId,
  preview,
  onPreview,
  tasks = [],
  batches = [],
}: {
  controller: BoardController;
  nodeId: string;
  preview?: VisualNodeOutput;
  onPreview: (version?: VisualNodeOutput) => void;
  tasks?: GenerationTask[];
  batches?: GenerationBatch[];
}) {
  const node = controller.nodes.find((node) => node.id === nodeId)!;
  const activity = nodeGenerationActivity(node, tasks, batches);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const history = useInfiniteQuery({
    queryKey: visualWorkshopQueryKeys.nodeOutputs(controller.projectId, nodeId),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      getNodeOutputs(controller.projectId, nodeId, pageParam),
    getNextPageParam: (last, pages) =>
      pages.flatMap((page) => page.items).length < last.total
        ? pages.length + 1
        : undefined,
  });
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const final = useQuery({
    queryKey: visualWorkshopQueryKeys.nodeOutput(
      controller.projectId,
      nodeId,
      node.final_output_id ?? "",
    ),
    queryFn: () =>
      getNodeOutput(controller.projectId, nodeId, node.final_output_id!),
    enabled: !!node.final_output_id,
  });
  const staleInputs = (final.data?.input_snapshot ?? []).some((input) => {
    const edge = controller.edges.find((edge) => edge.id === input.edge_id);
    const source = controller.nodes.find((node) => node.id === input.node_id);
    const current =
      edge?.binding === "fixed" ? edge.output_id : source?.final_output_id;
    return !edge || current !== input.output_id;
  });
  const showing =
    (preview && preview.node_id === nodeId ? preview : undefined) ??
    final.data ??
    items.find((item) => item.is_final);
  const mutate = async (
    action: (revision: number) => Promise<VisualCanvasDocument>,
  ) => {
    setPending(true);
    setError("");
    try {
      const revision = await controller.prepareCanvasForAgent();
      const updated = await action(revision);
      controller.client.setQueryData(
        visualWorkshopQueryKeys.canvas(controller.projectId),
        updated,
      );
      await history.refetch();
      await controller.client.invalidateQueries({
        queryKey: visualWorkshopQueryKeys.nodeOutputsProject(
          controller.projectId,
        ),
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "操作失败");
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      className={`board-output-panel${activity ? " is-generating" : ""}`}
      aria-label="节点输出历史"
    >
      <div className="board-output-heading">
        <div>
          <h2>输出预览</h2>
          {(!activity || showing) && (
            <div
              className="board-preview-badges"
              aria-label={`当前预览 ${showing ? `v${showing.version}` : "—"} · 最终输出 ${node.final_version ? `v${node.final_version}` : "未设置"}`}
            >
              <span className="board-preview-badge">
                <Eye size={12} />
                正在预览 {showing ? `v${showing.version}` : "—"}
              </span>
              <span className="board-final-badge">
                <Check size={12} />
                最终输出{" "}
                {node.final_version ? `v${node.final_version}` : "未设置"}
              </span>
            </div>
          )}
        </div>
        {activity && (
          <span className="board-state-badge is-running">
            <GenerationSpinner size={12} />
            生成中
          </span>
        )}
        {showing && showing.id !== node.final_output_id && (
          <button
            disabled={pending}
            onClick={() =>
              void mutate((revision) =>
                selectNodeFinalOutput(
                  controller.projectId,
                  nodeId,
                  showing.id,
                  revision,
                ),
              )
            }
          >
            设为最终输出
          </button>
        )}
      </div>
      {staleInputs && (
        <p className="board-muted" role="status">
          已有结果使用了旧的输入版本；下次生成将使用当前绑定的输入。
        </p>
      )}
      <div className="board-large-preview">
        {activity && !showing && node.kind !== "text" && !node.asset_id ? (
          <div
            className="board-generating-placeholder"
            aria-label="等待生成画面"
          >
            <GenerationSpinner size={24} />
            <span>等待生成画面</span>
          </div>
        ) : (
          <OutputPreview
            kind={node.kind}
            assetId={
              showing?.asset_id ??
              (node.kind !== "text" ? node.asset_id : undefined)
            }
            text={showing?.text}
          />
        )}
      </div>
      {activity && <GenerationActivity activity={activity} />}
      <div className="board-output-heading">
        <h3>
          输出版本 <small>{history.data?.pages[0].total ?? 0}</small>
        </h3>
        {node.kind !== "text" && (
          <div>
            <button
              className="board-upload"
              disabled={pending}
              onClick={() => uploadInput.current?.click()}
            >
              <Upload size={15} /> 上传版本
            </button>
            <input
              ref={uploadInput}
              hidden
              type="file"
              disabled={pending}
              accept={`${node.kind}/*`}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file)
                  void mutate((revision) =>
                    uploadNodeOutput(
                      controller.projectId,
                      nodeId,
                      file,
                      revision,
                    ),
                  );
              }}
            />
          </div>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {history.isError && (
        <p role="alert">
          历史加载失败{" "}
          <button onClick={() => void history.refetch()}>重试</button>
        </p>
      )}
      <div className="board-version-list">
        {items.map((item) => (
          <button
            key={item.id}
            aria-pressed={showing?.id === item.id}
            className={showing?.id === item.id ? "is-preview" : ""}
            onClick={() => onPreview(item)}
          >
            <div className="board-version-thumb">
              <OutputPreview
                kind={item.kind}
                assetId={item.asset_id}
                text={item.text}
                compact
              />
            </div>
            <span>
              <strong>
                v{item.version}{" "}
                {item.id === node.final_output_id && <em>最终输出</em>}
              </strong>
              <small>{outputSource(item.source)}</small>
            </span>
          </button>
        ))}
      </div>
      {history.hasNextPage && (
        <button
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          加载更早版本
        </button>
      )}
      {showing && (
        <div className="board-version-details">
          <span>
            {outputSource(showing.source)} ·{" "}
            {new Date(showing.created_at).toLocaleString("zh-CN")}
          </span>
          {showing.id !== node.final_output_id && (
            <>
              <button onClick={() => onPreview(undefined)}>返回最终版本</button>
              <button
                disabled={pending}
                onClick={() =>
                  void mutate(async (revision) => {
                    const updated = await deleteNodeOutput(
                      controller.projectId,
                      nodeId,
                      showing.id,
                      revision,
                    );
                    onPreview(undefined);
                    return updated;
                  })
                }
              >
                删除当前历史版本
              </button>
            </>
          )}
        </div>
      )}
      {!history.isLoading && !items.length && (
        <p className="board-muted">生成或上传素材后，版本将在这里保留。</p>
      )}
    </section>
  );
}

function outputSource(source: VisualNodeOutput["source"]) {
  return source === "generated"
    ? "生成"
    : source === "text"
      ? "文本保存"
      : source === "uploaded"
        ? "上传"
        : "历史素材";
}
