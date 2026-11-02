import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { ArrowLeft, BookOpen, Home, Search, Trash2, X } from "lucide-react";
import { useState, type CSSProperties, type ReactNode, type Ref } from "react";
import {
  WorkshopSidebar,
  WorkshopNavigation,
} from "@shared/ui/WorkshopSidebar";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import { documentViews } from "./knowledgeViews";
import { KnowledgeSidebarResize } from "./KnowledgeSidebarResize";
import {
  readKnowledgeSidebarWidth,
  writeKnowledgeSidebarWidth,
} from "./knowledgeSidebarWidth";

export function KnowledgeSidebar({
  sidebarRef,
  drawer,
  close,
  discover,
  content,
  sections,
  readOnly = false,
  onBack,
  onNavigate,
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
  discover?: () => void;
  content?: ReactNode;
  sections?: ReactNode;
  readOnly?: boolean;
  onBack: () => void;
  onNavigate: (id?: string) => void;
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
  const [width, setWidth] = useState(readKnowledgeSidebarWidth);
  return (
    <div
      className="knowledge-sidebar-track"
      style={
        {
          "--knowledge-sidebar-width": `${width}px`,
        } as CSSProperties
      }
    >
      <WorkshopSidebar
        sidebarRef={sidebarRef}
        label="知识库导航"
        className={`knowledge-sidebar ${drawer ? "is-open" : ""}`}
        name="思绪工坊"
        subtitle="Thought Workshop"
        backSubtitle={inside ? undefined : "浏览全部应用"}
        brand={
          <ResponsiveImage
            src="/brand/thought-workshop-mark.png"
            alt=""
            aria-hidden
            draggable={false}
          />
        }
        onBack={inside ? undefined : onBack}
        brandAction={
          <button
            className="knowledge-mobile"
            aria-label="关闭目录"
            onClick={close}
          >
            <X size={18} />
          </button>
        }
        footer={<ThemeToggle />}
      >
        {!inside && sections}
        {!inside && discover && (
          <button
            type="button"
            className="knowledge-search btn"
            onClick={discover}
          >
            <Search size={16} />
            搜索与最近访问
          </button>
        )}
        {content ??
          (inside ? (
            <>
              <button
                className="workshop-back"
                type="button"
                aria-label="我的知识库"
                onClick={() => onNavigate()}
              >
                <span className="workshop-back-icon">
                  <ArrowLeft aria-hidden />
                </span>
                <span className="workshop-back-copy">
                  <strong>我的知识库</strong>
                  <small>浏览全部知识库</small>
                </span>
              </button>
              <label className="knowledge-search">
                <Search size={15} />
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
                  ...documentViews
                    .filter(({ id }) => !readOnly || id !== "trash")
                    .map(({ id, label, Icon }) => ({
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
                ...(!sections
                  ? [
                      {
                        id: "all",
                        label: "我的知识库",
                        icon: <BookOpen aria-hidden />,
                        active: !trash,
                        onSelect: () => selectTrash(false),
                      },
                    ]
                  : []),
                ...(!readOnly
                  ? [
                      {
                        id: "trash",
                        label: "知识库回收站",
                        icon: <Trash2 aria-hidden />,
                        active: trash,
                        onSelect: () => selectTrash(true),
                      },
                    ]
                  : []),
              ]}
            />
          ))}
      </WorkshopSidebar>
      <KnowledgeSidebarResize
        width={width}
        onChange={setWidth}
        onCommit={writeKnowledgeSidebarWidth}
      />
    </div>
  );
}
