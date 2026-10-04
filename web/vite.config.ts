import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const apiPort = process.env.FPL_E2E_API_PORT || "9000";
const webPort = Number(process.env.FPL_E2E_WEB_PORT || "3000");
const apiTarget = `http://127.0.0.1:${apiPort}`;
const configuredCacheDir = process.env.FPL_VITE_CACHE_DIR;

export default defineConfig(({ mode }) => ({
  cacheDir:
    configuredCacheDir || resolve(__dirname, `node_modules/.vite-${mode}`),
  envDir: mode === "desktop" ? false : undefined,
  define:
    mode === "desktop"
      ? { "import.meta.env.VITE_API_BASE": JSON.stringify("") }
      : undefined,
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@app": resolve(__dirname, "src/app"),
      "@features": resolve(__dirname, "src/features"),
      "@generated": resolve(__dirname, "src/generated"),
      "@platform": resolve(__dirname, "src/platform"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  // These dependencies are first reached through lazy routes or a Web Worker.
  // Pre-bundling them at startup prevents Vite from replacing the dependency
  // graph and reloading an editor while a dialog or PSD import is in progress.
  // Desktop defers full reloads for unsaved drafts. A late optimizer rebuild would
  // otherwise mix React generations and crash newly loaded NodeViews.
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "@radix-ui/react-dialog",
      "ag-psd",
      "@tiptap/extension-code-block",
      "lowlight",
    ],
  },
  build: {
    sourcemap: mode !== "desktop",
    rollupOptions: {
      input: {
        studio: resolve(__dirname, "index.html"),
        docs: resolve(__dirname, "docs.html"),
        amadeus: resolve(__dirname, "amadeus.html"),
        pet: resolve(__dirname, "pet.html"),
        petChat: resolve(__dirname, "pet-chat.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/three/build/three.core.js"))
            return "three-core";
          if (id.includes("/node_modules/three/build/three.module.js"))
            return "three-renderer";
          if (id.includes("/node_modules/three/examples/jsm/")) {
            return `three-${id.split("/examples/jsm/")[1].split("/")[0]}`;
          }
          if (
            id.includes("/features/director-desk/editor/resources/") ||
            id.includes("/features/director-desk/editor/automation/")
          )
            return "director-automation";

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
    fs: {
      allow: [
        resolve(__dirname, ".."),
        ...(configuredCacheDir ? [configuredCacheDir] : []),
      ],
    },
    proxy:
      mode === "desktop"
        ? undefined
        : {
            "/v1": { target: apiTarget, ws: true },
            "/health": apiTarget,
            "/ready": apiTarget,
          },
  },
}));
