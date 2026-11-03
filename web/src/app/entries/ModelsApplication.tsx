import { lazy, Suspense, type MouseEvent } from "react";
import { RuntimeAccessProvider } from "@features/accounts/RuntimeAccessProvider";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { useStudioSession } from "@app/StudioSession";
import { IndependentShell } from "./IndependentShell";
import { guardedNavigation } from "./navigation";
import "./models.css";

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

const views = [
  { path: "/model-service", label: "模型目录" },
  { path: "/model-test", label: "模型测试" },
  { path: "/model-call-logs", label: "调用日志" },
];

function follow(event: MouseEvent<HTMLAnchorElement>) {
  if (
    event.button ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  const target = event.currentTarget.href;
  guardedNavigation(() => location.assign(target), true);
}

export default function ModelsApplication() {
  const { me } = useStudioSession();
  const canWrite = useAccountPermission("configuration.manage");
  const canWriteContent = useAccountPermission("content.write");
  const canUseModels = useAccountPermission("models.use");
  const canTest = canWriteContent && canUseModels;
  const canReadLogs = useAccountPermission("logs.read");
  const path = location.pathname.replace(/\/$/, "");
  const query = new URLSearchParams(location.search);
  const known = views.some((view) => view.path === path);
  return (
    <RuntimeAccessProvider>
      <IndependentShell title="模型服务">
        <div className="model-service-workspace">
          <nav className="model-service-navigation" aria-label="模型服务页面">
            {views.map((view) => (
              <a
                key={view.path}
                href={view.path}
                onClick={follow}
                aria-current={path === view.path ? "page" : undefined}
              >
                {view.label}
              </a>
            ))}
          </nav>
          <div className="model-service-view">
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
          </div>
        </div>
      </IndependentShell>
    </RuntimeAccessProvider>
  );
}
