import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

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
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/v1": "http://127.0.0.1:9000",
      "/health": "http://127.0.0.1:9000",
      "/ready": "http://127.0.0.1:9000",
    },
  },
});
