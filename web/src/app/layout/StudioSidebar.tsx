import {
  ResponsiveSidebarPanel,
  ResponsiveSidebarProvider,
  SidebarCollapseToggle,
} from "@shared/ui/ResponsiveSidebar";
import {
  StudioCollapsedRail,
  type StudioRailEntry,
} from "@shared/ui/StudioCollapsedRail";
import { useWorkspacePermission } from "@platform/auth/WorkspacePermissions";
import { useState, type ReactNode } from "react";
import { BrandMark } from "@shared/ui/BrandMark";
import { IntegrationIcon } from "@shared/ui/IntegrationIcon";
import type { StudioPage } from "@app/routes";
import { useOptionalStudioSession } from "@app/StudioSession";
import { WorkspaceTrigger } from "@features/accounts/WorkspaceTrigger";
import { useSidebarLayout } from "@shared/ui/sidebarLayoutContext";

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

function StudioSidebarPanel({
  page,
  navigate,
}: {
  page: StudioPage;
  navigate: (page: StudioPage) => void;
}) {
  const canReadLogs = useWorkspacePermission("logs.read");
  const [expanded, setExpanded] = useState(true);
  const session = useOptionalStudioSession();
  const layout = useSidebarLayout();
  const toolsActive =
    page === "tools" ||
    page === "video-frame-exporter" ||
    page === "audio-annotation-projects" ||
    page === "audio-annotation-editor";
  const integrationsActive = page.startsWith("integrations-");
  const infrastructurePages: StudioPage[] = [
    "model-test",
    "model-test-tools",
    "model-service",
    "model-call-logs",
  ];
  const infrastructureActive = infrastructurePages.includes(page);
  const compact = Boolean(layout?.railCompact);
  const showInfrastructureSub = expanded && !compact;
  const modelItems = [
    {
      id: "model-test",
      label: "模型测试",
      icon: <TestIcon />,
      active: page === "model-test",
      onSelect: () => navigate("model-test"),
    },
    {
      id: "model-test-tools",
      label: "测试工具",
      icon: <TestToolIcon />,
      active: page === "model-test-tools",
      onSelect: () => navigate("model-test-tools"),
    },
    {
      id: "model-service",
      label: "模型服务",
      icon: <ServiceIcon />,
      active: page === "model-service",
      onSelect: () => navigate("model-service"),
    },
    ...(canReadLogs
      ? [
          {
            id: "model-call-logs",
            label: "模型调用日志",
            icon: <LogsIcon />,
            active: page === "model-call-logs",
            onSelect: () => navigate("model-call-logs"),
          },
        ]
      : []),
  ];
  const railEntries: StudioRailEntry[] = [
    {
      kind: "leaf",
      id: "home",
      label: "首页",
      icon: <HomeIcon />,
      active: page === "home",
      onSelect: () => navigate("home"),
    },
    {
      kind: "leaf",
      id: "apps",
      label: "AI应用",
      icon: <AppsIcon />,
      active: page === "apps",
      onSelect: () => navigate("apps"),
    },
    {
      kind: "leaf",
      id: "files",
      label: "文件管理",
      icon: <FilesIcon />,
      active: page === "files",
      onSelect: () => navigate("files"),
    },
    {
      kind: "leaf",
      id: "tools",
      label: "工具导航",
      icon: <CompassIcon />,
      active: toolsActive,
      onSelect: () => navigate("tools"),
    },
    {
      kind: "leaf",
      id: "integrations",
      label: "集成中心",
      icon: <IntegrationIcon />,
      active: integrationsActive,
      onSelect: () => navigate("integrations-tool-apis"),
    },
    {
      kind: "group",
      id: "base-models",
      label: "基模型",
      icon: <CubeIcon />,
      active: infrastructureActive,
      items: modelItems,
    },
  ];

  if (compact) {
    return (
      <aside className="studio-sidebar is-rail">
        <StudioCollapsedRail
          brand={<BrandMark size={32} />}
          entries={railEntries}
          routeKey={page}
          onExpand={() => layout?.expand()}
          expandDisabled={Boolean(layout?.narrow)}
          footer={session ? <WorkspaceTrigger session={session} /> : null}
        />
      </aside>
    );
  }

  return (
    <aside className="studio-sidebar">
      <div className="sidebar-brand">
        <BrandMark size={36} />
        <div>
          <strong>未来道具研究所</strong>
          <span>Future Props Lab</span>
        </div>
        <SidebarCollapseToggle />
      </div>
      <div className="sidebar-rule" />
      <nav aria-label="主导航">
        <div className="nav-section-label">工作台</div>
        <button
          className={`nav-primary${page === "home" ? " active" : ""}`}
          aria-current={page === "home" ? "page" : undefined}
          aria-label="首页"
          onClick={() => navigate("home")}
        >
          <HomeIcon />
          <span>首页</span>
        </button>
        <button
          className={`nav-primary${page === "apps" ? " active" : ""}`}
          aria-current={page === "apps" ? "page" : undefined}
          aria-label="AI应用"
          onClick={() => navigate("apps")}
        >
          <AppsIcon />
          <span>AI应用</span>
        </button>
        <button
          className={`nav-primary${page === "files" ? " active" : ""}`}
          aria-current={page === "files" ? "page" : undefined}
          aria-label="文件管理"
          onClick={() => navigate("files")}
        >
          <FilesIcon />
          <span>文件管理</span>
        </button>
        <button
          className={`nav-primary${toolsActive ? " active" : ""}`}
          aria-current={toolsActive ? "page" : undefined}
          aria-label="工具导航"
          onClick={() => navigate("tools")}
        >
          <CompassIcon />
          <span>工具导航</span>
        </button>
        <button
          className={`nav-primary${integrationsActive ? " active" : ""}`}
          aria-current={integrationsActive ? "page" : undefined}
          aria-label="集成中心"
          onClick={() => navigate("integrations-tool-apis")}
        >
          <IntegrationIcon />
          <span>集成中心</span>
        </button>
        <div className="nav-section-label nav-section-label--spaced">
          基础设施
        </div>
        <button
          className={`nav-group${infrastructureActive ? " active" : ""}`}
          aria-label="基模型"
          aria-expanded={showInfrastructureSub}
          onClick={() => setExpanded((value) => !value)}
        >
          <CubeIcon />
          <span>基模型</span>
          <Chevron open={showInfrastructureSub} />
        </button>
        {showInfrastructureSub ? (
          <div className="nav-sub" role="group" aria-label="基模型子菜单">
            {modelItems.map((item) => (
              <button
                key={item.id}
                className={item.active ? "active" : ""}
                aria-current={item.active ? "page" : undefined}
                onClick={item.onSelect}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </nav>
      <footer className="sidebar-footer">
        {session ? <WorkspaceTrigger session={session} /> : null}
      </footer>
    </aside>
  );
}

export function StudioShell({
  page,
  navigate,
  children,
}: {
  page: StudioPage;
  navigate: (page: StudioPage) => void;
  children: ReactNode;
}) {
  return (
    <ResponsiveSidebarProvider
      label="主导航"
      routeKey={page}
      collapsible
      storageKey="future-props-sidebar-studio-collapsed"
    >
      <div className="studio-shell">
        <ResponsiveSidebarPanel>
          <StudioSidebarPanel page={page} navigate={navigate} />
        </ResponsiveSidebarPanel>
        <main className="studio-main">{children}</main>
      </div>
    </ResponsiveSidebarProvider>
  );
}

export function StudioSidebar({
  page,
  navigate,
}: {
  page: StudioPage;
  navigate: (page: StudioPage) => void;
}) {
  return (
    <ResponsiveSidebarProvider
      label="主导航"
      routeKey={page}
      collapsible
      storageKey="future-props-sidebar-studio-collapsed"
    >
      <ResponsiveSidebarPanel>
        <StudioSidebarPanel page={page} navigate={navigate} />
      </ResponsiveSidebarPanel>
    </ResponsiveSidebarProvider>
  );
}
