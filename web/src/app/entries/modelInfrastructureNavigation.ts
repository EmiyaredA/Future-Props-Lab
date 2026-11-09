import { useEffect, useState } from "react";
import { studioPaths } from "@app/routing/studioNavigation";
import { guardedNavigation } from "./navigation";

type View = "model-service" | "code-agents";
const focusKey = "fpl.model-infrastructure.tab-focus";

export function navigateModelInfrastructure(view: View, keyboard = false) {
  const path = studioPaths[view];
  guardedNavigation(() => {
    if (keyboard) {
      try {
        sessionStorage.setItem(focusKey, path);
      } catch {
        // The destination remains reachable without browser storage.
      }
    }
    location.assign(path);
  }, true);
}

export function useModelInfrastructureFocus(view: View) {
  const [focusSelected, setFocusSelected] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(focusKey) === studioPaths[view]) {
        sessionStorage.removeItem(focusKey);
        setFocusSelected(true);
      }
    } catch {
      // Direct links use the browser's default focus.
    }
  }, [view]);
  return focusSelected;
}
