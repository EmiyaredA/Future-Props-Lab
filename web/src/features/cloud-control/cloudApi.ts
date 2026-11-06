import { api, unwrap } from "@platform/api/client";
import type { components } from "@generated/api";

type Schemas = components["schemas"];

export const readCloudStatus = async (signal?: AbortSignal) =>
  unwrap(await api.GET("/v1/cloud-control/status", { signal }));
export type CloudStatus = Awaited<ReturnType<typeof readCloudStatus>>;
export type CloudSetup = Schemas["CloudSetup"];
export const launchHappier = async (signal: AbortSignal) =>
  unwrap(await api.POST("/v1/cloud-control/happier/launch", { signal }));

export type CloudUnlockPurpose = Schemas["CloudUnlockRequest"]["purpose"];
export const unlockCloud = async (purpose: CloudUnlockPurpose) =>
  unwrap(await api.POST("/v1/cloud-control/unlock", { body: { purpose } }));
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
