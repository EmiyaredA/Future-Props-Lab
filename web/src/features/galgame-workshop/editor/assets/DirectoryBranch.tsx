import type { CSSProperties } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import type { DirectoryNode } from "@features/galgame-workshop/editor/assetOverviewModel";

export function DirectoryBranch({
  node,
  selected,
  expanded,
  depth,
  onSelect,
  onToggle,
}: {
  node: DirectoryNode;
  selected: string;
  expanded: Set<string>;
  depth: number;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const open = expanded.has(node.path);
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <div
        className={`galgame-assets-tree-row ${selected === node.path ? "active" : ""}`}
        style={{ "--tree-depth": depth } as CSSProperties}
      >
        <button
          type="button"
          className="galgame-assets-tree-toggle"
          aria-label={`${open ? "折叠" : "展开"}${node.name}`}
          disabled={!hasChildren}
          onClick={() => onToggle(node.path)}
        >
          {hasChildren ? (
            open ? (
              <ChevronDown aria-hidden />
            ) : (
              <ChevronRight aria-hidden />
            )
          ) : (
            <span />
          )}
        </button>
        <button type="button" onClick={() => onSelect(node.path)}>
          {open ? <FolderOpen aria-hidden /> : <Folder aria-hidden />}
          <span>{node.name}</span>
          <em>{node.count}</em>
        </button>
      </div>
      {open && hasChildren ? (
        <ul>
          {node.children.map((child) => (
            <DirectoryBranch
              key={child.path}
              node={child}
              selected={selected}
              expanded={expanded}
              depth={depth + 1}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
