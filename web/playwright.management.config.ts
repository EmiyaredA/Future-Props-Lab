import { defineConfig } from "@playwright/test";
const port = process.env.FPL_MANAGEMENT_WEB_PORT || "23001";
const isolatedOrigin = process.env.FPL_E2E_MANAGEMENT_ORIGIN;
export default defineConfig({
  testDir: "./e2e",
  testMatch: isolatedOrigin
    ? "platform-governance.spec.ts"
    : "management.spec.ts",
  outputDir: process.env.FPL_E2E_OUTPUT || "../.local/management/browser",
  workers: 1,
  use: {
    baseURL: isolatedOrigin || `http://127.0.0.1:${port}`,
    trace: isolatedOrigin ? "off" : "retain-on-failure",
    ...(process.env.FPL_E2E_CHROME_PATH
      ? { launchOptions: { executablePath: process.env.FPL_E2E_CHROME_PATH } }
      : {}),
  },
  webServer: isolatedOrigin
    ? undefined
    : {
        command: "npm run dev:management",
        env: { FPL_MANAGEMENT_WEB_PORT: port },
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
      },
});
