import { useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Check, Eye, Trash2, Upload } from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
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
  const [deleteTarget, setDeleteTarget] = useState<VisualNodeOutput>();
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
    items.find((item) => item.id === node.final_output_id);
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
              <Upload size={15} /> {pending ? "正在处理…" : "上传版本"}
            </button>
            <input
              ref={uploadInput}
              hidden
              type="file"
              disabled={pending}
              aria-label="上传输出版本"
              accept={
                node.kind === "video"
                  ? "video/*,image/gif,.gif"
                  : `${node.kind}/*`
              }
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
      {node.kind === "video" && (
        <p className="board-muted">
          支持视频和 GIF；GIF 转为无声 MP4，透明区域使用黑底。
        </p>
      )}
      {error && !deleteTarget && <p role="alert">{error}</p>}
      {history.isError && (
        <p role="alert">
          历史加载失败{" "}
          <button onClick={() => void history.refetch()}>重试</button>
        </p>
      )}
      <div className="board-version-list">
        {items.map((item) => (
          <div key={item.id} className="board-version-entry">
            <button
              aria-pressed={showing?.id === item.id}
              className={`board-version-select${showing?.id === item.id ? " is-preview" : ""}`}
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
            {item.source === "uploaded" && (
              <button
                className="board-version-delete"
                aria-label={`删除上传版本 v${item.version}`}
                disabled={pending}
                onClick={() => {
                  setError("");
                  setDeleteTarget(item);
                }}
              >
                <Trash2 size={12} /> 删除
              </button>
            )}
          </div>
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
                onClick={() => {
                  setError("");
                  setDeleteTarget(showing);
                }}
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
      <ConfirmDialog
        open={!!deleteTarget}
        title={`删除输出版本 v${deleteTarget?.version ?? ""}`}
        description={
          <>
            <p>
              确认删除此版本？项目素材中的原文件仍会保留。被固定引用的版本需先解除引用。
              {deleteTarget?.id === node.final_output_id &&
                "此版本是最终输出，删除后将使用剩余的最新版本；没有剩余版本时清空输出。"}
            </p>
            {error && <p role="alert">{error}</p>}
          </>
        }
        confirmLabel="删除版本"
        pending={pending}
        onCancel={() => setDeleteTarget(undefined)}
        onConfirm={() => {
          if (!deleteTarget) return;
          return mutate(async (revision) => {
            const updated = await deleteNodeOutput(
              controller.projectId,
              nodeId,
              deleteTarget.id,
              revision,
            );
            if (showing?.id === deleteTarget.id) onPreview(undefined);
            setDeleteTarget(undefined);
            return updated;
          });
        }}
      />
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
