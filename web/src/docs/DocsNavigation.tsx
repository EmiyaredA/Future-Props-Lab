import {
  BookOpen,
  Boxes,
  Compass,
  Layers,
  LifeBuoy,
  Monitor,
  ArrowLeft,
} from "lucide-react";
import { GROUPS, GUIDE_PAGES, pageHref } from "./content";
import type { GuidePage } from "./types";
const icons = [BookOpen, Layers, Boxes, Monitor, Compass, LifeBuoy];
export function DocsNavigation({ page }: { page: GuidePage }) {
  const groups = GROUPS.filter((g) =>
    page.context
      ? g.context === page.context
      : !g.context || page.category === "use",
  ).filter((g) =>
    GUIDE_PAGES.some((p) => p.group === g.id && p.category === page.category),
  );
  const sections = [...new Set(groups.map((g) => g.section))];
  const context = GROUPS.find(
    (g) => g.context === page.context && page.context,
  );
  return (
    <>
      {context && (
        <div className="docs-context">
          <a href={pageHref(context.parent!)}>
            <ArrowLeft size={15} />
            返回{context.section === "工具" ? "工具导航" : "AI 应用"}
          </a>
          <strong>{context.title}</strong>
          <small>
            {context.section === "工具" ? "内置工具" : "AI 应用"}文档
          </small>
        </div>
      )}
      {sections.map((section, index) => {
        const Icon = icons[index % icons.length];
        return (
          <section className="docs-nav-group" key={section}>
            <h2>
              <Icon size={17} />
              {page.context ? "文档目录" : section}
            </h2>
            {groups
              .filter((g) => g.section === section)
              .map((g) => {
                const pages = GUIDE_PAGES.filter(
                  (p) => p.group === g.id && p.category === page.category,
                );
                const link = (p: GuidePage) => (
                  <a
                    key={p.id}
                    href={pageHref(p)}
                    className={p.id === page.id ? "active" : ""}
                    aria-current={p.id === page.id ? "page" : undefined}
                  >
                    {p.title}
                  </a>
                );
                if (g.context && !page.context)
                  return (
                    <a key={g.id} href={pageHref(pages[0])}>
                      {g.title}
                      <span aria-hidden>›</span>
                    </a>
                  );
                if (page.context || g.id === "start" || pages.length === 1)
                  return <div key={g.id}>{pages.map(link)}</div>;
                return (
                  <details key={g.id} open={g.id === page.group || undefined}>
                    <summary>{g.title}</summary>
                    <div className="docs-nav-children">{pages.map(link)}</div>
                  </details>
                );
              })}
          </section>
        );
      })}
      {context && (
        <section className="docs-nav-group">
          <h2>相关阅读</h2>
          {GROUPS.filter(
            (g) =>
              g.context && g.section === context.section && g.id !== context.id,
          ).map((g) => (
            <a
              key={g.id}
              href={pageHref(GUIDE_PAGES.find((p) => p.group === g.id)!)}
            >
              {g.title}
            </a>
          ))}
        </section>
      )}
    </>
  );
}
