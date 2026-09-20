import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const apiPort = process.env.FPL_E2E_API_PORT || "9000";
const webPort = Number(process.env.FPL_E2E_WEB_PORT || "3000");
const apiTarget = `http://127.0.0.1:${apiPort}`;

export default defineConfig(({ mode }) => ({
  envDir: mode === "desktop" ? false : undefined,
  define:
    mode === "desktop"
      ? { "import.meta.env.VITE_API_BASE": JSON.stringify("") }
      : undefined,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@app": resolve(__dirname, "src/app"),
      "@features": resolve(__dirname, "src/features"),
      "@generated": resolve(__dirname, "src/generated"),
      "@platform": resolve(__dirname, "src/platform"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  build: {
    sourcemap: mode !== "desktop",
    rollupOptions: {
      input: {
        studio: resolve(__dirname, "index.html"),
        docs: resolve(__dirname, "docs.html"),
        amadeus: resolve(__dirname, "amadeus.html"),
      },
      output: {
        manualChunks(id) {
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
