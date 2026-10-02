import { useEffect, useState, type RefObject } from "react";
import type { officialHeadings } from "./content";

export function ReadingOutline({
  headings,
  article,
}: {
  headings: ReturnType<typeof officialHeadings>;
  article: RefObject<HTMLElement | null>;
}) {
  const [active, setActive] = useState(headings[0]?.id);
  const [expanded, setExpanded] = useState(
    () =>
      typeof matchMedia === "undefined" ||
      matchMedia("(min-width: 1201px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(min-width: 1201px)");
    const change = () => setExpanded(media?.matches ?? true);
    media?.addEventListener("change", change);
    return () => media?.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const root = article.current?.closest(".knowledge-main") ?? window;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top =
          root instanceof HTMLElement ? root.getBoundingClientRect().top : 0;
        let selected = headings[0]?.id;
        for (const heading of headings) {
          const element = document.getElementById(heading.id);
          if (element && element.getBoundingClientRect().top <= top + 150)
            selected = heading.id;
        }
        setActive(selected);
      });
    };
    update();
    root.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [headings, article]);
  return (
    <details
      className="official-outline"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>文档大纲</summary>
      <nav aria-label="文档章节">
        {headings.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={active === item.id ? "location" : undefined}
            style={{ paddingLeft: Math.max(0, item.level - 2) * 12 + 10 }}
            onClick={() => {
              setActive(item.id);
              requestAnimationFrame(() =>
                document
                  .getElementById(item.id)
                  ?.focus({ preventScroll: true }),
              );
            }}
          >
            {item.title}
          </a>
        ))}
      </nav>
    </details>
  );
}
