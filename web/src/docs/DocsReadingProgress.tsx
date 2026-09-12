import { useEffect, useState } from "react";

export function DocsReadingProgress({ pageId }: { pageId: string }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const article = document.querySelector(".docs-article");
        if (!article) return;
        const bounds = article.getBoundingClientRect();
        const distance = Math.max(1, bounds.height - window.innerHeight + 100);
        setProgress(
          Math.min(
            100,
            Math.max(0, Math.round(((100 - bounds.top) / distance) * 100)),
          ),
        );
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [pageId]);
  return (
    <div className="docs-reading-progress">
      <div>
        <span>阅读进度</span>
        <span>{progress}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="阅读进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
