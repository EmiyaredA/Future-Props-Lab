import { lazy } from "react";
import { PRESENTATION_WORKSHOP_MODULE } from "@features/presentation-workshop/module";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import type { WorkshopPage } from "@app/routes";
import type { NavigationGuard } from "@features/presentation-workshop/types";

const Page = lazy(PRESENTATION_WORKSHOP_MODULE.pages.workspace);
/** Keep the workshop library shell separate from full-screen canvas editors. */
export function PresentationWorkshopRoute({
  page,
  projectId,
  readOnly,
  navigate,
  registerNavigationGuard,
}: {
  page: WorkshopPage;
  projectId?: string;
  readOnly: boolean;
  navigate: (page: WorkshopPage | "apps", id?: string) => void;
  registerNavigationGuard: NavigationGuard;
}) {
  const editing =
    page === "presentation-workshop-editor" ||
    page === "presentation-workshop-template-editor";
  const editor = page === "presentation-workshop-template-editor";
  const content = (
    <Page
      templates={page === "presentation-workshop-templates"}
      templateId={editor ? projectId : undefined}
      projectId={
        page === "presentation-workshop-editor" ? projectId : undefined
      }
      readOnly={readOnly}
      onOpen={(id) => navigate("presentation-workshop-editor", id)}
      onEditTemplate={(id) =>
        navigate("presentation-workshop-template-editor", id)
      }
      onBack={() =>
        navigate(
          editing
            ? editor
              ? "presentation-workshop-templates"
              : "presentation-workshop-projects"
            : "apps",
        )
      }
      registerNavigationGuard={registerNavigationGuard}
    />
  );
  return editing ? (
    content
  ) : (
    <WorkshopShell
      module={PRESENTATION_WORKSHOP_MODULE}
      page={page}
      navigate={(next) => navigate(next as WorkshopPage)}
      onBack={() => navigate("apps")}
    >
      {content}
    </WorkshopShell>
  );
}
