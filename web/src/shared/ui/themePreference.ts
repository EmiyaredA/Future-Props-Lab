export type ThemeMode = "light" | "dark";
export const THEME_KEY = "future_props_theme";

/** Self-contained so the HTML bootstrap can inline the same preference rule. */
export function readThemePreference(key?: string): ThemeMode {
  if (key) {
    try {
      const stored = localStorage.getItem(key);
      if (stored === "dark" || stored === "light") return stored;
    } catch {
      // An unavailable store still follows the system; never rewrite a preference.
    }
  }
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
    ? "dark"
    : "light";
}

export const loadTheme = () => readThemePreference(THEME_KEY);
export const systemTheme = () => readThemePreference();
