import { lazy } from "react";
import type { Workspace } from "@features/accounts";
import { workspaceAllows } from "@features/accounts/permissions";
import type { StudioPage } from "@app/routes";
import { ModelInfrastructureHeader } from "./ModelInfrastructureHeader";

const ModelServicePage = lazy(() =>
  import("@features/models/catalog").then((module) => ({
    default: module.ModelServicePage,
  })),
);

export function ModelServiceRoute({
  workspace,
  navigate,
  onTestModel,
  canWrite,
  focusSelected,
}: {
  workspace: Workspace;
  navigate: (page: StudioPage, keyboard?: boolean) => void;
  onTestModel: (model: { id: string }) => void;
  canWrite?: boolean;
  focusSelected?: boolean;
}) {
  return (
    <ModelServicePage
      key={workspace.id}
      canWrite={canWrite ?? workspaceAllows(workspace, "configuration.manage")}
      canTest={
        workspaceAllows(workspace, "content.write") &&
        workspaceAllows(workspace, "models.use")
      }
      onTestModel={onTestModel}
      renderHeader={(actions) => (
        <ModelInfrastructureHeader
          page="model-service"
          navigate={navigate}
          focusSelected={focusSelected}
          actions={actions}
        />
      )}
    />
  );
}
