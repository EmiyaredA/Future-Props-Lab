import { amadeusTabKey, readTabState, writeTabState } from "./tabState";
import { AssistantSplitMinimum } from "@platform/assistantLayout";
import { AssistantElements } from "@platform/assistantElements";
import { LoadingState } from "@shared/ui/LoadingState";
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { AccountSessionContext } from "@features/accounts";
import { AmadeusPageContext } from "./PageContext";
import { createPageBridge } from "./pageBridge";
import { AmadeusSourceHost } from "./SourceHost";
import { SplitResizeHandle } from "./SplitResizeHandle";
import "./sidebar.css";

const Assistant = lazy(() =>
  import("./Window").then((module) => ({ default: module.AmadeusWindow })),
);

const splitMinWidth = 1100;
const splitSpacing = 6;
const minPageWidth = 600;
const minAssistantWidth = 400;

export function AmadeusWorkspace({
  session,
}: {
  session: AccountSessionContext;
}) {
  return (
    <section className="amadeus-workspace" aria-label="Amadeus">
      <Suspense
        fallback={<LoadingState label="正在打开 Amadeus…" variant="page" />}
      >
        <Assistant session={session} standalone />
      </Suspense>
    </section>
  );
}

export function AmadeusPageProvider({
  session,
  children,
  workspaceOnly = false,
}: {
  session: AccountSessionContext;
  children: ReactNode;
  workspaceOnly?: boolean;
}) {
  const tabKey = amadeusTabKey(session.me.user.id, "pane");
  const [saved] = useState(() =>
    readTabState<{
      open: boolean;
      split: boolean;
      width: number | null;
    }>(tabKey),
  );
  const [open, setOpen] = useState(saved?.open === true);
  const panelOpen = open && !workspaceOnly;
  const [picking, setPicking] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [workspaceWidth, setWorkspaceWidth] = useState(viewportWidth);
  const [preferredWidth, setPreferredWidth] = useState<number | null>(
    typeof saved?.width === "number" ? saved.width : null,
  );
  const [split, setSplit] = useState(saved?.split !== false);
  useEffect(() => {
    writeTabState(tabKey, { open, split, width: preferredWidth });
  }, [tabKey, open, split, preferredWidth]);
  const [pageMinimum, setPageMinimum] = useState<number>();
  const workspace = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const measure = () => setWorkspaceWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pane = useRef<HTMLElement | null>(null);
  const focusComposerAfterPick = useRef(false);
  const bridge = useMemo(
    () =>
      createPageBridge(session.me.user.id, () => {
        setOpen(false);
      }),
    [session.me.user.id],
  );
  useEffect(() => {
    if (workspaceOnly) return;
    const show = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && !pane.current?.contains(active)) {
        returnFocus.current = active;
      }
      setOpen(true);
      pane.current?.focus();
    };
    window.addEventListener("future-props:open-amadeus", show);
    return () => window.removeEventListener("future-props:open-amadeus", show);
  }, [workspaceOnly]);
  useEffect(() => {
    const pick = bridge.onAmadeusPickCommand(({ enabled }) =>
      setPicking(enabled),
    );
    const finish = bridge.onAmadeusPickFinished(() => {
      focusComposerAfterPick.current = true;
      setPicking(false);
    });
    return () => {
      pick();
      finish();
    };
  }, [bridge]);
  useEffect(() => {
    if (!panelOpen) {
      focusComposerAfterPick.current = false;
      returnFocus.current?.focus();
      returnFocus.current = null;
      return;
    }
    if (picking) return;
    if (focusComposerAfterPick.current) {
      focusComposerAfterPick.current = false;
      pane.current
        ?.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="向 Amadeus 提问"]',
        )
        ?.focus({ preventScroll: true });
    } else {
      pane.current?.focus();
    }
    const escape = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        event.key === "Escape" &&
        !document.querySelector('[data-state="open"][role="dialog"]')
      ) {
        void bridge.hideAmadeus();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [panelOpen, picking, bridge]);
  const narrow = viewportWidth <= 700;
  const maxAssistantWidth =
    workspaceWidth - (pageMinimum ?? minPageWidth) - 2 * splitSpacing;
  const canSplit =
    viewportWidth >= splitMinWidth && maxAssistantWidth > minAssistantWidth;
  const showSplit = panelOpen && split && canSplit && !picking;
  const defaultAssistantWidth =
    Math.min(600, Math.round(viewportWidth * 0.37)) - splitSpacing;
  const assistantWidth = Math.min(
    maxAssistantWidth,
    Math.max(minAssistantWidth, preferredWidth ?? defaultAssistantWidth),
  );
  return (
    <AmadeusPageContext value={bridge}>
      <div
        ref={workspace}
        className="website-workspace"
        data-assistant-layout={showSplit ? "split" : undefined}
        style={
          showSplit
            ? ({
                "--assistant-split-spacing": `${splitSpacing}px`,
                "--assistant-split-width": `${assistantWidth}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <div className="website-page" inert={panelOpen && narrow && !picking}>
          <AssistantSplitMinimum value={setPageMinimum}>
            <AssistantElements value={bridge.registerElementSource}>
              {children}
            </AssistantElements>
          </AssistantSplitMinimum>
        </div>
        <AmadeusSourceHost />
        {showSplit && (
          <SplitResizeHandle
            panelId={panelId}
            width={assistantWidth}
            preferredWidth={preferredWidth}
            min={minAssistantWidth}
            max={maxAssistantWidth}
            onResize={setPreferredWidth}
          />
        )}
        {panelOpen && (
          <aside
            id={panelId}
            ref={pane}
            tabIndex={-1}
            className="website-assistant"
            aria-label="Amadeus 助手"
            hidden={picking}
          >
            <Suspense
              fallback={
                <LoadingState label="正在打开 Amadeus…" variant="page" />
              }
            >
              <Assistant
                session={session}
                splitLayout={
                  canSplit
                    ? {
                        active: showSplit,
                        toggle: () => setSplit((value) => !value),
                      }
                    : undefined
                }
              />
            </Suspense>
          </aside>
        )}
      </div>
    </AmadeusPageContext>
  );
}
