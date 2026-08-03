import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        "FPL_SECRETS_KEY=Q3kT62dvbHHXXulO5XPCR84_yXK6t-6LXz7BcIYONys= ../.venv/bin/uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 9000",
      url: "http://127.0.0.1:9000/ready",
      reuseExistingServer: true,
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:3000/model-service",
      reuseExistingServer: true,
    },
  ],
});
