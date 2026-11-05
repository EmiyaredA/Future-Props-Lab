import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronRight, FolderOpen } from "lucide-react";
import { useState } from "react";
import {
  browseProjectDirectories,
  registerProjectDirectory,
  type ExecutionCatalog,
  type ProjectChoice,
} from "./executionApi";
import { workbenchKeys } from "./queryKeys";
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
  const [parent, setParent] = useState<string>();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const directories = useQuery({
    queryKey: workbenchKeys.directories(owner, parent),
    queryFn: ({ signal }) => browseProjectDirectories(parent, signal),
    enabled: open && browsing,
    retry: false,
  });

  function close() {
    setOpen(false);
    setBrowsing(false);
    setParent(undefined);
    setPath("");
    setError("");
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
          <FolderOpen size={15} aria-hidden="true" />
          <span>{selected?.label ?? "选择项目"}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="workbench-project-overlay" />
        <Dialog.Content className="workbench-project-dialog" aria-busy={busy}>
          <header>
            <Dialog.Title>
              {browsing ? "选择项目目录" : "选择项目"}
            </Dialog.Title>
            <Dialog.Description>
              选择在这台 Mac 上运行会话的目录。
            </Dialog.Description>
          </header>
          {browsing ? (
            <>
              <div className="workbench-directory-location">
                <button
                  className="btn"
                  type="button"
                  aria-label="返回上一级"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    if (parent)
                      setParent(directories.data?.parent ?? undefined);
                    else setBrowsing(false);
                  }}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                </button>
                <code>{parent ?? "这台 Mac"}</code>
              </div>
              <div className="workbench-project-list" aria-label="子目录">
                {directories.isPending ? (
                  <p role="status">正在读取目录…</p>
                ) : directories.error ? (
                  <p role="alert">{directories.error.message}</p>
                ) : directories.data?.items.length ? (
                  directories.data.items.map((item) => (
                    <button
                      className="btn"
                      type="button"
                      key={item.root}
                      disabled={busy}
                      onClick={() => {
                        setParent(item.root);
                        setError("");
                      }}
                    >
                      <FolderOpen size={16} aria-hidden="true" />
                      <span>{item.label}</span>
                      <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  ))
                ) : (
                  <p>没有可浏览的子目录。</p>
                )}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (path && !busy) void choose(path);
                }}
              >
                <label>
                  或粘贴项目绝对路径
                  <input
                    value={path}
                    onChange={(event) => setPath(event.target.value)}
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
                    className="btn"
                    type="button"
                    disabled={busy || !directories.data?.selectable || !!path}
                    onClick={() => parent && void choose(parent)}
                  >
                    使用此目录
                  </button>
                  <button
                    className="btn workbench-project-primary"
                    type="submit"
                    disabled={busy || !path}
                  >
                    使用粘贴的路径
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div className="workbench-project-list">
                {[
                  { label: "最近项目", items: recent },
                  { label: "推荐项目", items: recommended },
                ].map(
                  ({ label, items }) =>
                    items.length > 0 && (
                      <section key={label} aria-label={label}>
                        <h3>{label}</h3>
                        {items.map((item) => (
                          <button
                            className="btn"
                            type="button"
                            key={item.root}
                            disabled={busy}
                            onClick={() => void choose(item.root)}
                          >
                            <FolderOpen size={16} aria-hidden="true" />
                            <span>
                              {item.label}
                              <small>{item.root}</small>
                            </span>
                          </button>
                        ))}
                      </section>
                    ),
                )}
                {catalog.projects.length > 0 && (
                  <section aria-label="已配置项目">
                    <h3>已配置项目</h3>
                    {catalog.projects.map((project) => (
                      <button
                        className="btn"
                        type="button"
                        key={project.id}
                        disabled={busy}
                        onClick={() => {
                          onSelect(project);
                          close();
                        }}
                      >
                        <FolderOpen size={16} aria-hidden="true" />
                        <span>{project.label}</span>
                      </button>
                    ))}
                  </section>
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
                  onClick={() => {
                    setError("");
                    setBrowsing(true);
                  }}
                >
                  选择其他目录
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
