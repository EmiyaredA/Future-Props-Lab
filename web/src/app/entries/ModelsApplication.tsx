import { lazy, Suspense } from "react";
import { ModelInfrastructureHeader } from "@app/layout/ModelInfrastructureHeader";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { useStudioSession } from "@app/StudioSession";
import { StudioServiceShell } from "./StudioServiceShell";
import {
  navigateModelInfrastructure,
  useModelInfrastructureFocus,
} from "./modelInfrastructureNavigation";
import { guardedNavigation } from "./navigation";

const Catalog = lazy(() =>
  import("@features/models/catalog/ModelServicePage").then((module) => ({
    default: module.ModelServicePage,
  })),
);
const Test = lazy(() =>
  import("@features/models/conversation/ModelTestPage").then((module) => ({
    default: module.ModelTestPage,
  })),
);
const ReadOnlyTest = lazy(() =>
  import("@features/models/ReadOnlyModels").then((module) => ({
    default: module.ReadOnlyModels,
  })),
);
const Logs = lazy(() =>
  import("@features/models/logs/ModelCallLogsPage").then((module) => ({
    default: module.ModelCallLogsPage,
  })),
);

export default function ModelsApplication() {
  const { me } = useStudioSession();
  const canWrite = useAccountPermission("configuration.manage");
  const canWriteContent = useAccountPermission("content.write");
  const canUseModels = useAccountPermission("models.use");
  const canTest = canWriteContent && canUseModels;
  const canReadLogs = useAccountPermission("logs.read");
  const path = location.pathname.replace(/\/$/, "");
  const query = new URLSearchParams(location.search);
  const known = ["/model-service", "/model-test", "/model-call-logs"].includes(
    path,
  );
  const focusSelected = useModelInfrastructureFocus("model-service");
  return (
    <StudioServiceShell title="模型服务">
      <Suspense
        fallback={<div className="page-loading">正在打开模型页面…</div>}
      >
        {!known ? (
          <section className="independent-not-found">
            <h1>页面不存在</h1>
            <a href="/model-service">返回模型目录</a>
          </section>
        ) : path === "/model-service" ? (
          <Catalog
            canWrite={canWrite}
            canTest={canTest}
            renderHeader={(actions) => (
              <ModelInfrastructureHeader
                page="model-service"
                navigate={navigateModelInfrastructure}
                focusSelected={focusSelected}
                actions={actions}
              />
            )}
            onTestModel={(model) =>
              guardedNavigation(
                () =>
                  location.assign(
                    "/model-test?model=" + encodeURIComponent(model.id),
                  ),
                true,
              )
            }
          />
        ) : path === "/model-test" ? (
          canTest ? (
            <Test
              initialModelId={query.get("model")}
              initialMode={query.get("mode") ?? undefined}
              onOpenAudioAnnotation={(id) =>
                guardedNavigation(
                  () =>
                    location.assign(
                      "/apps/audio-annotation/" + encodeURIComponent(id),
                    ),
                  true,
                )
              }
            />
          ) : (
            <ReadOnlyTest />
          )
        ) : canReadLogs ? (
          <Logs
            currentAccount={{
              id: me.user.id,
              name: me.user.display_name,
            }}
          />
        ) : (
          <section className="independent-not-found" role="alert">
            <h1>当前账号没有调用日志读取权限</h1>
            <a href="/model-service">返回模型目录</a>
          </section>
        )}
      </Suspense>
    </StudioServiceShell>
  );
}
