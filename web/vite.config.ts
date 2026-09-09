import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const apiPort = process.env.FPL_E2E_API_PORT || "9000";
const webPort = Number(process.env.FPL_E2E_WEB_PORT || "3000");
const apiTarget = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [react()],
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
    sourcemap: true,
    rollupOptions: {
      input: {
        studio: resolve(__dirname, "index.html"),
        docs: resolve(__dirname, "docs.html"),
      },
      output: {
        manualChunks(id) {
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
    proxy: {
      "/v1": { target: apiTarget, ws: true },
      "/health": apiTarget,
      "/ready": apiTarget,
    },
  },
});
