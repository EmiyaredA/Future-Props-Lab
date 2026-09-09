import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder as FolderIcon,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { Directory, Folder, Move } from "./knowledgeApi";
import type { NoteSummary } from "./api";
export type TreeItem =
  { kind: "folder"; value: Folder } | { kind: "document"; value: NoteSummary };
export function KnowledgeTree({
  directory,
  activeId,
  open,
  action,
  move,
}: {
  directory: Directory;
  activeId?: string;
  open: (id: string) => void;
  action: (action: string, item: TreeItem) => void;
  move: (body: Omit<Move, "expected_revision">) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<TreeItem | null>(null);
  const branch = (parent: string | null, depth = 0) => {
    const items: TreeItem[] = [
      ...directory.folders
        .filter((f) => f.parent_id === parent)
        .map((value) => ({ kind: "folder" as const, value })),
      ...directory.documents
        .filter((n) => n.folder_id === parent)
        .map((value) => ({ kind: "document" as const, value })),
    ];
    items.sort(
      (a, b) =>
        a.value.position - b.value.position ||
        a.value.id.localeCompare(b.value.id),
    );
    return items.map((item) => (
      <div key={item.value.id}>
        <div
          className={`knowledge-tree-row ${activeId === item.value.id ? "active" : ""}`}
          style={{ paddingLeft: Math.min(depth, 6) * 13 }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", item.value.id);
            setDrag(item);
          }}
          onDragEnd={() => setDrag(null)}
          onDragOver={(e) => {
            if (drag) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (drag)
              move({
                kind: drag.kind,
                item_id: drag.value.id,
                parent_id: parent,
                before_id: item.value.id,
              });
            setDrag(null);
          }}
        >
          <button
            className="knowledge-tree-name"
            title={item.value.title}
            aria-current={activeId === item.value.id ? "page" : undefined}
            aria-expanded={
              item.kind === "folder" ? !collapsed.has(item.value.id) : undefined
            }
            onClick={() => {
              if (item.kind === "document") open(item.value.id);
              else
                setCollapsed((old) => {
                  const next = new Set(old);
                  if (next.has(item.value.id)) next.delete(item.value.id);
                  else next.add(item.value.id);
                  return next;
                });
            }}
          >
            {item.kind === "folder" ? (
              <>
                {collapsed.has(item.value.id) ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
                <FolderIcon size={16} />
              </>
            ) : (
              <FileText size={16} />
            )}
            <span>{item.value.title}</span>
          </button>
          <CustomSelect
            escapeClipping
            ariaLabel={`${item.value.title}操作`}
            value=""
            options={[
              { value: "", label: "···", disabled: true },
              ...(item.kind === "folder"
                ? [
                    { value: "new-document", label: "新建文档" },
                    { value: "new-folder", label: "新建子文件夹" },
                    { value: "rename", label: "重命名" },
                  ]
                : []),
              { value: "move", label: "移动到…" },
              { value: "up", label: "上移" },
              { value: "down", label: "下移" },
              { value: "delete", label: "删除" },
            ]}
            onChange={(value) => {
              if (value === "up" || value === "down") {
                const index = items.findIndex(
                  (i) => i.value.id === item.value.id,
                );
                const target = value === "up" ? index - 1 : index + 2;
                if (
                  (value === "up" && index === 0) ||
                  (value === "down" && index === items.length - 1)
                )
                  return;
                move({
                  kind: item.kind,
                  item_id: item.value.id,
                  parent_id: parent,
                  before_id: items[target]?.value.id ?? null,
                });
              } else action(value, item);
            }}
          />
        </div>
        {item.kind === "folder" &&
          !collapsed.has(item.value.id) &&
          branch(item.value.id, depth + 1)}
      </div>
    ));
  };
  return (
    <nav
      aria-label="知识库目录"
      className="knowledge-tree"
      onDragOver={(e) => {
        if (drag) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (drag)
          move({ kind: drag.kind, item_id: drag.value.id, parent_id: null });
        setDrag(null);
      }}
    >
      {branch(null)}
      {!directory.documents.length && !directory.folders.length && (
        <p className="knowledge-empty-tree">
          还没有文档
          <br />
          从一个想法开始，建立你的知识库。
        </p>
      )}
    </nav>
  );
}
