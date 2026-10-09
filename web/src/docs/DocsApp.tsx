import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@platform/api/client";
import { replaceDeveloperDocuments } from "./content";
import { ArrowLeft, ArrowRight, Search, Menu, X } from "lucide-react";
import { BrandMark } from "@shared/ui/BrandMark";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import {
  CATEGORY_LABELS,
  GUIDE_PAGES,
  GROUPS,
  pageHref,
  guideSearchText,
  searchHeading,
  resolveLocation,
} from "./content";
import type { GuidePage } from "./types";
import { DocsMarkdown, CopyButton } from "./DocsMarkdown";
import { DocsExamples } from "./DocsExamples";
import { DocsReadingProgress } from "./DocsReadingProgress";
import { DocsNavigation } from "./DocsNavigation";
function currentLocation() {
  return resolveLocation(
    new URLSearchParams(location.search).get("page") || "overview",
    location.hash,
  );
}
function currentPage() {
  return currentLocation().page;
}
function scrollToLocation() {
  const { section } = currentLocation();
  if (section) document.getElementById(section)?.scrollIntoView();
  else window.scrollTo(0, 0);
}
function DocsPagerLink({
  target,
  direction,
}: {
  target: GuidePage;
  direction: "previous" | "next";
}) {
  const next = direction === "next";
  return (
    <a className={next ? "next" : undefined} href={pageHref(target)}>
      {next ? null : <ArrowLeft aria-hidden="true" />}
      <span>
        <small>{next ? "下一篇" : "上一篇"}</small>
        <strong>{target.title}</strong>
        {target.lead ? <em>{target.lead}</em> : null}
      </span>
      {next ? <ArrowRight aria-hidden="true" /> : null}
    </a>
  );
}
export function DocsApp() {
  const [page, setPage] = useState(currentPage);
  useEffect(() => {
    let active = true;
    let epoch = 0;
    const refreshProtected = async () => {
      const request = ++epoch;
      try {
        const response = await api.GET("/v1/account/developer-documents");
        if (!active || request !== epoch) return;
        replaceDeveloperDocuments(response.data?.items || []);
      } catch {
        if (!active || request !== epoch) return;
        replaceDeveloperDocuments([]);
      }
      setPage(currentPage());
    };
    void refreshProtected();
    window.addEventListener("focus", refreshProtected);
    const timer = window.setInterval(refreshProtected, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshProtected);
      replaceDeveloperDocuments([]);
    };
  }, []);
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const [active, setActive] = useState("");
  const [image, setImage] = useState<{ src: string; alt: string } | null>(null);
  const search = useRef<HTMLDialogElement>(null);
  const lightbox = useRef<HTMLDialogElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const openImage = useCallback((src: string, alt: string) => {
    priorFocus.current = document.activeElement as HTMLElement;
    setImage({ src, alt });
  }, []);
  const siblings = GUIDE_PAGES.filter(
    (p) =>
      p.category === page.category &&
      (page.context ? p.context === page.context : !p.context),
  );
  const index = siblings.findIndex((p) => p.id === page.id);
  const term = query.trim().toLocaleLowerCase("zh-CN");
  const matches = GUIDE_PAGES.filter(
    (p) =>
      (all || p.category === page.category) &&
      term &&
      guideSearchText(p).includes(term),
  );
  const openSearch = () => {
    priorFocus.current = document.activeElement as HTMLElement;
    search.current?.showModal();
    input.current?.focus();
  };
  useEffect(() => {
    function sync() {
      setPage(currentPage());
      setDrawer(false);
      requestAnimationFrame(scrollToLocation);
    }
    function click(event: MouseEvent) {
      const a = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (
        !a ||
        a.target ||
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname !== "/docs.html")
        return;
      event.preventDefault();
      history.pushState({}, "", url);
      sync();
      search.current?.close();
      requestAnimationFrame(() => {
        scrollToLocation();
        if (!url.hash) {
          document.querySelector<HTMLHeadingElement>(".docs-prose h1")?.focus();
        }
      });
    }
    function key(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        (search.current?.open || lightbox.current?.open)
      ) {
        event.preventDefault();
        search.current?.close();
        lightbox.current?.close();
        return;
      }
      const editing = (event.target as HTMLElement).closest(
        "input,textarea,[contenteditable=true]",
      );
      if (
        (event.key === "/" && !editing) ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
      ) {
        event.preventDefault();
        openSearch();
      }
    }
    window.addEventListener("popstate", sync);
    document.addEventListener("click", click);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("popstate", sync);
      document.removeEventListener("click", click);
      document.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    document.title = page.title + " · 未来道具研究所文档中心";
    const timer = requestAnimationFrame(scrollToLocation);
    const update = () => {
      const headings = page.headings.filter((h) => h.level > 1);
      setActive(
        [...headings]
          .reverse()
          .find(
            (h) =>
              (document.getElementById(h.id)?.getBoundingClientRect().top ??
                Infinity) < 160,
          )?.id ||
          headings[0]?.id ||
          "",
      );
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(timer);
      window.removeEventListener("scroll", update);
    };
  }, [page]);
  useEffect(() => {
    if (image) lightbox.current?.showModal();
  }, [image]);
  useEffect(() => {
    if (!drawer) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerRef.current?.querySelector<HTMLElement>("a,button,summary")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawer(false);
        menuRef.current?.focus();
      }
      if (e.key === "Tab") {
        const items = Array.from(
          drawerRef.current?.querySelectorAll<HTMLElement>(
            "a,button,summary",
          ) || [],
        ).filter((el) => el.getClientRects().length);
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = before;
      document.removeEventListener("keydown", key);
    };
  }, [drawer]);
  const closeDrawer = () => {
    setDrawer(false);
    menuRef.current?.focus();
  };
  return (
    <div className="docs-shell">
      <a className="docs-skip-link" href="#docs-content">
        跳到正文
      </a>
      <header className="docs-header">
        <button
          ref={menuRef}
          className="docs-menu-button"
          aria-label={drawer ? "关闭功能目录" : "打开功能目录"}
          aria-expanded={drawer}
          onClick={() => (drawer ? closeDrawer() : setDrawer(true))}
        >
          {drawer ? <X /> : <Menu />}
        </button>
        <a className="docs-brand" href={pageHref("overview")}>
          <BrandMark size={34} />
          <span>
            <strong>未来道具研究所</strong>
            <small>文档中心</small>
          </span>
        </a>
        <nav className="docs-primary-nav" aria-label="文档中心分类">
          {Object.entries(CATEGORY_LABELS)
            .filter(([key]) => GUIDE_PAGES.some((p) => p.category === key))
            .map(([key, label]) => (
              <a
                key={key}
                aria-current={page.category === key ? "page" : undefined}
                href={pageHref(GUIDE_PAGES.find((p) => p.category === key)!)}
              >
                {label}
              </a>
            ))}
        </nav>
        <button
          className="docs-header-search"
          onClick={openSearch}
          aria-label="打开文档搜索"
        >
          <Search size={17} />
          <span>搜索{CATEGORY_LABELS[page.category]}…</span>
          <kbd>/</kbd>
        </button>
        <div className="docs-actions">
          <button
            className="docs-search-trigger"
            onClick={openSearch}
            aria-label="搜索文档"
          >
            <Search size={18} />
            <kbd>⌘ K</kbd>
          </button>
          <ThemeToggle compact />
        </div>
      </header>
      <div className="docs-layout">
        <aside
          ref={drawerRef}
          className={"docs-sidebar" + (drawer ? " open" : "")}
          aria-label="功能目录"
        >
          <nav className="docs-mobile-categories" aria-label="移动端文档分类">
            {Object.entries(CATEGORY_LABELS)
              .filter(([key]) => GUIDE_PAGES.some((p) => p.category === key))
              .map(([key, label]) => (
                <a
                  key={key}
                  href={pageHref(GUIDE_PAGES.find((p) => p.category === key)!)}
                >
                  {label}
                </a>
              ))}
          </nav>
          <DocsNavigation page={page} />
        </aside>
        <button
          className={"docs-drawer-backdrop" + (drawer ? " open" : "")}
          aria-label="关闭功能目录"
          onClick={closeDrawer}
        />
        <main className="docs-main" id="docs-content">
          <article className="docs-article">
            <div className="docs-article-toolbar">
              <div className="docs-breadcrumbs">
                <a href={pageHref("overview")}>文档中心</a>
                <span> / {GROUPS.find((g) => g.id === page.group)?.title}</span>
              </div>
              <CopyButton value={page.markdown} label="复制页面" />
            </div>
            {page.prerequisites && (
              <p className="docs-prerequisites">开始前：{page.prerequisites}</p>
            )}
            <DocsMarkdown page={page} onImage={openImage} />
            {page.examples && <DocsExamples examples={page.examples} />}
            {page.related && (
              <nav className="docs-related" aria-label="相关阅读">
                {page.related.map((id) => {
                  const related = GUIDE_PAGES.find((p) => p.id === id);
                  return related ? (
                    <a key={id} href={pageHref(id)}>
                      {related.title}
                    </a>
                  ) : null;
                })}
              </nav>
            )}
            <nav className="docs-page-nav" aria-label="上一篇和下一篇">
              {index > 0 ? (
                <DocsPagerLink
                  target={siblings[index - 1]}
                  direction="previous"
                />
              ) : (
                <span />
              )}
              {index >= 0 && index < siblings.length - 1 ? (
                <DocsPagerLink target={siblings[index + 1]} direction="next" />
              ) : null}
            </nav>
            <footer className="docs-footer">
              未来道具研究所 · 使用说明以当前工作空间权限及所选模型能力为准
            </footer>
          </article>
        </main>
        <aside className="docs-toc" aria-label="本页目录">
          <h2>本页目录</h2>
          <nav>
            {page.headings
              .filter((h) => h.level > 1)
              .map((h) => (
                <a
                  key={h.id}
                  className={active === h.id ? "active" : ""}
                  aria-current={active === h.id ? "location" : undefined}
                  style={{ paddingLeft: h.level === 3 ? 24 : 12 }}
                  href={"#" + encodeURIComponent(h.id)}
                >
                  {h.title}
                </a>
              ))}
          </nav>
          <DocsReadingProgress pageId={page.id} />
        </aside>
      </div>
      <dialog
        ref={search}
        className="docs-search-dialog"
        onClose={() => priorFocus.current?.focus()}
        aria-label="搜索文档"
      >
        <div className="docs-dialog-top">
          <input
            ref={input}
            type="search"
            aria-label="搜索使用指南"
            placeholder="搜索文章、操作或错误信息"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button aria-label="关闭搜索" onClick={() => search.current?.close()}>
            <X />
          </button>
        </div>
        <label className="docs-search-scope">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          搜索全部分类
        </label>
        <p role="status">
          {term
            ? `找到 ${matches.length} 篇文章`
            : "输入关键词，搜索正文与章节标题"}
        </p>
        <div className="docs-search-results">
          {matches.map((p) => {
            const heading = searchHeading(p, term);
            const text = p.markdown.replace(/[#*`>]/g, "");
            const at = text.toLowerCase().indexOf(term);
            return (
              <a key={p.id} href={pageHref(p, heading?.id)}>
                <small>
                  {CATEGORY_LABELS[p.category]} ·{" "}
                  {GROUPS.find((g) => g.id === p.group)?.title}
                </small>
                <strong>
                  {p.title}
                  {heading ? " / " + heading.title : ""}
                </strong>
                <span>
                  {text.slice(Math.max(0, at - 35), Math.max(0, at - 35) + 140)}
                </span>
              </a>
            );
          })}
        </div>
      </dialog>
      <dialog
        ref={lightbox}
        className="docs-lightbox"
        onClose={() => {
          setImage(null);
          priorFocus.current?.focus();
        }}
        aria-label="图片预览"
      >
        <button autoFocus onClick={() => lightbox.current?.close()}>
          关闭图片
        </button>
        {image && <img src={image.src} alt={image.alt} />}
      </dialog>
    </div>
  );
}
