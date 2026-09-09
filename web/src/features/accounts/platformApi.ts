import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";
export type PlatformRole = "super_admin" | "admin" | "member";
export const platformRoleLabels: Record<PlatformRole, string> = {
  super_admin: "超级管理员",
  admin: "运营管理员",
  member: "普通用户",
};
export const platformRoleOptions = Object.entries(platformRoleLabels).map(
  ([value, label]) => ({ value, label }),
);
export type InviteCode = components["schemas"]["RegistrationInviteOut"];
export type InviteFilters = {
  q: string;
  status: string;
  page: number;
  page_size: number;
};
export const fetchInviteCodes = async (query: InviteFilters) =>
  unwrap(
    await api.GET("/v1/platform/registration-invite-codes", {
      params: { query },
    }),
  );
export const createInviteCode = async (
  body: components["schemas"]["RegistrationInviteIn"],
) => unwrap(await api.POST("/v1/platform/registration-invite-codes", { body }));
export const patchInviteCode = async (
  id: string,
  body: components["schemas"]["RegistrationInvitePatch"],
) =>
  unwrap(
    await api.PATCH("/v1/platform/registration-invite-codes/{invite_id}", {
      params: { path: { invite_id: id } },
      body,
    }),
  );
export const actOnInviteCode = async (
  id: string,
  body: components["schemas"]["RegistrationInviteAction"],
) =>
  unwrap(
    await api.POST(
      "/v1/platform/registration-invite-codes/{invite_id}/actions",
      { params: { path: { invite_id: id } }, body },
    ),
  );
export const revealInviteCode = async (id: string) =>
  unwrap(
    await api.POST(
      "/v1/platform/registration-invite-codes/{invite_id}/secret",
      { params: { path: { invite_id: id } } },
    ),
  );
export const fetchRedemptions = async (id: string, page: number) =>
  unwrap(
    await api.GET(
      "/v1/platform/registration-invite-codes/{invite_id}/redemptions",
      { params: { path: { invite_id: id }, query: { page, page_size: 25 } } },
    ),
  );
export const registerAccount = async (
  body: components["schemas"]["RegistrationIn"],
) => unwrap(await api.POST("/v1/auth/register", { body }));
export const fetchPolicy = async () =>
  unwrap(await api.GET("/v1/platform/permission-policy"));
export const savePolicy = async (
  body: components["schemas"]["PermissionPolicyIn"],
) => unwrap(await api.PATCH("/v1/platform/permission-policy", { body }));
export const fetchQuotas = async () =>
  unwrap(await api.GET("/v1/platform/runtime-quotas"));
export const saveQuotas = async (
  body: components["schemas"]["RuntimeQuotasIn"],
) => unwrap(await api.PATCH("/v1/platform/runtime-quotas", { body }));
export const fetchTemplate = async (role: PlatformRole) =>
  unwrap(
    await api.GET("/v1/platform/model-service-templates/{role}", {
      params: { path: { role } },
    }),
  );
export const saveTemplate = async (
  role: PlatformRole,
  body: components["schemas"]["RoleModelTemplateIn"],
) =>
  unwrap(
    await api.PUT("/v1/platform/model-service-templates/{role}", {
      params: { path: { role } },
      body,
    }),
  );
export const previewTemplate = async (
  role: PlatformRole,
  expected_template_revision: number,
) =>
  unwrap(
    await api.POST("/v1/platform/model-service-templates/{role}/preview", {
      params: { path: { role } },
      body: { expected_template_revision },
    }),
  );
export const fetchSyncJob = async (job_id: string) =>
  unwrap(
    await api.GET("/v1/platform/model-service-templates/sync-jobs/{job_id}", {
      params: { path: { job_id } },
    }),
  );
export const startSyncJob = async (job_id: string, expected_revision: number) =>
  unwrap(
    await api.POST(
      "/v1/platform/model-service-templates/sync-jobs/{job_id}/start",
      { params: { path: { job_id } }, body: { expected_revision } },
    ),
  );
export const fetchDemoServices = async () =>
  unwrap(await api.GET("/v1/platform/demo-services"));
export type DemoService = components["schemas"]["DemoServiceOut"];
export const saveDemoService = async (
  service_id: DemoService["id"],
  body: components["schemas"]["DemoConfigIn"],
) =>
  unwrap(
    await api.PUT("/v1/platform/demo-services/{service_id}", {
      params: { path: { service_id } },
      body,
    }),
  );
export const actOnDemoService = async (
  service_id: DemoService["id"],
  body: components["schemas"]["DemoActionIn"],
) =>
  unwrap(
    await api.POST("/v1/platform/demo-services/{service_id}/actions", {
      params: { path: { service_id } },
      body,
    }),
  );
export const installDemoService = async (
  service_id: DemoService["id"],
  expected_catalog_revision: number,
) =>
  unwrap(
    await api.POST("/v1/account/demo-services/{service_id}/install", {
      params: { path: { service_id } },
      body: { expected_catalog_revision },
    }),
  );

export const fetchLogWorkspaces = async () =>
  unwrap(await api.GET("/v1/account/log-workspaces"));
export const fetchCrossWorkspaceLogs = async (
  workspace: string,
  q: string,
  page: number,
) =>
  unwrap(
    await api.GET("/v1/account/cross-workspace-call-logs", {
      params: { query: { workspace_ids: [workspace], q, page, page_size: 25 } },
    }),
  );
export const fetchSyncHistory = async (role: PlatformRole) =>
  unwrap(
    await api.GET("/v1/platform/model-service-templates/{role}/sync-jobs", {
      params: { path: { role } },
    }),
  );
