import { useQuery } from "@tanstack/react-query";
import { getProject } from "./api";
import { presentationKeys } from "./queryKeys";
import { PresentationLibrary } from "./PresentationLibrary";
import { PresentationEditor } from "./PresentationEditor";
import type { NavigationGuard } from "./types";
import "./presentation-workshop.css";
import "./presentation-library.css";
import "./presentation-canvas.css";
import "./presentation-controls.css";

export function PresentationWorkshopPage({
  projectId,
  onOpen,
  onBack,
  readOnly = false,
  registerNavigationGuard,
}: {
  projectId?: string;
  onOpen: (id: string) => void;
  onBack: () => void;
  readOnly?: boolean;
  registerNavigationGuard?: NavigationGuard;
}) {
  const project = useQuery({
    queryKey: presentationKeys.project(projectId ?? ""),
    queryFn: ({ signal }) => getProject(projectId!, signal),
    enabled: !!projectId,
  });
  if (!projectId)
    return <PresentationLibrary onOpen={onOpen} readOnly={readOnly} />;
  if (project.isPending)
    return (
      <div className="presentation-loading" role="status">
        正在打开演示文稿…
      </div>
    );
  if (project.isError || !project.data)
    return (
      <div className="presentation-loading" role="alert">
        文稿加载失败
        <button className="btn" onClick={() => void project.refetch()}>
          重试
        </button>
        <button className="btn" onClick={onBack}>
          返回文稿列表
        </button>
      </div>
    );
  return (
    <PresentationEditor
      key={projectId}
      initial={project.data}
      readOnly={readOnly}
      onOpen={onOpen}
      onBack={onBack}
      registerNavigationGuard={registerNavigationGuard}
    />
  );
}
