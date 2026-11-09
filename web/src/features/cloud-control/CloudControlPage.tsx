import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudSetupDialog } from "./CloudSetupDialog";
import { CloudControlAccess } from "./CloudControlAccess";
import { CloudUnlock } from "./CloudUnlock";
import { RemoteDesktop } from "./RemoteDesktop";
import { RemoteApps } from "./RemoteApps";
import { readCloudStatus, type CloudStatus } from "./cloudApi";
import "./workspace-layout.css";

function CloudWorkspace({ owner }: { owner: string }) {
  const paneId = useId();
  const [titleHost, setTitleHost] = useState<HTMLDivElement | null>(null);
  const setupButton = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<"desktop" | "setup">();
  const queryClient = useQueryClient();
  const statusKey = ["cloud-control", owner, "status"] as const;
  const status = useQuery({
    queryKey: statusKey,
    queryFn: ({ signal }) => readCloudStatus(signal),
    refetchInterval: 15_000,
  });
  const showRemoteApps = status.data?.remote_apps_enabled;
  const remoteAppIdle =
    showRemoteApps && status.data?.desktop_configured ? status.data : undefined;
  return (
    <section
      className={`page cloud-control-page cloud-workspace-page${showRemoteApps ? " cloud-workspace-page-with-apps" : ""}`}
      aria-labelledby="cloud-control-title"
    >
      <header
        className={`cloud-page-header${showRemoteApps ? " cloud-page-header-with-apps" : ""}`}
      >
        <div className={showRemoteApps ? "cloud-app-title" : undefined}>
          <h1 id="cloud-control-title">云控</h1>
          {showRemoteApps ? <div ref={setTitleHost} /> : <p>远程桌面</p>}
        </div>
        <div className="cloud-header-controls">
          {(status.data?.local || remoteAppIdle) && (
            <div className="cloud-pane-actions">
              <button
                className="btn"
                ref={setupButton}
                onClick={() => setDialog("setup")}
              >
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
            titleHost={titleHost}
            owner={owner}
            paneId={paneId}
            status={status.data}
            visible
            onUnlock={() => setDialog("desktop")}
          />
        ) : (
          <RemoteDesktop
            paneId={paneId}
            status={status.data}
            visible
            onUnlock={() => setDialog("desktop")}
            onSetup={() => setDialog("setup")}
            onChange={() => void status.refetch()}
          />
        )}
      </div>
      {dialog === "setup" && (status.data?.local || remoteAppIdle) && (
        <CloudSetupDialog
          owner={owner}
          local={status.data?.local === true}
          idle={remoteAppIdle}
          close={() => setDialog(undefined)}
          restoreFocus={() => setupButton.current?.focus()}
          changed={(savedIdle) => {
            if (savedIdle) {
              void queryClient.cancelQueries({
                queryKey: statusKey,
                exact: true,
              });
              queryClient.setQueryData<CloudStatus>(
                statusKey,
                (current) =>
                  current && {
                    ...current,
                    idle_minutes: savedIdle.idle_minutes,
                    idle_revision: savedIdle.revision,
                  },
              );
            }
            void status.refetch();
          }}
        />
      )}
      {dialog === "desktop" && (
        <CloudUnlock
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
