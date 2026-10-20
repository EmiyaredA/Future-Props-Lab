import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "node_modules/.vite-vitest",
  plugins: [react()],
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
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    css: true,
    globals: true,
    maxWorkers: 2,
    testTimeout: 15_000,
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
  },
});
