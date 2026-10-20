import { pathToFileURL } from "node:url";
import type { Plugin } from "vite";

/** Glyph outlines are font data, fetched only when vector formula export is opened. */
export function mathFontData(): Plugin {
  return {
    name: "local-math-font-data",
    apply: "build",
    async transform(_code, id) {
      if (!id.endsWith("/@mathjax/mathjax-tex-font/mjs/svg/normal.js")) return;
      const { normal } = await import(pathToFileURL(id).href);
      const asset = this.emitFile({
        type: "asset",
        name: "math-tex-normal.json",
        source: JSON.stringify(normal),
      });
      return {
        code: `const response=await fetch(import.meta.ROLLUP_FILE_URL_${asset});
if(!response.ok)throw new Error("公式字体加载失败");
export const normal=await response.json();`,
        map: null,
      };
    },
  };
}
