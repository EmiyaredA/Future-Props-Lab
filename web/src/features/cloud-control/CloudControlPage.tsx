import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical } from "lucide-react";
import { WorkbenchChatPanel, workbenchKeys } from "@features/agent-workbench";
import { CloudSetupDialog } from "./CloudSetupDialog";
import { CloudControlAccess } from "./CloudControlAccess";
import { CloudUnlock } from "./CloudUnlock";
import { RemoteDesktop } from "./RemoteDesktop";
import { readCloudStatus } from "./cloudApi";

const DEFAULT_SPLIT = 65;
const MIN_DESKTOP = 420;
const MIN_CHAT = 340;

function savedRatio(owner: string) {
  try {
    const ratio = Number(
      localStorage.getItem(`fpl.cloud-control.split.${owner}`),
    );
    return ratio >= 25 && ratio <= 80 ? ratio : DEFAULT_SPLIT;
  } catch {
    return DEFAULT_SPLIT;
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
  const workspace = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(() => savedRatio(owner));
  const [activePane, setActivePane] = useState<"desktop" | "chat">("desktop");
  const [dialog, setDialog] = useState<
    "unlock" | "enroll" | "desktop" | "setup"
  >();
  const status = useQuery({
    queryKey: ["cloud-control", owner, "status"],
    queryFn: ({ signal }) => readCloudStatus(signal),
    refetchInterval: 15_000,
  });
  const [now, setNow] = useState(() => Date.now());
  const unlocked = (status.data?.unlocked_until ?? 0) * 1000 > now;
  const beginUnlock = () => {
    setDialog(
      status.data?.local && !status.data.enrolled ? "enroll" : "unlock",
    );
  };
  useEffect(() => {
    const node = workspace.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const min = width >= 820 ? Math.max(25, (MIN_DESKTOP / width) * 100) : 25;
  const max = width >= 820 ? Math.min(80, 100 - (MIN_CHAT / width) * 100) : 80;
  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  const effective = clamp(ratio);
  function resize(next: number) {
    const value = clamp(next);
    setRatio(value);
    try {
      localStorage.setItem(`fpl.cloud-control.split.${owner}`, String(value));
    } catch {
      // The current layout remains usable when browser storage is disabled.
    }
  }

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
        {status.data?.local && (
          <div className="cloud-pane-actions">
            {status.data.enabled && (
              <button className="btn" onClick={() => setDialog("enroll")}>
                {status.data.enrolled ? "重设验证器" : "登记验证器"}
              </button>
            )}
            <button className="btn" onClick={() => setDialog("setup")}>
              云控设置
            </button>
          </div>
        )}
      </header>
      {status.error && <p role="alert">{status.error.message}</p>}
      <div className="cloud-mobile-switch" role="group" aria-label="云控面板">
        <button
          className="btn"
          aria-pressed={activePane === "desktop"}
          onClick={() => setActivePane("desktop")}
        >
          远程桌面
        </button>
        <button
          className="btn"
          aria-pressed={activePane === "chat"}
          onClick={() => setActivePane("chat")}
        >
          Agent 工作台
        </button>
      </div>
      <div
        className="cloud-workspace"
        ref={workspace}
        data-pane={activePane}
        style={{ "--cloud-ratio": `${effective}%` } as CSSProperties}
      >
        <RemoteDesktop
          status={status.data}
          visible={width >= 820 || activePane === "desktop"}
          onUnlock={() => setDialog("desktop")}
          onSetup={() => setDialog("setup")}
          onChange={() => void status.refetch()}
        />
        <div
          className="cloud-divider"
          role="separator"
          tabIndex={0}
          aria-label="调整远程桌面宽度"
          aria-orientation="vertical"
          aria-valuemin={Math.ceil(min)}
          aria-valuemax={Math.floor(max)}
          aria-valuenow={Math.round(effective)}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.focus();
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const area = workspace.current?.getBoundingClientRect();
            if (area?.width)
              resize(((event.clientX - area.left) / area.width) * 100);
          }}
          onKeyDown={(event) => {
            const next = {
              ArrowLeft: effective - 2,
              ArrowRight: effective + 2,
              Home: min,
              End: max,
            }[event.key];
            if (next === undefined) return;
            event.preventDefault();
            resize(next);
          }}
          onDoubleClick={() => resize(DEFAULT_SPLIT)}
        >
          <GripVertical size={13} />
        </div>
        <WorkbenchChatPanel
          owner={owner}
          host={status.data?.host_label ?? "Mac"}
          enabled={status.data?.enabled ?? false}
          unlocked={unlocked}
          onUnlock={beginUnlock}
          onSetup={status.data?.local ? () => setDialog("setup") : undefined}
          onHistory={onHistory}
          onSources={onSources}
        />
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
          enroll={() => setDialog("enroll")}
        />
      )}
      {dialog && dialog !== "setup" && (
        <CloudUnlock
          enroll={dialog === "enroll"}
          desktop={dialog === "desktop"}
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
