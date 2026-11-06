import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Terminal } from "lucide-react";
import { WorkbenchChatPanel, workbenchKeys } from "@features/agent-workbench";
import { CloudSetupDialog } from "./CloudSetupDialog";
import { CloudControlAccess } from "./CloudControlAccess";
import { CloudUnlock } from "./CloudUnlock";
import { RemoteDesktop } from "./RemoteDesktop";
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

function savedView(owner: string): View {
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
  onHistory,
  onSources,
}: {
  owner: string;
  onHistory: (id?: string) => void;
  onSources: () => void;
}) {
  const queryClient = useQueryClient();
  const paneId = useId();
  const [view, setView] = useState<View>(() => savedView(owner));

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
  const [now, setNow] = useState(() => Date.now());
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
      <header className="cloud-page-header">
        <div>
          <h1 id="cloud-control-title">云控</h1>
          <p>远程桌面与 Agent 工作台</p>
        </div>
        <div className="cloud-header-controls">
          <div
            className="cloud-layout-switch"
            role="group"
            aria-label="云控视图"
          >
            {viewOrder.map((item) => {
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
                  {label}
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
        <RemoteDesktop
          paneId={`${paneId}-desktop`}
          status={status.data}
          visible={view === "desktop"}
          onUnlock={() => setDialog("desktop")}
          onSetup={() => setDialog("setup")}
          onChange={() => void status.refetch()}
        />
        {status.data?.happier_available ? (
          <HappierWorkspace
            paneId={`${paneId}-agent`}
            hidden={view !== "agent"}
            unlocked={unlocked}
            onUnlock={() => setDialog("agent")}
            onHistory={() => onHistory()}
          />
        ) : (
          <WorkbenchChatPanel
            paneId={`${paneId}-agent`}
            hidden={view !== "agent"}
            owner={owner}
            host={status.data?.host_label ?? "Mac"}
            enabled={status.data?.enabled ?? false}
            unlocked={unlocked}
            onUnlock={() => setDialog("agent")}
            onSetup={status.data?.local ? () => setDialog("setup") : undefined}
            onHistory={onHistory}
            onSources={onSources}
          />
        )}
      </div>
      {dialog === "setup" && (
        <CloudSetupDialog
          owner={owner}
          close={() => setDialog(undefined)}
          changed={() => {
            void status.refetch();
            void queryClient.invalidateQueries({
              queryKey: workbenchKeys.executionCatalog(owner),
            });
          }}
        />
      )}
      {dialog && dialog !== "setup" && (
        <CloudUnlock
          purpose={dialog}
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
