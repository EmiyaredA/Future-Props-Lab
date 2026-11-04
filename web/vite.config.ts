import { directorResourceChunks } from "./chunkGraph";
import { mathFontData } from "./mathFontData";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const apiPort = process.env.FPL_E2E_API_PORT || "9001";
const webPort = Number(process.env.FPL_E2E_WEB_PORT || "3000");
const apiTarget = `http://127.0.0.1:${apiPort}`;
const configuredCacheDir = process.env.FPL_VITE_CACHE_DIR;

export default defineConfig(({ mode }) => {
  const directorChunk = directorResourceChunks();
  return {
    cacheDir:
      configuredCacheDir || resolve(__dirname, `node_modules/.vite-${mode}`),
    envDir: mode === "studio" ? false : undefined,
    define:
      mode === "studio"
        ? { "import.meta.env.VITE_API_BASE": JSON.stringify("") }
        : undefined,
    plugins: [react(), tailwindcss(), mathFontData()],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "#default-font/svg/default.js": resolve(
          __dirname,
          "../node_modules/@mathjax/mathjax-tex-font/mjs/svg/default.js",
        ),
        "@app": resolve(__dirname, "src/app"),
        "@features": resolve(__dirname, "src/features"),
        "@generated": resolve(__dirname, "src/generated"),
        "@platform": resolve(__dirname, "src/platform"),
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
    // These dependencies are first reached through lazy routes or a Web Worker.
    // Pre-bundling them at startup prevents Vite from replacing the dependency
    // graph and reloading an editor while a dialog or editor transaction is in progress.
    // Desktop defers full reloads for unsaved drafts. A late optimizer rebuild would
    // otherwise mix React generations and crash newly loaded NodeViews.
    optimizeDeps: {
      exclude: [
        "@mathjax/src",
        "@mathjax/mathjax-newcm-font",
        "@mathjax/mathjax-tex-font",
      ],
      include: [
        "react",
        "react-dom/client",
        "@radix-ui/react-dialog",
        "@tiptap/extension-code-block",
        "lowlight",
        "echarts/core",
        "echarts/charts",
        "echarts/renderers",
        "echarts/components",
        "html-to-image",
      ],
    },
    build: {
      manifest: true,
      emptyOutDir: true,
      sourcemap: mode !== "studio",
      rollupOptions: {
        input: {
          studio: resolve(__dirname, "index.html"),
          docs: resolve(__dirname, "docs.html"),
        },
        output: {
          onlyExplicitManualChunks: true,
          manualChunks(id, context) {
            const director = directorChunk(id, context);
            if (director) return director;
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id))
              return "react-runtime";
            if (id.includes("/node_modules/@tanstack/query-"))
              return "query-runtime";
            if (id.includes("/node_modules/@mathjax/mathjax-tex-font/")) {
              if (
                /\/mjs\/svg\/(?!(?:default|delimiters)\.js)[^/]+\.js$/.test(id)
              )
                return `formula-glyph-${id.split("/").at(-1)!.replace(".js", "")}`;
              return "formula-engine";
            }
            if (id.includes("/node_modules/@mathjax/src/mjs/"))
              return "formula-engine";
            if (id.includes("/node_modules/echarts/")) return "chart-engine";
            if (id.includes("/node_modules/zrender/")) return "chart-svg";
            if (
              id.includes(
                "/node_modules/@antv/infographic/esm/designs/structures/",
              )
            )
              return "infographic-structures";
            if (id.includes("/node_modules/@antv/infographic/esm/editor/"))
              return "infographic-editor";
            if (
              /\/node_modules\/@antv\/infographic\/esm\/(renderer|resource|utils)\//.test(
                id,
              )
            )
              return "infographic-renderer";
            if (id.includes("/node_modules/measury/"))
              return "infographic-metrics";
            if (id.includes("/node_modules/three/build/three.core.js"))
              return "three-core";
            if (id.includes("/node_modules/three/build/three.module.js"))
              return "three-renderer";
            if (id.includes("/node_modules/three/examples/jsm/")) {
              return `three-${id.split("/examples/jsm/")[1].split("/")[0]}`;
            }

            if (id.includes("/docs/articles/sdk/sdk-reference-")) {
              return id
                .split("/")
                .pop()!
                .split(".md")[0]
                .replace("sdk-", "docs-");
            }
            if (id.includes("node_modules/prosemirror-"))
              return "notes-prosemirror";
            if (id.includes("node_modules/@tiptap/")) return "notes-tiptap";
            if (id.includes("node_modules/katex/")) return "notes-math";
            if (id.includes("node_modules/mermaid/") && id.includes("chunk-")) {
              return `notes-mermaid-${id
                .split("/")
                .pop()
                ?.replace(/\.mjs$/, "")}`;
            }

            if (
              id.includes("@ricky0123/vad-web") ||
              id.includes("onnxruntime-common") ||
              id.includes("onnxruntime-web")
            ) {
              return "silero-vad-vendor";
            }
          },
        },
      },
    },
    server: {
      port: webPort,
      strictPort: true,
      fs: {
        allow: [
          resolve(__dirname, ".."),
          ...(configuredCacheDir ? [configuredCacheDir] : []),
        ],
      },
      proxy: {
        "/v1": { target: apiTarget, ws: true, changeOrigin: true },
        "/health": { target: apiTarget, changeOrigin: true },
        "/ready": { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
