import { useState } from "react";
import { BrandMark } from "@shared/ui/BrandMark";
import { ThemeToggle } from "@shared/ui/ThemeToggle";

export type StudioPage = "model-service" | "model-call-logs";

function CubeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 7 9 5 9-5v10l-9 5-9-5V7Z" />
      <path d="M12 12v10" />
    </svg>
  );
}

function ServiceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="5" width="18" height="5" rx="2" />
      <rect x="3" y="14" width="18" height="5" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01M12 7.5h6M12 16.5h6" />
    </svg>
  );
}

function LogsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 4v6h6" />
      <path d="M5.5 16a8 8 0 1 0 .5-9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function StudioSidebar({
  page,
  navigate,
}: {
  page: StudioPage;
  navigate: (page: StudioPage) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <aside className="studio-sidebar">
      <div className="sidebar-brand">
        <BrandMark />
        <div>
          <strong>未来道具研究所</strong>
          <span>Future Props Lab</span>
        </div>
      </div>
      <div className="sidebar-rule" />
      <nav aria-label="主导航">
        <button
          className="nav-group"
          aria-label="基模型"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <CubeIcon />
          <span>基模型</span>
          <i className={expanded ? "open" : ""}>⌄</i>
        </button>
        {expanded ? (
          <div className="nav-sub" role="group" aria-label="基模型子菜单">
            <button
              className={page === "model-service" ? "active" : ""}
              aria-current={page === "model-service" ? "page" : undefined}
              onClick={() => navigate("model-service")}
            >
              <ServiceIcon />
              <span>模型服务</span>
            </button>
            <button
              className={page === "model-call-logs" ? "active" : ""}
              aria-current={page === "model-call-logs" ? "page" : undefined}
              onClick={() => navigate("model-call-logs")}
            >
              <LogsIcon />
              <span>模型调用日志</span>
            </button>
          </div>
        ) : null}
      </nav>
      <footer className="sidebar-footer">
        <div className="sidebar-rule" />
        <button
          className="docs-entry"
          onClick={() =>
            window.open("/docs.html", "_blank", "noopener,noreferrer")
          }
        >
          文档中心 <span>↗</span>
        </button>
        <ThemeToggle />
      </footer>
    </aside>
  );
}
