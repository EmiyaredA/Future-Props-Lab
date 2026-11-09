import type { ReactNode } from "react";
import { LoadingState } from "@shared/ui/LoadingState";
import { TemplateDesignerPage } from "./master/TemplateDesignerPage";
import { TemplateLibrary } from "./master/TemplateLibrary";
import { Audience } from "./playback/Audience";
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
import "./presentation-dialog.css";
import "./master/master.css";
import "./master/master-studio.css";

export function PresentationWorkshopPage({
  utilities,
  projectId,
  templateId,
  onEditTemplate,
  templates = false,
  onOpen,
  onBack,
  readOnly = false,
  registerNavigationGuard,
}: {
  utilities?: ReactNode;
  projectId?: string;
  templateId?: string;
  onEditTemplate?: (id: string) => void;
  templates?: boolean;
  onOpen: (id: string) => void;
  onBack: () => void;
  readOnly?: boolean;
  registerNavigationGuard?: NavigationGuard;
}) {
  const audience = new URLSearchParams(window.location.search).get(
    "presentationAudience",
  );
  const project = useQuery({
    queryKey: presentationKeys.project(projectId ?? ""),
    queryFn: ({ signal }) => getProject(projectId!, signal),
    enabled: !!projectId && !audience,
  });
  if (audience && projectId)
    return <Audience sessionId={audience} projectId={projectId} />;
  if (templateId)
    return (
      <TemplateDesignerPage
        id={templateId}
        onBack={onBack}
        onOpen={onEditTemplate!}
        readOnly={readOnly}
        registerNavigationGuard={registerNavigationGuard}
      />
    );
  if (templates)
    return (
      <TemplateLibrary
        utilities={utilities}
        onOpen={onOpen}
        readOnly={readOnly}
        onEdit={onEditTemplate!}
      />
    );
  if (!projectId)
    return (
      <PresentationLibrary
        utilities={utilities}
        onOpen={onOpen}
        readOnly={readOnly}
      />
    );
  if (project.isPending)
    return <LoadingState label="正在打开演示文稿…" variant="page" />;
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
