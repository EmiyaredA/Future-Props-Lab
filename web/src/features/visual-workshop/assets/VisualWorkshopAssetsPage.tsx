import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Boxes, FolderOpen, Folders } from "lucide-react";
import { AssetBrowser } from "@features/files";
import { getVisualWorkshopProjects } from "@features/visual-workshop/api";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";

export function VisualWorkshopAssetsPage({
  projectId,
  onCanvas,
  onProjects,
}: {
  projectId: string;
  onCanvas: () => void;
  onProjects: () => void;
}) {
  const [tab, setTab] = useState<"project" | "cross" | "library">("project");
  const [crossSourceProjectId, setCrossSourceProjectId] = useState("");
  const mediaSourceProjects = useQuery({
    queryKey: visualWorkshopQueryKeys.projectsForMediaSource,
    queryFn: getVisualWorkshopProjects,
    enabled: tab === "cross",
  });
  const sourceProjects = useMemo(
    () =>
      mediaSourceProjects.data?.items.filter(
        (project) => project.id !== projectId,
      ) ?? [],
    [mediaSourceProjects.data, projectId],
  );
  return (
    <section className="workshop-page workshop-assets-page">
      <WorkshopAppChrome
        eyebrow="项目资源"
        title="项目素材库"
        description="管理本项目素材，从其他项目复制导入，或引用文件管理中的公共文件。"
        actions={
          <div className="workshop-header-actions">
            <button onClick={onProjects}>
              <ArrowLeft aria-hidden />
              项目列表
            </button>
            <button className="workshop-primary" onClick={onCanvas}>
              返回画布
            </button>
          </div>
        }
      />
      <div className="workshop-assets-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "project"}
          className={tab === "project" ? "active" : ""}
          onClick={() => setTab("project")}
        >
          <FolderOpen aria-hidden />
          本项目
        </button>
        <button
          role="tab"
          aria-selected={tab === "cross"}
          className={tab === "cross" ? "active" : ""}
          onClick={() => setTab("cross")}
        >
          <Folders aria-hidden />
          跨项目
        </button>
        <button
          role="tab"
          aria-selected={tab === "library"}
          className={tab === "library" ? "active" : ""}
          onClick={() => setTab("library")}
        >
          <Boxes aria-hidden />
          总文件
        </button>
      </div>
      {tab === "project" ? (
        <AssetBrowser projectId={projectId} />
      ) : tab === "cross" ? (
        <AssetBrowser
          importSource="cross-project"
          projectId={projectId}
          browseProjectId={crossSourceProjectId || undefined}
          onBrowseProjectIdChange={setCrossSourceProjectId}
          sourceProjects={sourceProjects}
          sourceProjectsLoading={mediaSourceProjects.isLoading}
          onImported={() => setTab("project")}
        />
      ) : (
        <AssetBrowser
          importSource="library"
          projectId={projectId}
          onImported={() => setTab("project")}
        />
      )}
    </section>
  );
}
