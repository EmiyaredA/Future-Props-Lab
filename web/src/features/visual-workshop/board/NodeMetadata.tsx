import { useState } from "react";
import { Tags } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { VisualCanvasNode, VisualMaterialCategory } from "../api";
import type { BoardController } from "./boardTypes";
import { NodeApproval } from "../NodeApproval";

export function NodeMetadata({
  node,
  categories,
  onPatch,
  open: controlledOpen,
  onOpenChange,
}: {
  node: VisualCanvasNode;
  categories: VisualMaterialCategory[];
  onPatch: BoardController["patchNode"];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const category = categories.find(
    (category) => category.id === node.category_id,
  );
  return (
    <section className="board-node-metadata" aria-label="节点分类与标签">
      <div className="board-metadata-summary">
        <Tags size={14} />
        <span
          title={[category?.name ?? "未分类", node.group, ...(node.tags ?? [])]
            .filter(Boolean)
            .join(" · ")}
        >
          {category?.name ?? "未分类"}
          {node.group ? ` / ${node.group}` : ""}
          {node.tags?.length ? ` · ${node.tags.join("、")}` : ""}
        </span>
        <button onClick={() => setOpen(!open)} aria-expanded={open}>
          整理
        </button>
        <NodeApproval
          node={node}
          onChange={(approved) => onPatch(node.id, { approved }, true)}
        />
      </div>
      {open && (
        <div className="board-metadata-form">
          <div className="board-classification">
            <CustomSelect
              ariaLabel="节点主分类"
              value={node.category_id ?? ""}
              onChange={(value) =>
                onPatch(
                  node.id,
                  { category_id: value || null, group: null },
                  true,
                )
              }
              options={[
                { value: "", label: "未分类" },
                ...categories.map((category) => ({
                  value: category.id,
                  label: category.name,
                })),
              ]}
            />
            <CustomSelect
              ariaLabel="节点分组"
              value={node.group ?? ""}
              onChange={(value) =>
                onPatch(node.id, { group: value || null }, true)
              }
              options={[
                { value: "", label: "未分组" },
                ...[
                  ...new Set([
                    ...(category?.groups ?? []),
                    ...(node.group ? [node.group] : []),
                  ]),
                ].map((group) => ({ value: group, label: group })),
              ]}
            />
          </div>
          <label className="board-tags-label">
            附加标签
            <input
              aria-label="附加标签"
              placeholder="用逗号分隔，例如主角、清晨"
              defaultValue={(node.tags ?? []).join(", ")}
              onBlur={(event) =>
                onPatch(node.id, {
                  tags: [
                    ...new Set(
                      event.target.value
                        .split(/[,，]/)
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    ),
                  ],
                })
              }
            />
          </label>
          <small className="board-node-id">节点编号 {node.id}</small>
        </div>
      )}
    </section>
  );
}
