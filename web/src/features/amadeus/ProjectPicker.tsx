import * as Dialog from "@radix-ui/react-dialog";
import { useQueries } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderSearch,
  Layers3,
  Search,
  X,
} from "lucide-react";
import { useId, useState } from "react";
import {
  listWorkshopProjects,
  maxSelectedProjects,
  projectKey,
  workshopProjects,
  type ProjectReference,
} from "./projectScope";
import "./project-picker.css";

export function ProjectPicker({
  owner,
  selected,
  onChange,
  disabled,
}: {
  owner: string;
  selected: ProjectReference[];
  onChange: (projects: ProjectReference[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const groupId = useId();
  const results = useQueries({
    queries: workshopProjects.map((workshop) => ({
      queryKey: ["amadeus", owner, "projects", workshop.resource],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        listWorkshopProjects(workshop, signal),
      enabled: open,
      retry: false,
    })),
  });
  const selectedKeys = new Set(selected.map(projectKey));
  const needle = search.trim().toLocaleLowerCase();
  const groups = workshopProjects.map((workshop, index) => {
    const result = results[index];
    const matchesWorkshop = workshop.title.toLocaleLowerCase().includes(needle);
    const projects = (result.data ?? []).filter(
      (project) =>
        matchesWorkshop || project.title.toLocaleLowerCase().includes(needle),
    );
    return { workshop, result, projects };
  });
  const visibleGroups = groups.filter(
    ({ result, projects }) =>
      projects.length || result.isPending || result.isError,
  );
  const noMatches = !groups.some(
    ({ result, projects }) => projects.length || result.isPending,
  );
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        type="button"
        disabled={disabled}
        className="amadeus-project-trigger"
        data-selected={selected.length > 0}
        title="选择工坊项目"
        aria-label="选择工坊项目"
      >
        <FolderOpen size={16} aria-hidden />
        <span>项目</span>
        {selected.length > 0 && (
          <span className="amadeus-project-count" aria-hidden>
            {selected.length}
          </span>
        )}
        <ChevronDown size={13} aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="amadeus-project-overlay" />
        <Dialog.Content className="amadeus-project-picker">
          <div className="amadeus-project-picker-head">
            <div className="amadeus-project-picker-title">
              <span className="amadeus-project-picker-icon" aria-hidden>
                <Layers3 size={22} />
              </span>
              <div className="amadeus-project-picker-heading">
                <Dialog.Title>选择工坊项目</Dialog.Title>
                <Dialog.Description>
                  可跨工坊选择，项目将带入本次对话。
                </Dialog.Description>
              </div>
              <Dialog.Close
                className="amadeus-project-close"
                aria-label="关闭项目选择"
              >
                <X size={17} aria-hidden />
              </Dialog.Close>
            </div>
            <label className="amadeus-project-search">
              <Search size={16} aria-hidden />
              <input
                aria-label="搜索工坊或项目"
                placeholder="搜索工坊或项目"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          {selected.length > 0 && (
            <div className="amadeus-project-selection">
              <span aria-hidden>已选</span>
              <ul aria-label="已选项目">
                {selected.map((project) => (
                  <li key={projectKey(project)}>
                    <button
                      type="button"
                      aria-label={`移除 ${project.title}`}
                      title={project.title}
                      disabled={disabled}
                      onClick={() =>
                        onChange(
                          selected.filter(
                            (item) => projectKey(item) !== projectKey(project),
                          ),
                        )
                      }
                    >
                      <span>{project.title}</span>
                      <X size={12} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="amadeus-project-results">
            {noMatches && (
              <div className="amadeus-project-empty" role="status">
                <FolderSearch size={24} aria-hidden />
                <span>{needle ? "没有匹配的项目" : "暂无可选项目"}</span>
              </div>
            )}
            {visibleGroups.map(({ workshop, result, projects }) => (
              <section
                className="amadeus-project-group"
                key={workshop.resource}
                role="group"
                aria-labelledby={`${groupId}-${workshop.resource}`}
              >
                <div className="amadeus-project-group-head">
                  <h3 id={`${groupId}-${workshop.resource}`}>
                    {workshop.title}
                  </h3>
                  {projects.length > 0 && (
                    <span aria-hidden>{projects.length}</span>
                  )}
                </div>
                {result.isPending && (
                  <small className="amadeus-project-loading" role="status">
                    正在读取项目…
                  </small>
                )}
                {result.isError && (
                  <button
                    className="amadeus-project-retry"
                    type="button"
                    onClick={() => void result.refetch()}
                  >
                    读取失败，重试
                  </button>
                )}
                <div className="amadeus-project-grid">
                  {projects.map((project) => {
                    const key = projectKey(project);
                    const checked = selectedKeys.has(key);
                    return (
                      <label className="amadeus-project-option" key={key}>
                        <Folder size={16} aria-hidden />
                        <span
                          className="amadeus-project-option-name"
                          title={project.title}
                        >
                          {project.title}
                        </span>
                        <span className="amadeus-project-checkbox">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={
                              disabled ||
                              (!checked &&
                                selected.length >= maxSelectedProjects)
                            }
                            onChange={() =>
                              onChange(
                                checked
                                  ? selected.filter(
                                      (item) => projectKey(item) !== key,
                                    )
                                  : [...selected, project],
                              )
                            }
                          />
                          <span aria-hidden>
                            <Check size={11} strokeWidth={2.5} />
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          <div className="amadeus-project-picker-footer">
            <span role="status">
              已选 <strong>{selected.length}</strong> / {maxSelectedProjects}{" "}
              个项目
            </span>
            <Dialog.Close className="amadeus-project-done">
              <Check size={16} aria-hidden />
              完成
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
