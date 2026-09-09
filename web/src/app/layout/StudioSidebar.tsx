import { useWorkspacePermission } from "@platform/auth/WorkspacePermissions";
import { ResponsiveSidebar } from "@shared/ui/ResponsiveSidebar";
import { useState } from "react";
import { BrandMark } from "@shared/ui/BrandMark";
import { IntegrationIcon } from "@shared/ui/IntegrationIcon";
import type { StudioPage } from "@app/routes";
import { useOptionalStudioSession } from "@app/StudioSession";
import { WorkspaceTrigger } from "@features/accounts/WorkspaceTrigger";

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" />
    </svg>
  );
}

function AppsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <path d="M17.5 14v7M14 17.5h7" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M3 6.5h7l2 2h9v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5Z" />
      <path d="M3 9h18" />
    </svg>
  );
}

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

function TestIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M9 3h6M10 3v5l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
      <path d="M8 15h8" />
    </svg>
  );
}

function TestToolIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M8 3h8M10 3v5l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
      <path d="M8 15h8M12 12v6" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span className={`nav-chevron${open ? " open" : ""}`}>
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="m9 18 6-6-6-6" />
      </svg>
    </span>
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
  const canReadLogs = useWorkspacePermission("logs.read");
  const [expanded, setExpanded] = useState(true);
  const session = useOptionalStudioSession();
  const toolsActive =
    page === "tools" ||
    page === "video-frame-exporter" ||
    page === "audio-annotation-projects" ||
    page === "audio-annotation-editor";
  const integrationsActive = page.startsWith("integrations-");
  return (
    <ResponsiveSidebar label="主导航" routeKey={page}>
      <aside className="studio-sidebar">
        <div className="sidebar-brand">
          <BrandMark size={36} />
          <div>
            <strong>未来道具研究所</strong>
            <span>Future Props Lab</span>
          </div>
        </div>
        <div className="sidebar-rule" />
        <nav aria-label="主导航">
          <button
            className={`nav-primary${page === "home" ? " active" : ""}`}
            aria-current={page === "home" ? "page" : undefined}
            onClick={() => navigate("home")}
          >
            <HomeIcon />
            <span>首页</span>
          </button>
          <button
            className={`nav-primary${page === "apps" ? " active" : ""}`}
            aria-current={page === "apps" ? "page" : undefined}
            onClick={() => navigate("apps")}
          >
            <AppsIcon />
            <span>AI应用</span>
          </button>
          <button
            className={`nav-primary${page === "files" ? " active" : ""}`}
            aria-current={page === "files" ? "page" : undefined}
            onClick={() => navigate("files")}
          >
            <FilesIcon />
            <span>文件管理</span>
          </button>
          <button
            className={`nav-primary${toolsActive ? " active" : ""}`}
            aria-current={toolsActive ? "page" : undefined}
            onClick={() => navigate("tools")}
          >
            <CompassIcon />
            <span>工具导航</span>
          </button>
          <button
            className={`nav-primary${integrationsActive ? " active" : ""}`}
            aria-current={integrationsActive ? "page" : undefined}
            onClick={() => navigate("integrations-tool-apis")}
          >
            <IntegrationIcon />
            <span>集成中心</span>
          </button>
          <button
            className="nav-group"
            aria-label="基模型"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <CubeIcon />
            <span>基模型</span>
            <Chevron open={expanded} />
          </button>
          {expanded ? (
            <div className="nav-sub" role="group" aria-label="基模型子菜单">
              <button
                className={page === "model-test" ? "active" : ""}
                aria-current={page === "model-test" ? "page" : undefined}
                onClick={() => navigate("model-test")}
              >
                <TestIcon />
                <span>模型测试</span>
              </button>
              <button
                className={page === "model-test-tools" ? "active" : ""}
                aria-current={page === "model-test-tools" ? "page" : undefined}
                onClick={() => navigate("model-test-tools")}
              >
                <TestToolIcon />
                <span>测试工具</span>
              </button>
              <button
                className={page === "model-service" ? "active" : ""}
                aria-current={page === "model-service" ? "page" : undefined}
                onClick={() => navigate("model-service")}
              >
                <ServiceIcon />
                <span>模型服务</span>
              </button>
              {canReadLogs ? (
                <button
                  className={page === "model-call-logs" ? "active" : ""}
                  aria-current={page === "model-call-logs" ? "page" : undefined}
                  onClick={() => navigate("model-call-logs")}
                >
                  <LogsIcon />
                  <span>模型调用日志</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </nav>
        <footer className="sidebar-footer">
          {session ? <WorkspaceTrigger session={session} /> : null}
        </footer>
      </aside>
    </ResponsiveSidebar>
  );
}
