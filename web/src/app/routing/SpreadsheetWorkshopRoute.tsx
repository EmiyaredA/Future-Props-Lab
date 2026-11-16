import { lazy, Suspense } from "react";
import { useStudioSession } from "@app/StudioSession";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { WorkshopUtilities } from "@app/layout/StudioGlobalHeader";
import type { WorkshopPage } from "@app/routes";
import { SPREADSHEET_WORKSHOP_MODULE as module } from "@features/spreadsheet-workshop/module";
import { LoadingState } from "@shared/ui/LoadingState";
import type { Guard } from "@shared/ui/navigationGuards";

const Page = lazy(module.pages.workspace);

export function SpreadsheetWorkshopRoute({
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
  registerNavigationGuard?: (guard: Guard | null) => void;
}) {
  const session = useStudioSession();
  const editor = page === "spreadsheet-workshop-editor";
  const content = (
    <Suspense
      fallback={<LoadingState label="正在打开表格工坊…" variant="region" />}
    >
      <Page
        key={session.me.user.id}
        owner={session.me.user.id}
        projectId={projectId}
        readOnly={readOnly}
        registerNavigationGuard={registerNavigationGuard}
        onOpen={(id) => navigate("spreadsheet-workshop-editor", id)}
        onBack={() => navigate("spreadsheet-workshop-projects")}
        utilities={
          !editor ? <WorkshopUtilities application="表格工坊" /> : undefined
        }
      />
    </Suspense>
  );
  return editor ? (
    content
  ) : (
    <WorkshopShell
      module={module}
      page={page}
      navigate={(next) => navigate(next as WorkshopPage)}
      onBack={() => navigate("apps")}
    >
      {content}
    </WorkshopShell>
  );
}
