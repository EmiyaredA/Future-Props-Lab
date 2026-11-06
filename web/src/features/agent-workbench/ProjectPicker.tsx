import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  registerProjectDirectory,
  type ExecutionCatalog,
  type ProjectChoice,
} from "./executionApi";
import { ProjectDirectoryTree } from "./ProjectDirectoryTree";
import { useProjectDirectories } from "./useProjectDirectories";
import "./project-picker.css";

export function ProjectPicker({
  owner,
  catalog,
  selected,
  disabled,
  onSelect,
}: {
  owner: string;
  catalog: ExecutionCatalog;
  selected?: ProjectChoice;
  disabled: boolean;
  onSelect: (project: ProjectChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [directory, setDirectory] = useState<string>();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  const listing = useProjectDirectories(
    owner,
    directory,
    !!directory && open && browsing,
  );
  const pastedPath = path.trim();
  const target =
    pastedPath ||
    (!listing.error && listing.data?.selectable ? directory : undefined);

  function close() {
    setOpen(false);
    setBrowsing(false);
    setDirectory(undefined);
    setPath("");
    setError("");
  }

  function changeView(next: boolean) {
    setError("");
    setDirectory(undefined);
    setPath("");
    setBrowsing(next);
    title.current?.focus();
  }

  async function choose(root: string) {
    setBusy(true);
    setError("");
    try {
      onSelect(await registerProjectDirectory(root));
      close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法选择此目录");
    } finally {
      setBusy(false);
    }
  }

  const recent = catalog.recent_projects ?? [];
  const recommended = (catalog.suggested_directories ?? []).filter(
    ({ root }) => !recent.some((item) => item.root === root),
  );

  const groups = [
    {
      label: "最近项目",
      items: recent.map((item) => ({
        ...item,
        key: item.root,
        select: () => void choose(item.root),
      })),
    },
    {
      label: "推荐项目",
      items: recommended.map((item) => ({
        ...item,
        key: item.root,
        select: () => void choose(item.root),
      })),
    },
    {
      label: "已配置项目",
      items: catalog.projects.map((item) => ({
        ...item,
        key: item.id,
        root: undefined,
        select: () => {
          onSelect(item);
          close();
        },
      })),
    },
  ].filter(({ items }) => items.length);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else if (!busy) close();
      }}
    >
      <Dialog.Trigger asChild>
        <button
          className="btn workbench-project-trigger"
          type="button"
          disabled={disabled}
        >
          <FolderOpen size={16} aria-hidden="true" />
          <span>{selected?.label ?? "选择项目"}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="workbench-project-overlay" />
        <Dialog.Content
          className="workbench-project-dialog"
          aria-busy={busy}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            title.current?.focus();
          }}
        >
          <header className="workbench-picker-header">
            <span className="workbench-picker-emblem">
              <FolderOpen size={20} aria-hidden="true" />
            </span>
            <div>
              <Dialog.Title ref={title} tabIndex={-1}>
                {browsing ? "选择项目目录" : "选择项目"}
              </Dialog.Title>
              <Dialog.Description>
                选择在这台 Mac 上运行会话的目录。
              </Dialog.Description>
            </div>
          </header>
          {browsing ? (
            <form
              className="workbench-picker-body"
              onSubmit={(event) => {
                event.preventDefault();
                if (target && !busy) void choose(target);
              }}
            >
              <div className="workbench-picker-toolbar">
                <button
                  className="workbench-picker-link"
                  type="button"
                  disabled={busy}
                  onClick={() => changeView(false)}
                >
                  <ArrowLeft size={14} aria-hidden="true" />
                  返回项目
                </button>
                <span>本机目录</span>
              </div>
              <ProjectDirectoryTree
                owner={owner}
                selected={directory}
                disabled={busy}
                onSelect={(root) => {
                  setDirectory(root);
                  setPath("");
                  setError("");
                }}
              />
              <div className="workbench-picker-location">
                <span>已选目录</span>
                {directory ? (
                  <code title={directory}>{directory}</code>
                ) : (
                  <span>点击目录名选中</span>
                )}
              </div>
              {directory &&
                !pastedPath &&
                (listing.isPending ? (
                  <p role="status">正在核对所选目录…</p>
                ) : listing.error || !listing.data.selectable ? (
                  <p role="alert">
                    {listing.error?.message ?? "无法使用此目录"}
                  </p>
                ) : null)}
              <label className="workbench-picker-path">
                或粘贴项目绝对路径
                <input
                  value={path}
                  onChange={(event) => {
                    setPath(event.target.value);
                    setError("");
                  }}
                  placeholder="/Users/…/my-project"
                  maxLength={4096}
                  disabled={busy}
                />
              </label>
              {error && <p role="alert">{error}</p>}
              <div className="workbench-project-actions">
                <Dialog.Close asChild>
                  <button className="btn" type="button" disabled={busy}>
                    取消
                  </button>
                </Dialog.Close>
                <button
                  className="btn workbench-project-primary"
                  type="submit"
                  disabled={busy || !target}
                >
                  {pastedPath ? "使用粘贴的路径" : "使用此目录"}
                </button>
              </div>
            </form>
          ) : (
            <div className="workbench-picker-body">
              <div className="workbench-picker-pane workbench-project-list">
                {groups.map(({ label, items }) => (
                  <section key={label} aria-label={label}>
                    <h3>{label}</h3>
                    {items.map((item) => (
                      <button
                        className="workbench-project-row"
                        type="button"
                        key={item.key}
                        disabled={busy}
                        onClick={item.select}
                      >
                        <Folder size={17} aria-hidden="true" />
                        <span>
                          {item.label}
                          {item.root && (
                            <small title={item.root}>{item.root}</small>
                          )}
                        </span>
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    ))}
                  </section>
                ))}
                {!groups.length && (
                  <p className="workbench-tree-message">
                    暂无项目，浏览本机目录以选择项目。
                  </p>
                )}
              </div>
              {error && <p role="alert">{error}</p>}
              <div className="workbench-project-actions">
                <Dialog.Close asChild>
                  <button className="btn" type="button" disabled={busy}>
                    取消
                  </button>
                </Dialog.Close>
                <button
                  className="btn workbench-project-primary"
                  type="button"
                  disabled={busy}
                  onClick={() => changeView(true)}
                >
                  <FolderOpen size={16} aria-hidden="true" />
                  <span>选择其他目录</span>
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
