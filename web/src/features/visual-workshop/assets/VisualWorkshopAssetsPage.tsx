import { lazy, Suspense, useId, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Boxes, FolderOpen, Folders } from "lucide-react";
import { AssetBrowser, ReadOnlyFiles } from "@features/files";
import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import { getVisualWorkshopProjects } from "../api";
import type { CardKind } from "../creative/api";
import { cardKindInfo, cardKinds } from "../creative/cardKinds";
import { visualWorkshopQueryKeys } from "../queryKeys";
import "./project-asset-tabs.css";

const AssetCards = lazy(() =>
  import("../creative/AssetCards").then(({ AssetCards }) => ({
    default: AssetCards,
  })),
);

const projectTabs = [
  { id: "files", label: "文件", icon: FolderOpen },
  ...cardKinds.map((id) => ({ id, ...cardKindInfo[id] })),
] as const;

const importTabs = [
  { id: "cross", label: "跨项目", icon: Folders },
  { id: "library", label: "总文件", icon: Boxes },
] as const;

type AssetTab = "files" | CardKind | "cross" | "library";

export function VisualWorkshopAssetsPage({
  utilities,
  projectId,
  onCanvas,
  onProjects,
  readOnly = false,
}: {
  utilities?: ReactNode;
  projectId: string;
  onCanvas: () => void;
  onProjects: () => void;
  readOnly?: boolean;
}) {
  const id = useId();
  const panelId = `${id}-panel`;
  const [tab, setTab] = useState<AssetTab>("files");
  const [crossSourceProjectId, setCrossSourceProjectId] = useState("");
  const tabs = readOnly ? projectTabs : [...projectTabs, ...importTabs];
  const showsImport = !readOnly && (tab === "cross" || tab === "library");
  const mediaSourceProjects = useQuery({
    queryKey: visualWorkshopQueryKeys.projectsForMediaSource,
    queryFn: getVisualWorkshopProjects,
    enabled: showsImport,
  });
  const sourceProjects =
    mediaSourceProjects.data?.items.filter(
      (project) => project.id !== projectId,
    ) ?? [];

  return (
    <section className="workshop-page workshop-assets-page">
      <WorkshopAppChrome
        utilities={utilities}
        title="项目素材库"
        description={readOnly ? "只读 · 可浏览文件和设定卡" : undefined}
        actions={
          <div className="workshop-header-actions">
            <button type="button" onClick={onProjects}>
              <ArrowLeft aria-hidden />
              项目列表
            </button>
            <button
              type="button"
              className="workshop-primary"
              onClick={onCanvas}
            >
              前往画布
            </button>
          </div>
        }
      />
      <div
        className="workshop-assets-tabs project-asset-tabs"
        role="tablist"
        aria-label="项目资产"
      >
        {tabs.map(({ id: key, label, icon: Icon }, index) => (
          <button
            key={key}
            id={`${id}-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={panelId}
            tabIndex={tab === key ? 0 : -1}
            data-import-start={key === "cross" || undefined}
            className={tab === key ? "active" : undefined}
            onClick={() => setTab(key)}
            onKeyDown={(event) => {
              const next = {
                ArrowLeft: (index + tabs.length - 1) % tabs.length,
                ArrowRight: (index + 1) % tabs.length,
                Home: 0,
                End: tabs.length - 1,
              }[event.key];
              if (next === undefined) return;
              event.preventDefault();
              const target = tabs[next].id;
              setTab(target);
              document.getElementById(`${id}-${target}`)?.focus();
            }}
          >
            <Icon aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={`${id}-${tab}`}>
        {tab === "files" ? (
          readOnly ? (
            <ReadOnlyFiles projectId={projectId} embedded />
          ) : (
            <AssetBrowser projectId={projectId} />
          )
        ) : tab === "cross" ? (
          <AssetBrowser
            importSource="cross-project"
            projectId={projectId}
            browseProjectId={crossSourceProjectId || undefined}
            onBrowseProjectIdChange={setCrossSourceProjectId}
            sourceProjects={sourceProjects}
            sourceProjectsLoading={mediaSourceProjects.isLoading}
            onImported={() => setTab("files")}
          />
        ) : tab === "library" ? (
          <AssetBrowser
            importSource="library"
            projectId={projectId}
            sourceProjects={sourceProjects}
            sourceProjectsLoading={mediaSourceProjects.isLoading}
            onImported={() => setTab("files")}
          />
        ) : (
          <Suspense
            fallback={<p role="status">正在打开{cardKindInfo[tab].label}…</p>}
          >
            <AssetCards
              key={tab}
              project={projectId}
              fixedKind={tab}
              readOnly={readOnly}
            />
          </Suspense>
        )}
      </div>
    </section>
  );
}
