import { useCallback, useEffect, useRef, useState } from "react";
import {
  NAVIGATION_COMMITTED,
  useNavigationProtection,
} from "@shared/ui/navigationGuards";

const historyKey = "fplApplicationNavigation";
const currentPath = () => location.pathname + location.search + location.hash;
type Entry = { path: string; index: number };

/** Keep navigation inside one independently loaded application in its current document. */
export function useApplicationNavigation(
  scope: string,
  ownsPath: (pathname: string) => boolean,
) {
  const protection = useNavigationProtection();
  const [path, setPath] = useState(currentPath);
  const current = useRef<Entry>({ path, index: 0 });
  const readIndex = useCallback(() => {
    const state = history.state?.[historyKey];
    return state?.scope === scope && Number.isInteger(state.index)
      ? (state.index as number)
      : undefined;
  }, [scope]);
  const stateFor = useCallback(
    (index: number) => ({
      ...history.state,
      [historyKey]: { scope, index },
    }),
    [scope],
  );
  const publish = useCallback((entry: Entry) => {
    current.current = entry;
    setPath(entry.path);
    window.dispatchEvent(new Event(NAVIGATION_COMMITTED));
  }, []);
  const navigate = useCallback(
    (target: string) => {
      const url = new URL(target, location.href);
      const local = url.origin === location.origin && ownsPath(url.pathname);
      const next = url.pathname + url.search + url.hash;
      if (local && next === current.current.path) return;
      const proceed = () => {
        if (!local) {
          location.assign(url.href);
          return;
        }
        const index = current.current.index + 1;
        history.pushState(stateFor(index), "", next);
        publish({ path: next, index });
      };
      if (!protection?.protect(proceed, !local)) proceed();
    },
    [ownsPath, protection, publish, stateFor],
  );

  useEffect(() => {
    current.current = { path: currentPath(), index: readIndex() ?? 0 };
    history.replaceState(stateFor(current.current.index), "");
    let restoring:
      { next: Entry; restored: boolean; approved: boolean } | undefined;
    let approved: Entry | undefined;
    const pop = () => {
      const next = { path: currentPath(), index: readIndex() };
      const previous = current.current;
      if (restoring) {
        // Rewind the browser's cursor while the draft owner decides. No new
        // entries are added, so cancelling Back also preserves Forward.
        if (next.index !== previous.index) {
          if (next.index !== undefined) history.go(previous.index - next.index);
          return;
        }
        const attempt = restoring;
        restoring = undefined;
        attempt.restored = true;
        if (attempt.approved) {
          approved = attempt.next;
          history.go(attempt.next.index - previous.index);
        }
        return;
      }
      if (approved?.path === next.path && approved.index === next.index) {
        approved = undefined;
        publish(next as Entry);
        return;
      }
      if (next.path === previous.path) return;
      if (next.index === undefined || next.index === previous.index) {
        // An entry created outside this controller has no cursor metadata.
        // Restore the mounted page before applying the ordinary guarded route.
        history.replaceState(stateFor(previous.index), "", previous.path);
        navigate(next.path);
        return;
      }
      const attempt = {
        next: next as Entry,
        restored: false,
        approved: false,
      };
      const resume = () => {
        attempt.approved = true;
        if (attempt.restored) {
          approved = attempt.next;
          history.go(attempt.next.index - current.current.index);
        }
      };
      if (protection?.protect(resume)) {
        restoring = attempt;
        history.go(previous.index - next.index);
      } else publish(next as Entry);
    };
    const follow = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        (anchor.target && anchor.target !== "_self") ||
        anchor.hasAttribute("download")
      )
        return;
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || !ownsPath(url.pathname)) return;
      event.preventDefault();
      navigate(url.href);
    };
    window.addEventListener("popstate", pop);
    document.addEventListener("click", follow);
    return () => {
      window.removeEventListener("popstate", pop);
      document.removeEventListener("click", follow);
    };
  }, [navigate, ownsPath, protection, publish, readIndex, stateFor]);

  return { path, navigate };
}
