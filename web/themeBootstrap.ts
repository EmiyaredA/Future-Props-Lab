import type { Plugin } from "vite";
import {
  readThemePreference,
  THEME_KEY,
} from "./src/shared/ui/themePreference";

/** Inline, parser-blocking startup resources: no React, CSS or module fetch is needed. */
export function themeBootstrap(): Plugin {
  return {
    name: "initial-document-theme",
    transformIndexHtml: {
      order: "pre",
      handler() {
        return [
          {
            tag: "style",
            attrs: { id: "fpl-initial-theme" },
            injectTo: "head-prepend",
            children: `html { min-height: 100%; color-scheme: light; background: var(--bg, #f7f4ef); color: var(--text, #39342e); }
html[data-theme="dark"] { color-scheme: dark; background: var(--bg, #121413); color: var(--text, #ebe5db); }
@media (prefers-color-scheme: dark) { html:not([data-theme]) { color-scheme: dark; background: #121413; color: #ebe5db; } }
body { margin: 0; }`,
          },
          {
            tag: "script",
            attrs: { id: "fpl-initial-theme-script" },
            injectTo: "head-prepend",
            children: `document.documentElement.dataset.theme = (${readThemePreference.toString()})(${JSON.stringify(THEME_KEY)});`,
          },
        ];
      },
    },
  };
}
