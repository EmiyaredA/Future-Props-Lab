import { ArrowLeft, BookOpen, Home, Search, Trash2, X } from "lucide-react";
import type { ReactNode, Ref } from "react";
import {
  WorkshopSidebar,
  WorkshopNavigation,
} from "@shared/ui/WorkshopSidebar";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { KnowledgeBase } from "./api";
import { documentViews } from "./knowledgeViews";

export function KnowledgeSidebar({
  sidebarRef,
  drawer,
  close,
  onBack,
  onNavigate,
  project,
  projects,
  inside,
  query,
  search,
  view,
  browsing,
  noteId,
  home,
  selectView,
  trash,
  selectTrash,
  children,
}: {
  sidebarRef: Ref<HTMLElement>;
  drawer: boolean;
  close: () => void;
  onBack: () => void;
  onNavigate: (id?: string) => void;
  project?: KnowledgeBase;
  projects: KnowledgeBase[];
  inside: boolean;
  query: string;
  search: (query: string) => void;
  view: string;
  browsing: boolean;
  noteId?: string;
  home: () => void;
  selectView: (view: string) => void;
  trash: boolean;
  selectTrash: (trash: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="knowledge-sidebar-track">
      <WorkshopSidebar
        sidebarRef={sidebarRef}
        label="知识库导航"
        className={`knowledge-sidebar ${drawer ? "is-open" : ""}`}
        name="思绪工坊"
        subtitle="Thought Workshop"
        backSubtitle="浏览全部应用"
        brand={
          <img
            src="/brand/thought-workshop-mark.png"
            alt=""
            aria-hidden
            draggable={false}
          />
        }
        onBack={onBack}
        brandAction={
          <button
            className="knowledge-mobile"
            aria-label="关闭目录"
            onClick={close}
          >
            <X size={18} />
          </button>
        }
      >
        {inside ? (
          <>
            <button className="knowledge-all-link" onClick={() => onNavigate()}>
              <ArrowLeft size={16} />
              所有知识库
            </button>
            {project && (
              <CustomSelect
                escapeClipping
                ariaLabel="切换知识库"
                value={project.id}
                options={projects.map((p) => ({ value: p.id, label: p.title }))}
                onChange={onNavigate}
              />
            )}
            <label className="knowledge-search">
              <Search size={16} />
              <input
                aria-label="搜索当前知识库"
                placeholder="搜索文档…"
                value={query}
                onChange={(e) => search(e.target.value)}
              />
            </label>
            <WorkshopNavigation
              label="当前知识库视图"
              items={[
                {
                  id: "home",
                  label: "首页",
                  icon: <Home aria-hidden />,
                  active: !browsing && !noteId,
                  onSelect: home,
                },
                ...documentViews.map(({ id, label, Icon }) => ({
                  id,
                  label,
                  icon: <Icon aria-hidden />,
                  active: browsing && view === id,
                  onSelect: () => selectView(id),
                })),
              ]}
            />
            <div className="knowledge-directory-scroll">{children}</div>
          </>
        ) : (
          <WorkshopNavigation
            label="思绪工坊导航"
            items={[
              {
                id: "all",
                label: "所有知识库",
                icon: <BookOpen aria-hidden />,
                active: !trash,
                onSelect: () => selectTrash(false),
              },
              {
                id: "trash",
                label: "知识库回收站",
                icon: <Trash2 aria-hidden />,
                active: trash,
                onSelect: () => selectTrash(true),
              },
            ]}
          />
        )}
      </WorkshopSidebar>
    </div>
  );
}
