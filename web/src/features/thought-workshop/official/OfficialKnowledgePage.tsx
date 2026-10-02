import { officialSearchText } from "./figures";
import { CopyOfficialFigure } from "./CopyOfficialFigure";
import type { OfficialFigureData } from "./OfficialFigure";
import { officialPath } from "./catalog";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  LockKeyhole,
  Menu,
  Search,
  X,
} from "lucide-react";
import { WorkshopSidebar } from "@shared/ui/WorkshopSidebar";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { thoughtKeys } from "../queryKeys";
import { findOfficialLibrary } from "./catalog";
import { loadOfficialDocument } from "./content";
import { OfficialLibraryHome } from "./ReadingNavigation";
import { OfficialArticle } from "./OfficialArticle";
import { useReadingPosition } from "../knowledge-tools/ReadingPosition";
import "../thought-workshop.css";
import "../knowledge.css";
import "./official.css";
import "./reading.css";

export function OfficialKnowledgePage({
  libraryId,
  documentId,
  onOpen,
  onBack,
  canCopy = false,
  onOpenNote,
}: {
  canCopy?: boolean;
  onOpenNote?: (library: string, note: string) => void;
  libraryId?: string;
  documentId?: string;
  onOpen: (libraryId: string, documentId?: string) => void;
  onBack: () => void;
}) {
  const library = findOfficialLibrary(libraryId);
  const current = library?.documents.find((item) => item.id === documentId);
  const [copy, setCopy] = useState<OfficialFigureData | null>(null);
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState(false);
  const sidebar = useDrawerFocus(() => setDrawer(false), drawer);
  const article = useQuery({
    queryKey: thoughtKeys.officialDocument(libraryId || "", documentId || ""),
    queryFn: () => loadOfficialDocument(current!),
    enabled: !!current,
    staleTime: Infinity,
    retry: false,
  });
  const main = useReadingPosition(
    current && library ? `official/${library.id}/${current.id}` : undefined,
    current?.title ?? "",
    null,
    article.isSuccess,
  );
  useEffect(() => {
    const query = new URLSearchParams(location.search)
      .get("find")
      ?.trim()
      .toLocaleLowerCase();
    if (!query || !article.isSuccess) return;
    const target = Array.from(
      main.current?.querySelectorAll<HTMLElement>(
        "article p,article li,article h2,article h3,article pre",
      ) ?? [],
    ).find((node) => node.textContent?.toLocaleLowerCase().includes(query));
    target?.scrollIntoView({ block: "center" });
  }, [article.isSuccess, documentId, main]);
  const trimmed = query.trim().toLocaleLowerCase("zh-CN");
  const search = useQuery({
    queryKey: thoughtKeys.officialSearch(libraryId || "", trimmed),
    queryFn: async () => {
      const documents = library!.documents;
      const text = await Promise.all(
        documents.map(async (item) =>
          officialSearchText(await loadOfficialDocument(item)),
        ),
      );
      return documents.filter((item, index) =>
        `${item.title}\n${item.summary}\n${text[index]}`
          .toLocaleLowerCase("zh-CN")
          .includes(trimmed),
      );
    },
    enabled: !!library && !!trimmed,
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    setQuery("");
    setDrawer(false);
    setCopy(null);
    if (main.current) main.current.scrollTop = 0;
  }, [libraryId, documentId, main]);
  const open = (id: string, doc?: string) => {
    setQuery("");
    setDrawer(false);
    onOpen(id, doc);
  };
  if (!library || (documentId && !current))
    return (
      <main className="official-not-found">
        <h1>官方文档不存在</h1>
        <p>请从官方知识库目录选择文章。</p>
        <button className="btn" onClick={onBack}>
          所有知识库
        </button>
      </main>
    );
  const groups = [...new Set(library.documents.map((item) => item.group))];
  const error = article.error || search.error;
  return (
    <div className="thought-shell knowledge-shell official-shell">
      {copy && canCopy && onOpenNote && (
        <CopyOfficialFigure
          figure={copy}
          sourcePath={officialPath(library.id, documentId)}
          onClose={() => setCopy(null)}
          onCreated={onOpenNote}
        />
      )}
      {drawer && (
        <button
          className="knowledge-backdrop"
          aria-label="关闭目录遮罩"
          onClick={() => setDrawer(false)}
        />
      )}
      <div className="knowledge-sidebar-track">
        <WorkshopSidebar
          sidebarRef={sidebar}
          label="官方知识库导航"
          name="思绪工坊"
          subtitle="Thought Workshop"
          className={`knowledge-sidebar ${drawer ? "is-open" : ""}`}
          brand={
            <img
              src="/brand/thought-workshop-mark.png"
              alt=""
              aria-hidden
              draggable={false}
            />
          }
          footer={<ThemeToggle />}
          brandAction={
            <button
              className="knowledge-mobile"
              aria-label="关闭目录"
              onClick={() => setDrawer(false)}
            >
              <X size={18} />
            </button>
          }
        >
          <button className="workshop-back" onClick={onBack}>
            <span className="workshop-back-icon">
              <ArrowLeft aria-hidden />
            </span>
            <span className="workshop-back-copy">
              <strong>所有知识库</strong>
              <small>返回官方与个人知识库</small>
            </span>
          </button>
          <label className="knowledge-search">
            <Search size={15} aria-hidden />
            <input
              aria-label="搜索官方文档"
              placeholder="搜索标题与正文…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="knowledge-directory-scroll official-directory">
            <button
              className="official-home-link"
              aria-current={!documentId && !trimmed ? "page" : undefined}
              onClick={() => open(library.id)}
            >
              知识库首页
            </button>
            <nav aria-label="官方文档目录">
              {groups.map((group) => (
                <section key={group}>
                  <h2>{group}</h2>
                  {library.documents
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <button
                        key={item.id}
                        aria-current={
                          documentId === item.id && !trimmed
                            ? "page"
                            : undefined
                        }
                        onClick={() => open(library.id, item.id)}
                      >
                        {item.title}
                      </button>
                    ))}
                </section>
              ))}
            </nav>
          </div>
        </WorkshopSidebar>
      </div>
      <main ref={main} className="knowledge-main">
        <header className="knowledge-topbar official-topbar">
          <button
            className="btn knowledge-mobile"
            aria-label="目录"
            aria-expanded={drawer}
            onClick={(event) => {
              event.currentTarget.focus();
              setDrawer(true);
            }}
          >
            <Menu size={18} />
          </button>
          <div className="official-topbar-copy">
            <button onClick={() => open(library.id)}>{library.title}</button>
            <span>{trimmed ? "搜索结果" : current?.title || "知识库首页"}</span>
          </div>
          <span className="official-badge">
            <LockKeyhole size={13} aria-hidden />
            官方 · 只读
          </span>
        </header>
        {error && (
          <div className="thought-error" role="alert">
            {error.message}
            <button
              className="btn"
              onClick={() =>
                void (trimmed ? search.refetch() : article.refetch())
              }
            >
              重试
            </button>
          </div>
        )}
        {trimmed ? (
          <section className="official-home" aria-label="官方文档搜索结果">
            <h1>搜索结果</h1>
            <p>“{query}” · 标题与正文</p>
            {search.isPending ? (
              <p role="status">正在搜索官方文档…</p>
            ) : (
              <>
                <p role="status">找到 {search.data?.length || 0} 篇文档</p>
                {search.data?.map((item) => (
                  <button
                    className="official-result"
                    key={item.id}
                    onClick={() => open(library.id, item.id)}
                  >
                    <BookOpen size={18} aria-hidden />
                    <span>
                      {item.title}
                      <small>{item.summary}</small>
                    </span>
                  </button>
                ))}
              </>
            )}
          </section>
        ) : current ? (
          <>
            {article.isPending && (
              <p className="knowledge-notice" role="status">
                正在加载官方文档…
              </p>
            )}
            {article.data && (
              <OfficialArticle
                key={`${library.id}/${current.id}`}
                libraryId={library.id}
                documentId={current.id}
                markdown={article.data}
                onCopy={canCopy && onOpenNote ? setCopy : undefined}
                onOpen={open}
              />
            )}
          </>
        ) : (
          <OfficialLibraryHome library={library} onOpen={open} />
        )}
      </main>
    </div>
  );
}
