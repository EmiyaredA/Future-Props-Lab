import { api, unwrap } from "@platform/api/client";
import type { components } from "@generated/api";

type Schemas = components["schemas"];

export const readCloudStatus = async (signal?: AbortSignal) =>
  unwrap(await api.GET("/v1/cloud-control/status", { signal }));
export type CloudStatus = Awaited<ReturnType<typeof readCloudStatus>>;
export type CloudSetup = Schemas["CloudSetup"];

export const beginTotp = async () =>
  unwrap(await api.POST("/v1/cloud-control/totp/enroll"));
export const confirmTotp = async (code: string) =>
  unwrap(
    await api.POST("/v1/cloud-control/totp/confirm", {
      body: { code, desktop: false },
    }),
  );
export const verifyTotp = async (code: string, desktop: boolean) =>
  unwrap(
    await api.POST("/v1/cloud-control/totp/verify", {
      body: { code, desktop },
    }),
  );
export const requestDesktop = async (password: string, signal?: AbortSignal) =>
  unwrap(
    await api.POST("/v1/cloud-control/desktop/connect", {
      body: { password },
      signal,
    }),
  );
export const saveIdle = async (idle_minutes: number, revision: number) =>
  unwrap(
    await api.PUT("/v1/cloud-control/desktop/idle", {
      body: { idle_minutes, revision },
    }),
  );
export const getSetup = async (signal?: AbortSignal) =>
  unwrap(await api.GET("/v1/cloud-control/settings", { signal }));
export const saveSetup = async (body: Schemas["CloudSetupUpdate"]) =>
  unwrap(await api.PUT("/v1/cloud-control/settings", { body }));
