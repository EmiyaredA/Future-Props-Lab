import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  ChevronRight,
  Menu,
  Search,
  X,
} from "lucide-react";
import { BrandMark } from "@shared/ui/BrandMark";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import {
  GUIDE_GROUPS,
  GUIDE_PAGES,
  guideSearchText,
  type GuidePage,
  type GuideSection,
} from "./content";

function pageFromLocation() {
  const requested = new URLSearchParams(window.location.search).get("page");
  return GUIDE_PAGES.find((page) => page.id === requested) ?? GUIDE_PAGES[0];
}

function pageHref(page: GuidePage) {
  return `/docs.html?page=${encodeURIComponent(page.id)}`;
}

function Section({ section }: { section: GuideSection }) {
  return (
    <section className="docs-article-section" id={section.id}>
      <h2>{section.title}</h2>
      {section.paragraphs?.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {section.steps?.length ? (
        <ol className="docs-steps">
          {section.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {section.bullets?.length ? (
        <ul className="docs-bullets">
          {section.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      ) : null}
      {section.table ? (
        <div className="docs-table-wrap">
          <table>
            <thead>
              <tr>
                {section.table.headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell, index) =>
                    index === 0 ? (
                      <th scope="row" key={cell}>
                        {cell}
                      </th>
                    ) : (
                      <td key={cell}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {section.image ? (
        <figure className="docs-shot">
          <a href={section.image.src} target="_blank" rel="noreferrer">
            <img
              src={section.image.src}
              alt={section.image.alt}
              loading="lazy"
            />
          </a>
          <figcaption>{section.image.caption}</figcaption>
        </figure>
      ) : null}
      {section.note ? (
        <aside className="docs-note">{section.note}</aside>
      ) : null}
    </section>
  );
}

export function DocsApp() {
  const searchRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(pageFromLocation);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeSection, setActiveSection] = useState(
    page.sections[0]?.id ?? "",
  );
  const [readingProgress, setReadingProgress] = useState(0);
  const pageIndex = GUIDE_PAGES.findIndex(
    (candidate) => candidate.id === page.id,
  );
  const previous = GUIDE_PAGES[pageIndex - 1];
  const next = GUIDE_PAGES[pageIndex + 1];
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const matches = useMemo(
    () =>
      normalizedQuery
        ? new Set(
            GUIDE_PAGES.filter((candidate) =>
              guideSearchText(candidate).includes(normalizedQuery),
            ).map((candidate) => candidate.id),
          )
        : new Set(GUIDE_PAGES.map((candidate) => candidate.id)),
    [normalizedQuery],
  );

  useEffect(() => {
    const onPopState = () => setPage(pageFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (event.key === "/" && !editing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    document.title = `${page.title} · 未来道具研究所文档中心`;
    setActiveSection(page.sections[0]?.id ?? "");
    const update = () => {
      const article = document.querySelector<HTMLElement>(".docs-article");
      if (!article) return;
      const sections = page.sections
        .map((section) => document.getElementById(section.id))
        .filter((element): element is HTMLElement => Boolean(element));
      const active = [...sections]
        .reverse()
        .find((section) => section.getBoundingClientRect().top <= 150);
      setActiveSection(active?.id ?? sections[0]?.id ?? "");
      const bounds = article.getBoundingClientRect();
      const available = Math.max(1, bounds.height - window.innerHeight + 120);
      setReadingProgress(
        Math.round(Math.min(1, Math.max(0, -bounds.top / available)) * 100),
      );
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [page]);

  const navigate = (
    event: MouseEvent<HTMLAnchorElement>,
    target: GuidePage,
  ) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    window.history.pushState({}, "", pageHref(target));
    setPage(target);
    setDrawerOpen(false);
    window.scrollTo?.({ top: 0, behavior: "auto" });
  };

  return (
    <div className="docs-shell">
      <a className="docs-skip-link" href="#docs-content">
        跳到正文
      </a>
      <header className="docs-header">
        <button
          type="button"
          className="docs-menu-button"
          aria-label={drawerOpen ? "关闭功能目录" : "打开功能目录"}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((current) => !current)}
        >
          {drawerOpen ? <X aria-hidden /> : <Menu aria-hidden />}
        </button>
        <a
          className="docs-brand"
          href={pageHref(GUIDE_PAGES[0])}
          onClick={(event) => navigate(event, GUIDE_PAGES[0])}
        >
          <BrandMark size={38} />
          <span>
            <strong>未来道具研究所</strong>
            <small>文档中心</small>
          </span>
        </a>
        <nav className="docs-primary-nav" aria-label="文档中心分类">
          <a
            aria-current="page"
            href={pageHref(GUIDE_PAGES[0])}
            onClick={(event) => navigate(event, GUIDE_PAGES[0])}
          >
            使用指南
          </a>
        </nav>
        <label className="docs-search">
          <Search aria-hidden />
          <span className="sr-only">搜索使用指南</span>
          <input
            ref={searchRef}
            type="search"
            aria-label="搜索使用指南"
            placeholder="搜索视频、时间轴或线路检查"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>/</kbd>
        </label>
        <div className="docs-actions">
          <a href="/model-service">返回 Studio</a>
          <ThemeToggle compact />
        </div>
      </header>

      <div className="docs-layout">
        <aside
          className={`docs-sidebar${drawerOpen ? " open" : ""}`}
          aria-label="功能目录"
        >
          {GUIDE_GROUPS.map((group) => {
            const pages = group.pages.filter((candidate) =>
              matches.has(candidate.id),
            );
            if (!pages.length) return null;
            return (
              <section key={group.title} className="docs-nav-group">
                <h2>{group.title}</h2>
                {pages.map((candidate) => (
                  <a
                    key={candidate.id}
                    className={candidate.id === page.id ? "active" : ""}
                    aria-current={candidate.id === page.id ? "page" : undefined}
                    href={pageHref(candidate)}
                    onClick={(event) => navigate(event, candidate)}
                  >
                    {candidate.title}
                  </a>
                ))}
              </section>
            );
          })}
          {!matches.size ? (
            <p className="docs-nav-empty">没有找到匹配的指南。</p>
          ) : null}
        </aside>
        <button
          type="button"
          className={`docs-drawer-backdrop${drawerOpen ? " open" : ""}`}
          aria-label="关闭功能目录"
          onClick={() => setDrawerOpen(false)}
        />

        <main className="docs-main" id="docs-content">
          <article className="docs-article">
            <div className="docs-breadcrumbs">
              <a
                href={pageHref(GUIDE_PAGES[0])}
                onClick={(event) => navigate(event, GUIDE_PAGES[0])}
              >
                文档中心
              </a>
              <ChevronRight aria-hidden />
              <span>{page.group}</span>
            </div>
            <span className="docs-eyebrow">{page.eyebrow}</span>
            <h1 tabIndex={-1}>{page.title}</h1>
            <p className="docs-lead">{page.lead}</p>
            {page.sections.map((section) => (
              <Section key={section.id} section={section} />
            ))}
            <nav className="docs-page-nav" aria-label="上一篇和下一篇">
              {previous ? (
                <a
                  href={pageHref(previous)}
                  onClick={(event) => navigate(event, previous)}
                >
                  <ArrowLeft aria-hidden />
                  <span>
                    <small>上一篇</small>
                    <strong>{previous.title}</strong>
                  </span>
                </a>
              ) : (
                <span />
              )}
              {next ? (
                <a
                  className="next"
                  href={pageHref(next)}
                  onClick={(event) => navigate(event, next)}
                >
                  <span>
                    <small>下一篇</small>
                    <strong>{next.title}</strong>
                  </span>
                  <ArrowRight aria-hidden />
                </a>
              ) : (
                <span />
              )}
            </nav>
            <footer className="docs-footer">
              未来道具研究所文档中心 · 以当前可见功能和实际界面为准
            </footer>
          </article>
        </main>

        <aside className="docs-toc" aria-label="本页目录">
          <h2>
            <BookOpenText aria-hidden /> 本页目录
          </h2>
          <nav>
            {page.sections.map((section) => (
              <a
                key={section.id}
                className={activeSection === section.id ? "active" : ""}
                aria-current={
                  activeSection === section.id ? "location" : undefined
                }
                href={`#${section.id}`}
              >
                {section.title}
              </a>
            ))}
          </nav>
          <div className="docs-progress" aria-label="阅读进度">
            <span>
              阅读进度 <strong>{readingProgress}%</strong>
            </span>
            <i>
              <b style={{ width: `${readingProgress}%` }} />
            </i>
          </div>
        </aside>
      </div>
    </div>
  );
}
