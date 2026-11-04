import { LoadingState } from "@shared/ui/LoadingState";
import { ChevronRight, Folder } from "lucide-react";
import type { VisualCanvasNode, VisualMaterialCategory } from "../api";
import { BoardMenu } from "./BoardMenu";
import { OutputPreview } from "./OutputPreview";
import { nodeTypeNames } from "./boardTypes";
import {
  NodeManagementMenu,
  type NodeManagementAction,
} from "./NodeManagementMenu";
import { setCanvasAssetDragData } from "../canvas/canvasAssetDrag";
import { GenerationSpinner } from "../generation/GenerationActivity";
import { NodeApproval } from "../NodeApproval";

export type TreeAction = {
  kind: "category" | "rename" | "group";
  categoryId?: string;
  initialValue?: string;
};

export function MaterialTree({
  categories,
  nodes,
  selectedId,
  onSelect,
  onAction,
  onNodeAction,
  downloading,
  projectId,
  onUpload,
  uploadDisabled,
  runningNodeIds,
}: {
  categories: VisualMaterialCategory[];
  nodes: VisualCanvasNode[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onAction: (action: TreeAction) => void;
  onNodeAction?: (action: NodeManagementAction, node: VisualCanvasNode) => void;
  downloading?: boolean;
  projectId?: string;
  onUpload?: (categoryId: string) => void;
  uploadDisabled?: boolean;
  runningNodeIds?: ReadonlySet<string>;
}) {
  const entry = (node: VisualCanvasNode) => (
    <div
      key={node.id}
      className={`board-material-row ${selectedId === node.id ? "is-selected" : ""}`}
    >
      <button
        className="board-material"
        aria-pressed={selectedId === node.id}
        draggable={Boolean(projectId && node.kind !== "text" && node.asset_id)}
        title={
          node.kind !== "text" && node.asset_id
            ? "可拖入生成器参考素材框"
            : undefined
        }
        onDragStart={(event) => {
          if (!projectId || node.kind === "text" || !node.asset_id) {
            event.preventDefault();
            return;
          }
          event.stopPropagation();
          setCanvasAssetDragData(event.dataTransfer, {
            assetId: node.asset_id,
            mediaKind: node.kind,
            displayName: node.title,
            importMode: "none",
            sourceProjectId: projectId,
          });
        }}
        onClick={() => onSelect(node.id)}
      >
        <div
          className={`board-material-thumb${node.kind === "text" ? " is-text" : ""}`}
        >
          <OutputPreview
            kind={node.kind}
            assetId={node.kind !== "text" ? node.asset_id : undefined}
            text={node.kind === "text" ? node.text : undefined}
            compact
          />
        </div>
        <span>
          <strong title={node.title}>{node.title}</strong>
          <small>
            {nodeTypeNames[node.kind]} ·{" "}
            {runningNodeIds?.has(node.id) ? (
              <LoadingState variant="inline" label="生成中" />
            ) : node.final_version ? (
              `最终 v${node.final_version}`
            ) : (
              "暂无输出"
            )}
          </small>
        </span>
        <NodeApproval node={node} compact />
        {runningNodeIds?.has(node.id) ? (
          <span
            className="board-material-running"
            aria-label={`${node.title}生成中`}
          >
            <GenerationSpinner />
          </span>
        ) : (
          node.final_version && (
            <i className="board-material-ready" aria-label="已有最终输出" />
          )
        )}
      </button>
      {onNodeAction && (
        <NodeManagementMenu
          node={node}
          onAction={onNodeAction}
          downloading={downloading}
        />
      )}
    </div>
  );
  const uncategorized = nodes.filter((node) => !node.category_id);
  return (
    <div className="board-material-tree">
      {categories.map((category) => {
        const entries = nodes.filter(
          (node) => node.category_id === category.id,
        );
        const groups = [
          ...new Set([
            ...(category.groups ?? []),
            ...entries
              .map((node) => node.group)
              .filter((group): group is string => !!group),
          ]),
        ];
        const ungrouped = entries.filter((node) => !node.group);
        return (
          <div key={category.id} className="board-category-row">
            <details open={entries.length > 0} className="board-category">
              <summary>
                <ChevronRight size={14} />
                <Folder size={14} />
                <span>{category.name}</span>
                <small>{entries.length}</small>
              </summary>
              {!groups.length ? (
                entries.map(entry)
              ) : (
                <>
                  {groups.map((group) => (
                    <details open key={group} className="board-group">
                      <summary>
                        <ChevronRight size={12} />
                        {group}
                        <small>
                          {
                            entries.filter((node) => node.group === group)
                              .length
                          }
                        </small>
                      </summary>
                      {entries
                        .filter((node) => node.group === group)
                        .map(entry)}
                    </details>
                  ))}
                  {!!ungrouped.length && (
                    <details open className="board-group">
                      <summary>
                        <ChevronRight size={12} />
                        未分组<small>{ungrouped.length}</small>
                      </summary>
                      {ungrouped.map(entry)}
                    </details>
                  )}
                </>
              )}
            </details>
            <div className="board-category-menu">
              <BoardMenu
                label={`管理分类 ${category.name}`}
                items={[
                  ...(onUpload
                    ? [
                        {
                          label: "上传到此分类",
                          disabled: uploadDisabled,
                          onSelect: () => onUpload(category.id),
                        },
                      ]
                    : []),
                  {
                    label: "新建分组",
                    onSelect: () =>
                      onAction({ kind: "group", categoryId: category.id }),
                  },
                  {
                    label: "编辑分类",
                    onSelect: () =>
                      onAction({
                        kind: "rename",
                        categoryId: category.id,
                        initialValue: category.name,
                      }),
                  },
                ]}
              />
            </div>
          </div>
        );
      })}
      {!!uncategorized.length && (
        <details open className="board-category">
          <summary>
            <ChevronRight size={14} />
            <Folder size={14} />
            <span>未分类</span>
            <small>{uncategorized.length}</small>
          </summary>
          {uncategorized.map(entry)}
        </details>
      )}
    </div>
  );
}
