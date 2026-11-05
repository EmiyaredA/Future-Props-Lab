import { lazy } from "react";
import type { AuthMe } from "@features/accounts";
import { accountAllows } from "@features/accounts/permissions";
import type { StudioPage } from "@app/routes";
import { ModelInfrastructureHeader } from "@app/layout/ModelInfrastructureHeader";

const ModelServicePage = lazy(() =>
  import("@features/models/catalog").then((module) => ({
    default: module.ModelServicePage,
  })),
);

export function ModelServiceRoute({
  account,
  navigate,
  onTestModel,
  canWrite,
  focusSelected,
}: {
  account: AuthMe;
  navigate: (page: StudioPage, keyboard?: boolean) => void;
  onTestModel: (model: { id: string }) => void;
  canWrite?: boolean;
  focusSelected?: boolean;
}) {
  return (
    <ModelServicePage
      key={account.user.id}
      canWrite={canWrite ?? accountAllows(account, "configuration.manage")}
      canTest={
        accountAllows(account, "content.write") &&
        accountAllows(account, "models.use")
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
