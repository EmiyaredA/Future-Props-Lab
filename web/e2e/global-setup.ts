import { request } from "@playwright/test";

export default async function globalSetup() {
  const port = process.env.FPL_E2E_API_PORT || "9000";
  const context = await request.newContext({
    baseURL: `http://127.0.0.1:${port}`,
  });
  const response = await context.post("/v1/auth/login", {
    data: {
      username: "e2e-admin",
      password: process.env.FPL_E2E_PASSWORD || "E2E-Password-2026!",
    },
  });
  if (!response.ok()) {
    throw new Error(
      `E2E login failed: ${response.status()} ${await response.text()}`,
    );
  }
  await context.storageState({ path: "e2e/.auth-state.json" });
  await context.dispose();
}
