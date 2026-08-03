import { useState } from "react";
import { ArrowLeft, Boxes, FolderOpen } from "lucide-react";
import { AssetBrowser } from "@features/files/AssetBrowser";

export function VisualWorkshopAssetsPage({
  projectId,
  onCanvas,
  onProjects,
}: {
  projectId: string;
  onCanvas: () => void;
  onProjects: () => void;
}) {
  const [tab, setTab] = useState<"project" | "import">("project");
  return (
    <section className="workshop-page workshop-assets-page">
      <header className="workshop-page-header">
        <div>
          <span>项目资源</span>
          <h1>项目素材库</h1>
          <p>上传项目私有素材，或引用文件管理中的公共文件。</p>
        </div>
        <div className="workshop-header-actions">
          <button onClick={onProjects}>
            <ArrowLeft aria-hidden />
            项目列表
          </button>
          <button className="workshop-primary" onClick={onCanvas}>
            返回画布
          </button>
        </div>
      </header>
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
          aria-selected={tab === "import"}
          className={tab === "import" ? "active" : ""}
          onClick={() => setTab("import")}
        >
          <Boxes aria-hidden />
          从文件管理导入
        </button>
      </div>
      <AssetBrowser
        projectId={projectId}
        importMode={tab === "import"}
        onImported={() => setTab("project")}
      />
    </section>
  );
}
