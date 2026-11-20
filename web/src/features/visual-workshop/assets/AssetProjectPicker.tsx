import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Folder, FolderSearch } from "lucide-react";
import { relativeTime } from "@shared/lib/date";
import { LoadingState } from "@shared/ui/LoadingState";
import {
  WorkshopAppChrome,
  WorkshopSearch,
} from "@shared/ui/WorkshopAppChrome";
import { getVisualWorkshopProjects } from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import "./asset-project-index.css";

export default function AssetProjectPicker({
  utilities,
  onOpen,
}: {
  utilities?: ReactNode;
  onOpen: (projectId: string) => void;
}) {
  const projects = useQuery({
    queryKey: visualWorkshopQueryKeys.projects,
    queryFn: getVisualWorkshopProjects,
  });
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase("zh-CN");
  const items = projects.data?.items ?? [];
  const visible = items.filter((project) =>
    project.title.toLocaleLowerCase("zh-CN").includes(search),
  );

  return (
    <section className="workshop-page asset-project-index">
      <WorkshopAppChrome title="项目素材库" utilities={utilities} />
      <div className="asset-project-index__surface">
        <div className="asset-project-index__toolbar">
          <div className="asset-project-index__summary">
            <h2>选择项目</h2>
            {projects.isSuccess && (
              <span role="status">
                {search
                  ? `找到 ${visible.length} 个项目`
                  : `${items.length} 个项目`}
              </span>
            )}
          </div>
          <WorkshopSearch
            label="搜索项目"
            placeholder="搜索项目名称…"
            value={query}
            onChange={setQuery}
          />
        </div>
        {projects.isPending ? (
          <div className="asset-project-index__empty">
            <LoadingState label="正在读取项目" variant="inline" />
          </div>
        ) : projects.isError ? (
          <div className="asset-project-index__empty">
            <strong role="alert">项目暂时无法读取</strong>
            <button
              className="workshop-secondary"
              type="button"
              onClick={() => void projects.refetch()}
            >
              重新加载
            </button>
          </div>
        ) : visible.length ? (
          <>
            <div className="asset-project-index__columns" aria-hidden="true">
              <span>项目名称</span>
              <span>最近更新</span>
            </div>
            <ul className="asset-project-index__list" aria-label="项目列表">
              {visible.map(({ id, title, updated_at }) => (
                <li key={id}>
                  <button
                    className="asset-project-index__item"
                    type="button"
                    aria-labelledby={`asset-project-title-${id}`}
                    onClick={() => onOpen(id)}
                  >
                    <span className="asset-project-index__icon">
                      <Folder size={17} aria-hidden />
                    </span>
                    <span
                      className="asset-project-index__title"
                      id={`asset-project-title-${id}`}
                    >
                      {title || "未命名项目"}
                    </span>
                    <time
                      dateTime={updated_at}
                      title={new Date(updated_at).toLocaleString("zh-CN")}
                    >
                      {relativeTime(updated_at, "")}
                    </time>
                    <ChevronRight
                      className="asset-project-index__arrow"
                      size={16}
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="asset-project-index__empty">
            <FolderSearch size={22} aria-hidden />
            <strong>{items.length ? "没有匹配的项目" : "暂无项目"}</strong>
            {search && (
              <button
                className="workshop-secondary"
                type="button"
                onClick={() => setQuery("")}
              >
                清空搜索
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
