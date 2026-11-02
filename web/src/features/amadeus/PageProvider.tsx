import { LoadingState } from "@shared/ui/LoadingState";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AccountSessionContext } from "@features/accounts";
import { AmadeusPageContext } from "./PageContext";
import { createPageBridge } from "./pageBridge";
import { AmadeusSourceHost } from "./SourceHost";
import "./sidebar.css";

const Assistant = lazy(() =>
  import("./Window").then((module) => ({ default: module.AmadeusWindow })),
);

export function AmadeusPageProvider({
  session,
  children,
}: {
  session: AccountSessionContext;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 1100);
  useEffect(() => {
    const resize = () => setNarrow(window.innerWidth <= 1100);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pane = useRef<HTMLElement | null>(null);
  const bridge = useMemo(
    () =>
      createPageBridge(session.me.user.id, () => {
        setOpen(false);
        returnFocus.current?.focus();
      }),
    [session.me.user.id],
  );
  useEffect(() => {
    const show = () => {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setOpen(true);
    };
    window.addEventListener("future-props:open-amadeus", show);
    return () => window.removeEventListener("future-props:open-amadeus", show);
  }, []);
  useEffect(() => {
    if (!open) return;
    pane.current?.focus();
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
  }, [open, bridge]);
  return (
    <AmadeusPageContext value={bridge}>
      <div className={`website-workspace${open ? " has-assistant" : ""}`}>
        <div className="website-page" inert={open && narrow}>
          {children}
        </div>
        <AmadeusSourceHost />
        {open && (
          <aside
            ref={pane}
            tabIndex={-1}
            className="website-assistant"
            aria-label="Amadeus 助手"
          >
            <Suspense
              fallback={
                <LoadingState label="正在打开 Amadeus…" variant="region" />
              }
            >
              <Assistant session={session} />
            </Suspense>
          </aside>
        )}
      </div>
    </AmadeusPageContext>
  );
}
