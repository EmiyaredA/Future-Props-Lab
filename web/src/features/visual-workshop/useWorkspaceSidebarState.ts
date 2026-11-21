import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const desktopSnapshot = () => window.innerWidth >= 1024;
const serverSnapshot = () => true;
function subscribe(listener: () => void) {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

/** Desktop preferences survive narrow viewports; temporary drawers do not. */
export function useWorkspaceSidebarState() {
  const desktop = useSyncExternalStore(
    subscribe,
    desktopSnapshot,
    serverSnapshot,
  );
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [pinned, setPinned] = useState(true);
  const [overlayOpen, setOverlayOpen] = useState(false);
  useEffect(() => setOverlayOpen(false), [desktop]);
  const setOpen = useCallback(
    (open: boolean) => {
      if (desktop) setDesktopOpen(open);
      else setOverlayOpen(open);
    },
    [desktop],
  );
  return {
    desktop,
    open: desktop ? desktopOpen : overlayOpen,
    pinned: desktop && pinned,
    setOpen,
    setPinned,
  };
}
