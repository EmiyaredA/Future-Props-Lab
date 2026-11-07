import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Monitor, Terminal } from "lucide-react";
import { CloudSetupDialog } from "./CloudSetupDialog";
import { CloudControlAccess } from "./CloudControlAccess";
import { CloudUnlock } from "./CloudUnlock";
import { RemoteDesktop } from "./RemoteDesktop";
import { RemoteApps } from "./RemoteApps";
import { HappierWorkspace } from "./HappierWorkspace";
import { readCloudStatus } from "./cloudApi";
import "./workspace-layout.css";

const VIEWS = {
  desktop: { label: "远程桌面", Icon: Monitor },
  agent: { label: "Agent 工作台", Icon: Terminal },
} as const;

type View = keyof typeof VIEWS;
const viewOrder: readonly View[] = ["desktop", "agent"];

function viewKey(owner: string) {
  return `fpl.cloud-control.view.${owner}`;
}

function savedView(owner: string, preferAgent: boolean): View {
  if (preferAgent) return "agent";
  try {
    return localStorage.getItem(viewKey(owner)) === "agent"
      ? "agent"
      : "desktop";
  } catch {
    return "desktop";
  }
}

function CloudWorkspace({
  owner,
  preferAgent = false,
  hideUnavailableAgent = false,
}: {
  owner: string;
  preferAgent?: boolean;
  hideUnavailableAgent?: boolean;
}) {
  const paneId = useId();
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [selected, setView] = useState<View>(() =>
    savedView(owner, preferAgent),
  );
  useEffect(() => {
    if (preferAgent) setView("agent");
  }, [preferAgent]);

  function selectView(next: View) {
    setView(next);
    try {
      localStorage.setItem(viewKey(owner), next);
    } catch {
      // The selected view stays usable without browser storage.
    }
  }

  const [dialog, setDialog] = useState<"agent" | "desktop" | "setup">();
  const status = useQuery({
    queryKey: ["cloud-control", owner, "status"],
    queryFn: ({ signal }) => readCloudStatus(signal),
    refetchInterval: 15_000,
  });
  const desktopOnly =
    hideUnavailableAgent &&
    !status.data?.happier_available &&
    !status.data?.happier_studio_url;
  const view = desktopOnly ? "desktop" : selected;
  const [now, setNow] = useState(() => Date.now());
  const showRemoteToolbar =
    status.data?.remote_apps_enabled && view === "desktop";
  const desktopLabel = status.data?.remote_apps_enabled
    ? "远程应用"
    : "远程桌面";
  const unlocked = (status.data?.unlocked_until ?? 0) * 1000 > now;
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  return (
    <section
      className="page cloud-control-page cloud-workspace-page"
      aria-labelledby="cloud-control-title"
    >
      <header
        className={`cloud-page-header${showRemoteToolbar ? " cloud-page-header-with-apps" : ""}`}
      >
        <div>
          <h1 id="cloud-control-title">云控</h1>
          {!showRemoteToolbar && (
            <p>
              {desktopOnly ? desktopLabel : `${desktopLabel}与 Agent 工作台`}
            </p>
          )}
        </div>
        {showRemoteToolbar && (
          <div className="cloud-app-toolbar-host" ref={setToolbarHost} />
        )}
        <div className="cloud-header-controls">
          <div
            className="cloud-layout-switch"
            role="group"
            aria-label="云控视图"
          >
            {(desktopOnly ? viewOrder.slice(0, 1) : viewOrder).map((item) => {
              const { label, Icon } = VIEWS[item];
              return (
                <button
                  key={item}
                  type="button"
                  aria-controls={`${paneId}-${item}`}
                  aria-pressed={view === item}
                  onClick={() => selectView(item)}
                >
                  <Icon size={15} aria-hidden="true" />
                  {item === "desktop" ? desktopLabel : label}
                </button>
              );
            })}
          </div>
          {status.data?.local && (
            <div className="cloud-pane-actions">
              <button className="btn" onClick={() => setDialog("setup")}>
                云控设置
              </button>
            </div>
          )}
        </div>
      </header>
      {status.error && <p role="alert">{status.error.message}</p>}
      <div className="cloud-workspace">
        {status.data?.remote_apps_enabled ? (
          <RemoteApps
            toolbarHost={toolbarHost}
            owner={owner}
            paneId={`${paneId}-desktop`}
            status={status.data}
            visible={view === "desktop"}
            onUnlock={() => setDialog("desktop")}
            onChange={() => void status.refetch()}
          />
        ) : (
          <RemoteDesktop
            paneId={`${paneId}-desktop`}
            status={status.data}
            visible={view === "desktop"}
            onUnlock={() => setDialog("desktop")}
            onSetup={() => setDialog("setup")}
            onChange={() => void status.refetch()}
          />
        )}
        {!desktopOnly && (
          <HappierWorkspace
            paneId={`${paneId}-agent`}
            hidden={view !== "agent"}
            loading={status.isPending}
            available={status.data?.happier_available ?? false}
            studioUrl={status.data?.happier_studio_url}
            unlocked={unlocked}
            onUnlock={() => setDialog("agent")}
          />
        )}
      </div>
      {dialog === "setup" && (
        <CloudSetupDialog
          owner={owner}
          close={() => setDialog(undefined)}
          changed={() => void status.refetch()}
        />
      )}
      {dialog && dialog !== "setup" && (
        <CloudUnlock
          purpose={dialog}
          remoteApps={status.data?.remote_apps_enabled}
          close={() => setDialog(undefined)}
          unlocked={() => {
            setDialog(undefined);
            void status.refetch();
          }}
        />
      )}
    </section>
  );
}

export function CloudControlPage(props: Parameters<typeof CloudWorkspace>[0]) {
  return (
    <CloudControlAccess>
      <CloudWorkspace key={props.owner} {...props} />
    </CloudControlAccess>
  );
}
