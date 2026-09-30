import "./studio-shell.css";
import { useEffect, useState, type ReactNode } from "react";
import {
  StudioCollapsedRail,
  type StudioRailEntry,
} from "@shared/ui/StudioCollapsedRail";
import { useWorkspacePermission } from "@platform/auth/WorkspacePermissions";
import { BrandMark } from "@shared/ui/BrandMark";
import { IntegrationIcon } from "@shared/ui/IntegrationIcon";
import type { StudioPage } from "@app/routes";
import { useOptionalStudioSession } from "@app/StudioSession";
import { WorkspaceTrigger } from "@features/accounts/WorkspaceTrigger";
import { StudioGlobalHeader } from "@app/layout/StudioGlobalHeader";

const SECONDARY_STORAGE_KEY = "future-props-sidebar-studio-secondary-collapsed";
const NARROW_QUERY = "(max-width: 1200px)";

function loadSecondaryCollapsed(): boolean {
  try {
    return localStorage.getItem(SECONDARY_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

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

function CreativeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z" />
      <path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" />
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

function LogsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 4v6h6" />
      <path d="M5.5 16a8 8 0 1 0 .5-9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

type SecondaryItem = {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onSelect: () => void;
};

type PrimarySection = {
  id: string;
  label: string;
  shortLabel: string;
  icon: ReactNode;
  active: boolean;
  page?: StudioPage;
  children?: SecondaryItem[];
};

function useNarrowViewport() {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia(NARROW_QUERY).matches
      : false,
  );
  useEffect(() => {
    const media = window.matchMedia(NARROW_QUERY);
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return narrow;
}

function StudioSecondaryPanel({
  title,
  items,
}: {
  title: string;
  items: SecondaryItem[];
}) {
  return (
    <div className="studio-secondary" aria-label={`${title}导航`}>
      <div className="studio-secondary__header">
        <strong>{title}</strong>
      </div>
      <nav className="studio-secondary__nav" aria-label={`${title}子菜单`}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`studio-secondary__item${item.active ? " is-active" : ""}`}
            aria-current={item.active ? "page" : undefined}
            onClick={item.onSelect}
          >
            <span className="studio-secondary__item-icon" aria-hidden>
              {item.icon}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function StudioChrome({
  page,
  navigate,
  children,
}: {
  page: StudioPage;
  navigate: (page: StudioPage) => void;
  children?: ReactNode;
}) {
  const canReadLogs = useWorkspacePermission("logs.read");
  const session = useOptionalStudioSession();
  const narrow = useNarrowViewport();
  const [secondaryCollapsed, setSecondaryCollapsed] = useState(
    loadSecondaryCollapsed,
  );

  const toolsActive =
    page === "tools" ||
    page === "video-frame-exporter" ||
    page === "codex-model-source";
  const integrationsActive = page.startsWith("integrations-");
  const infrastructurePages: StudioPage[] = [
    "model-test",
    "model-test-tools",
    "model-service",
    "model-call-logs",
  ];
  const infrastructureActive = infrastructurePages.includes(page);

  const modelItems: SecondaryItem[] = [
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
          } satisfies SecondaryItem,
        ]
      : []),
  ];

  const sections: PrimarySection[] = [
    {
      id: "home",
      label: "首页",
      shortLabel: "首页",
      icon: <HomeIcon />,
      active: page === "home",
      page: "home",
    },
    {
      id: "creative-workshop",
      label: "创意工坊",
      shortLabel: "工坊",
      icon: <CreativeIcon />,
      active: page.startsWith("creative-workshop"),
      page: "creative-workshop",
    },
    {
      id: "apps",
      label: "应用",
      shortLabel: "应用",
      icon: <AppsIcon />,
      active: page === "apps",
      page: "apps",
    },
    {
      id: "files",
      label: "文件管理",
      shortLabel: "文件",
      icon: <FilesIcon />,
      active: page === "files",
      page: "files",
    },
    {
      id: "tools",
      label: "工具导航",
      shortLabel: "工具",
      icon: <CompassIcon />,
      active: toolsActive,
      page: "tools",
    },
    {
      id: "integrations",
      label: "集成中心",
      shortLabel: "集成",
      icon: <IntegrationIcon />,
      active: integrationsActive,
      page: "integrations-tool-apis",
    },
    {
      id: "base-models",
      label: "基模型",
      shortLabel: "基模型",
      icon: <CubeIcon />,
      active: infrastructureActive,
      children: modelItems,
    },
  ];

  const activeSection =
    sections.find((section) => section.active) ??
    sections.find((section) => section.id === "home")!;
  const secondaryItems = activeSection.children ?? [];
  const hasSecondary = secondaryItems.length > 0;
  const showSecondary = !narrow && hasSecondary && !secondaryCollapsed;
  const preferFlyout = !showSecondary;

  const openSecondary = () => {
    if (narrow) return;
    setSecondaryCollapsed(false);
    try {
      localStorage.setItem(SECONDARY_STORAGE_KEY, "false");
    } catch {
      // Storage can be unavailable in privacy modes.
    }
  };

  const toggleSecondary = () => {
    if (!hasSecondary || narrow) return;
    setSecondaryCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(SECONDARY_STORAGE_KEY, String(next));
      } catch {
        // Storage can be unavailable in privacy modes.
      }
      return next;
    });
  };

  const railEntries: StudioRailEntry[] = sections.map((section) => {
    if (section.children?.length) {
      return {
        kind: "group",
        id: section.id,
        label: section.label,
        shortLabel: section.shortLabel,
        icon: section.icon,
        active: section.active,
        onSelect: () => {
          openSecondary();
          const current = section.children?.find((item) => item.active);
          (current ?? section.children?.[0])?.onSelect();
        },
        items: section.children.map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon,
          active: item.active,
          onSelect: item.onSelect,
        })),
      };
    }
    return {
      kind: "leaf",
      id: section.id,
      label: section.label,
      shortLabel: section.shortLabel,
      icon: section.icon,
      active: section.active,
      onSelect: () => {
        if (!section.page) return;
        if (section.id === "integrations" && page.startsWith("integrations-")) {
          return;
        }
        navigate(section.page);
      },
    };
  });

  const canToggleSecondary = hasSecondary && !narrow;

  const leftPanel = (
    <aside
      className={`studio-panel studio-sidebar${showSecondary ? " has-secondary" : ""}`}
    >
      <div className="studio-sidebar__rail">
        <StudioCollapsedRail
          labeled
          preferFlyout={preferFlyout}
          brand={<BrandMark size={32} />}
          entries={railEntries}
          routeKey={page}
          secondaryToggle={
            canToggleSecondary
              ? {
                  collapsed: secondaryCollapsed,
                  label: secondaryCollapsed ? "展开二级导航" : "收起二级导航",
                  onToggle: toggleSecondary,
                }
              : undefined
          }
          footer={session ? <WorkspaceTrigger session={session} /> : null}
        />
      </div>
      {showSecondary ? (
        <StudioSecondaryPanel
          title={activeSection.label}
          items={secondaryItems}
        />
      ) : null}
    </aside>
  );

  if (children === undefined) {
    return (
      <div
        className={`studio-shell${showSecondary ? " has-secondary" : ""}`}
        data-studio-chrome="sidebar-only"
      >
        {leftPanel}
      </div>
    );
  }

  return (
    <div className={`studio-shell${showSecondary ? " has-secondary" : ""}`}>
      {leftPanel}
      <div className="studio-stage">
        <StudioGlobalHeader />
        <main className="studio-panel studio-main">{children}</main>
      </div>
    </div>
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
    <StudioChrome page={page} navigate={navigate}>
      {children}
    </StudioChrome>
  );
}

export function StudioSidebar({
  page,
  navigate,
}: {
  page: StudioPage;
  navigate: (page: StudioPage) => void;
}) {
  return <StudioChrome page={page} navigate={navigate} />;
}
