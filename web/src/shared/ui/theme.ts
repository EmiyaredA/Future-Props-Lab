import { useEffect, useState } from "react";
import {
  loadTheme,
  systemTheme,
  THEME_KEY,
  type ThemeMode,
} from "./themePreference";
export { loadTheme, THEME_KEY, type ThemeMode } from "./themePreference";

export function applyTheme(theme: ThemeMode, persist = true): void {
  const root = document.documentElement;
  if (root.dataset.theme !== theme) {
    // Palette changes must commit together. A background-only hover transition
    // otherwise leaves light surfaces behind immediately switched light text.
    root.setAttribute("data-theme-changing", "");
    root.dataset.theme = theme;
    void root.offsetHeight;
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          if (root.dataset.theme === theme)
            root.removeAttribute("data-theme-changing");
        }),
      );
    } else root.removeAttribute("data-theme-changing");
  }
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage can be unavailable in privacy modes.
    }
  }
}

export function useTheme(): [ThemeMode, (theme: ThemeMode) => void] {
  const [theme, setTheme] = useState<ThemeMode>(loadTheme);
  const [hasPreference, setHasPreference] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) !== null;
    } catch {
      return false;
    }
  });
  useEffect(() => applyTheme(theme, hasPreference), [theme, hasPreference]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === THEME_KEY) {
        if (event.newValue === "dark" || event.newValue === "light") {
          setTheme(event.newValue);
          setHasPreference(true);
        } else {
          setTheme(systemTheme());
          setHasPreference(false);
        }
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (hasPreference) return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const syncSystemTheme = (event: MediaQueryListEvent) =>
      setTheme(event.matches ? "dark" : "light");
    media.addEventListener?.("change", syncSystemTheme);
    return () => media.removeEventListener?.("change", syncSystemTheme);
  }, [hasPreference]);
  return [
    theme,
    (nextTheme) => {
      setHasPreference(true);
      setTheme(nextTheme);
    },
  ];
}
