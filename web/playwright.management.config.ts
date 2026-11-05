import { defineConfig } from "@playwright/test";
const port = process.env.FPL_MANAGEMENT_WEB_PORT || "23001";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "management.spec.ts",
  outputDir: "../.local/management/browser",
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    ...(process.env.FPL_E2E_CHROME_PATH
      ? { launchOptions: { executablePath: process.env.FPL_E2E_CHROME_PATH } }
      : {}),
  },
  webServer: {
    command: "npm run dev:management",
    env: { FPL_MANAGEMENT_WEB_PORT: port },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
