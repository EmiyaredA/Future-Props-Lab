import { defineConfig, devices } from "@playwright/test";

const apiPort = process.env.FPL_E2E_API_PORT || "9000";
const webPort = process.env.FPL_E2E_WEB_PORT || "3000";
const databasePath =
  process.env.FPL_E2E_DATABASE_PATH ||
  `/tmp/future-props-lab-e2e-${process.pid}.db`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    storageState: "e2e/.auth-state.json",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        "FPL_SECRETS_KEY=Q3kT62dvbHHXXulO5XPCR84_yXK6t-6LXz7BcIYONys= " +
        `FPL_DATABASE_PATH=${databasePath} ` +
        `CORS_ORIGINS=http://127.0.0.1:${webPort} ` +
        "FPL_E2E_PASSWORD=E2E-Password-2026! " +
        "../.venv/bin/python ../scripts/e2e_account.py && " +
        "FPL_SECRETS_KEY=Q3kT62dvbHHXXulO5XPCR84_yXK6t-6LXz7BcIYONys= " +
        `FPL_DATABASE_PATH=${databasePath} ` +
        `CORS_ORIGINS=http://127.0.0.1:${webPort} ` +
        `../.venv/bin/uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port ${apiPort}`,
      url: `http://127.0.0.1:${apiPort}/ready`,
      reuseExistingServer: false,
    },
    {
      command: "npm run dev",
      url: `http://127.0.0.1:${webPort}/model-service`,
      reuseExistingServer: false,
    },
  ],
});
