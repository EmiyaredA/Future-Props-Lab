import { ChevronRight, Folder, FolderOpen, HardDrive } from "lucide-react";
import { useId, useState, type CSSProperties } from "react";
import { useProjectDirectories } from "./useProjectDirectories";

type TreeProps = {
  owner: string;
  selected?: string;
  disabled: boolean;
  onSelect: (root: string) => void;
};

type BranchProps = TreeProps & {
  parent?: string;
  depth: number;
  id?: string;
};

function DirectoryBranch({
  owner,
  parent,
  depth,
  id,
  selected,
  disabled,
  onSelect,
}: BranchProps) {
  const directories = useProjectDirectories(owner, parent);

  return (
    <div id={id}>
      {directories.isPending ? (
        <p className="workbench-tree-message" role="status">
          正在读取目录…
        </p>
      ) : directories.error ? (
        <div className="workbench-tree-message">
          <p role="alert">{directories.error.message}</p>
          <button
            className="workbench-picker-link"
            type="button"
            disabled={disabled || directories.isFetching}
            onClick={() => void directories.refetch()}
          >
            重试
          </button>
        </div>
      ) : directories.data.items.length ? (
        <ul className="workbench-directory-tree">
          {directories.data.items.map((item) => (
            <DirectoryRow
              key={item.root}
              item={item}
              depth={depth}
              owner={owner}
              selected={selected}
              disabled={disabled}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : (
        <p className="workbench-tree-message">没有可浏览的子目录</p>
      )}
    </div>
  );
}

function DirectoryRow({
  item,
  depth,
  ...tree
}: TreeProps & { item: { root: string; label: string }; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const branchId = useId();
  const Icon = depth === 0 ? HardDrive : expanded ? FolderOpen : Folder;
  const selected = tree.selected === item.root;

  return (
    <li>
      <div
        className="workbench-tree-row"
        data-selected={selected}
        style={{ "--tree-depth": depth } as CSSProperties}
      >
        <button
          className="workbench-tree-toggle"
          type="button"
          aria-label={`${expanded ? "折叠" : "展开"} ${item.label}`}
          aria-expanded={expanded}
          aria-controls={expanded ? branchId : undefined}
          disabled={tree.disabled}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <button
          className="workbench-tree-label"
          type="button"
          title={item.root}
          aria-pressed={depth === 0 ? undefined : selected}
          disabled={tree.disabled}
          onClick={() => {
            if (depth === 0) setExpanded(!expanded);
            else tree.onSelect(item.root);
          }}
        >
          <Icon size={16} aria-hidden="true" />
          <span>{item.label}</span>
        </button>
      </div>
      {expanded && (
        <DirectoryBranch
          {...tree}
          id={branchId}
          parent={item.root}
          depth={depth + 1}
        />
      )}
    </li>
  );
}

export function ProjectDirectoryTree(props: TreeProps) {
  return (
    <section className="workbench-picker-pane" aria-label="本机目录">
      <DirectoryBranch {...props} depth={0} />
    </section>
  );
}
