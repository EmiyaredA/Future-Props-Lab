import { Link2, LoaderCircle, Play } from "lucide-react";
import { statusIcons, statusKeys, typeIcons } from "./boardPresentation";
import type { GenerationBatch, GenerationTask, VisualCanvasNode } from "../api";
import {
  boardStatuses,
  nodeStatus,
  nodeTypeNames,
  type BoardController,
  type BoardStatus,
} from "./boardTypes";
import { OutputPreview } from "./OutputPreview";

function StatusCard({
  node,
  status,
  controller: c,
  tasks,
  batches,
  onSelect,
}: {
  node: VisualCanvasNode;
  status: BoardStatus;
  controller: BoardController;
  tasks: GenerationTask[];
  batches: GenerationBatch[];
  onSelect: (id: string) => void;
}) {
  const task =
    node.kind !== "text"
      ? (tasks.find(
          (task) =>
            task.canvas_node_id === node.id &&
            ["queued", "submitting", "pending", "processing"].includes(
              task.status,
            ),
        ) ?? tasks.find((task) => task.id === node.generation_task_id))
      : undefined;
  const batch =
    node.kind === "image"
      ? (batches.find(
          (batch) =>
            batch.generation_node_id === node.id &&
            ["queued", "processing"].includes(batch.status),
        ) ?? batches.find((batch) => batch.id === node.generation_batch_id))
      : undefined;
  const progress = Math.max(
    0,
    Math.min(
      100,
      batch?.grid_output === "composite" && batch.generation_node_id === node.id
        ? Math.round((100 * batch.completed_count) / batch.grid_size)
        : (task?.progress ?? 0),
    ),
  );
  const failure =
    status !== "生成中" &&
    (task?.status === "failed" || batch?.status === "failed");
  const error = failure
    ? (task?.error_message ?? batch?.error_message ?? "生成失败，请调整后重试")
    : undefined;
  const upstream = c.edges
    .filter((edge) => edge.target_node_id === node.id)
    .map((edge) => ({
      edge,
      node: c.nodes.find((source) => source.id === edge.source_node_id),
    }));
  const missing = upstream
    .filter(
      ({ edge, node }) => edge.binding !== "fixed" && !node?.final_output_id,
    )
    .map(({ node }) => node?.title ?? "上游节点");
  const description =
    status === "待准备"
      ? missing.length
        ? `等待 ${missing.join("、")} 输出`
        : node.kind === "text"
          ? "填写文本并保存版本"
          : !node.generation_draft?.model_id
            ? "选择生成模型"
            : "补充提示词"
      : status === "可生成"
        ? node.kind === "text"
          ? "文本待保存版本"
          : "输入已就绪"
        : "";
  const category =
    c.canvasQuery.data?.categories?.find(
      (category) => category.id === node.category_id,
    )?.name ?? "未分类";
  const tags = [category, ...(node.tags ?? [])];
  const Icon = typeIcons[node.kind];
  const phase =
    batch?.status === "queued" || task?.status === "queued"
      ? "排队中"
      : task?.status === "submitting"
        ? "提交中"
        : "生成中";
  return (
    <article
      data-kind={node.kind}
      className={`board-task-card is-${statusKeys[status]}${error ? " has-error" : ""}`}
    >
      <button
        className="board-card-open"
        aria-label={`打开任务 ${node.title}`}
        onClick={() => onSelect(node.id)}
      >
        <div className="board-card-preview">
          <OutputPreview
            kind={node.kind}
            assetId={node.kind !== "text" ? node.asset_id : undefined}
            text={node.kind === "text" ? node.text : undefined}
            compact
          />
        </div>
        <div className="board-card-identity">
          <strong>{node.title}</strong>
          <span className="board-card-kind">
            <Icon size={12} />
            {nodeTypeNames[node.kind]}
            <span>·</span>
            {node.final_version ? `最终 v${node.final_version}` : "暂无输出"}
          </span>
        </div>
      </button>
      <div className="board-card-body">
        <div className="board-card-tags">
          {tags.slice(0, 2).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
          {tags.length > 2 && (
            <details>
              <summary>+{tags.length - 2}</summary>
              <div>{tags.slice(2).join(" · ")}</div>
            </details>
          )}
        </div>
        {description && <p className="board-card-description">{description}</p>}
        {status === "生成中" && (
          <div className="board-progress">
            <div>
              <span>
                <LoaderCircle size={12} className="spinning" />
                {phase}
              </span>
              <strong>{progress}%</strong>
            </div>
            <progress
              aria-label={`${node.title}生成进度`}
              max={100}
              value={progress}
            />
          </div>
        )}
        {!!upstream.length && (
          <details className="board-card-inputs">
            <summary>
              <Link2 size={12} />
              <span>
                {upstream
                  .slice(0, 2)
                  .map(({ node }) => node?.title ?? "节点不存在")
                  .join(" ＋ ")}
                {upstream.length > 2 ? ` 等 ${upstream.length} 项` : ""}
              </span>
            </summary>
            <div>
              {upstream.map(({ edge, node }) => (
                <p key={edge.id}>
                  {node?.title ?? "节点不存在"} ·{" "}
                  {edge.binding === "fixed"
                    ? "固定版本"
                    : `跟随最终输出${node?.final_version ? ` v${node.final_version}` : ""}`}
                </p>
              ))}
            </div>
          </details>
        )}
        {error && (
          <div className="board-card-error">
            <details>
              <summary>{error}</summary>
              <p>{error}</p>
            </details>
            <button onClick={() => onSelect(node.id)}>
              <Play size={12} />
              调整并重试
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export function StatusBoard({
  controller,
  nodes,
  tasks,
  batches,
  ready,
  onSelect,
}: {
  controller: BoardController;
  nodes: VisualCanvasNode[];
  tasks: GenerationTask[];
  batches: GenerationBatch[];
  ready: (id: string) => boolean;
  onSelect: (id: string) => void;
}) {
  const grouped = nodes.map((node) => ({
    node,
    status: nodeStatus(node, tasks, ready(node.id), batches),
  }));
  return (
    <div className="board-status-grid">
      {boardStatuses.map((status) => {
        const items = grouped.filter((item) => item.status === status);
        const Icon = statusIcons[status];
        return (
          <section
            key={status}
            className={`board-status-column is-${statusKeys[status]}`}
            aria-label={`${status}任务`}
          >
            <h2>
              <Icon size={15} />
              <span>{status}</span>
              <small>{items.length}</small>
            </h2>
            <div className="board-status-list">
              {items.map(({ node }) => (
                <StatusCard
                  key={node.id}
                  node={node}
                  status={status}
                  controller={controller}
                  tasks={tasks}
                  batches={batches}
                  onSelect={onSelect}
                />
              ))}
              {!items.length && (
                <p className="board-column-empty">暂无{status}任务</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
