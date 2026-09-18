import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleQuestionMark, Grid2X2, List, X } from "lucide-react";
import { AssetBrowser, type AssetViewMode } from "@features/files";
import { getVisualWorkshopProjects } from "@features/visual-workshop/api";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";

export type CanvasAssetTab = "project" | "cross" | "library";

export function CanvasAssetsDrawer({
  projectId,
  assetTab,
  onAssetTabChange,
  assetView,
  onAssetViewChange,
  onClose,
}: {
  projectId: string;
  assetTab: CanvasAssetTab;
  onAssetTabChange: (tab: CanvasAssetTab) => void;
  assetView: AssetViewMode;
  onAssetViewChange: (view: AssetViewMode) => void;
  onClose: () => void;
}) {
  const [crossSourceProjectId, setCrossSourceProjectId] = useState("");
  const mediaSourceProjects = useQuery({
    queryKey: visualWorkshopQueryKeys.projectsForMediaSource,
    queryFn: getVisualWorkshopProjects,
    enabled: assetTab === "cross",
  });
  const sourceProjects = useMemo(
    () =>
      mediaSourceProjects.data?.items.filter(
        (project) => project.id !== projectId,
      ) ?? [],
    [mediaSourceProjects.data, projectId],
  );

  return (
    <aside className="canvas-assets-drawer" aria-label="项目素材库">
      <header>
        <div className="canvas-assets-title">
          <strong>素材库</strong>
          <span title="管理本项目与总文件公共库，或从其他项目导入">
            <CircleQuestionMark aria-hidden />
          </span>
        </div>
        <div className="canvas-assets-header-actions">
          <div className="file-view-toggle" role="group" aria-label="文件视图">
            <button
              type="button"
              aria-label="卡片视图"
              aria-pressed={assetView === "grid"}
              className={assetView === "grid" ? "active" : ""}
              onClick={() => onAssetViewChange("grid")}
            >
              <Grid2X2 aria-hidden />
            </button>
            <button
              type="button"
              aria-label="列表视图"
              aria-pressed={assetView === "list"}
              className={assetView === "list" ? "active" : ""}
              onClick={() => onAssetViewChange("list")}
            >
              <List aria-hidden />
            </button>
          </div>
          <button
            className="canvas-assets-close"
            aria-label="关闭素材库"
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </div>
      </header>
      <nav className="canvas-assets-tabs" role="tablist">
        <button
          className={assetTab === "project" ? "active" : ""}
          role="tab"
          aria-selected={assetTab === "project"}
          onClick={() => onAssetTabChange("project")}
        >
          本项目
        </button>
        <button
          className={assetTab === "cross" ? "active" : ""}
          role="tab"
          aria-selected={assetTab === "cross"}
          onClick={() => onAssetTabChange("cross")}
        >
          跨项目
        </button>
        <button
          className={assetTab === "library" ? "active" : ""}
          role="tab"
          aria-selected={assetTab === "library"}
          onClick={() => onAssetTabChange("library")}
        >
          总文件
        </button>
      </nav>
      {assetTab === "project" ? (
        <AssetBrowser
          compact
          projectId={projectId}
          viewMode={assetView}
          onViewModeChange={onAssetViewChange}
        />
      ) : assetTab === "cross" ? (
        <AssetBrowser
          compact
          importSource="cross-project"
          projectId={projectId}
          browseProjectId={crossSourceProjectId || undefined}
          onBrowseProjectIdChange={setCrossSourceProjectId}
          sourceProjects={sourceProjects}
          sourceProjectsLoading={mediaSourceProjects.isLoading}
          viewMode={assetView}
          onViewModeChange={onAssetViewChange}
          onImported={() => onAssetTabChange("project")}
        />
      ) : (
        <AssetBrowser
          compact
          importSource="library"
          projectId={projectId}
          viewMode={assetView}
          onViewModeChange={onAssetViewChange}
          onImported={() => onAssetTabChange("project")}
        />
      )}
    </aside>
  );
}
