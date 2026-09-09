import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";
export type AccountFilters = {
  q: string;
  status?: "active" | "disabled";
  is_platform_admin?: boolean;
  platform_role?: "super_admin" | "admin" | "member";
  page: number;
  page_size: number;
};
export type WorkspaceFilters = {
  q: string;
  visibility?: "private" | "public";
  page: number;
  page_size: number;
};
export type AuditFilters = {
  event_type: string;
  actor_query: string;
  target_query: string;
  from_date?: string;
  to_date?: string;
  page: number;
  page_size: number;
};
export const fetchManagedAccounts = async (query: AccountFilters) =>
  unwrap(await api.GET("/v1/platform/accounts", { params: { query } }));
export const fetchManagedWorkspaces = async (query: WorkspaceFilters) =>
  unwrap(await api.GET("/v1/platform/workspaces", { params: { query } }));
export const createManagedAccount = async (
  body: components["schemas"]["AccountCreateIn"],
) => unwrap(await api.POST("/v1/platform/accounts", { body }));
export const patchManagedAccount = async (
  id: string,
  body: components["schemas"]["AccountPatchIn"],
) =>
  unwrap(
    await api.PATCH("/v1/platform/accounts/{user_id}", {
      params: { path: { user_id: id } },
      body,
    }),
  );
export const createManagedWorkspace = async (
  body: components["schemas"]["WorkspaceCreateIn"],
) => unwrap(await api.POST("/v1/platform/workspaces", { body }));
export const patchMemberRole = async (
  id: string,
  body: components["schemas"]["WorkspaceMemberRoleIn"],
) =>
  unwrap(
    await api.PATCH("/v1/account/workspaces/current/members/{membership_id}", {
      params: { path: { membership_id: id } },
      body,
    }),
  );
export const fetchAudit = async (
  workspaceId: string | null,
  query: AuditFilters,
) =>
  workspaceId
    ? unwrap(
        await api.GET("/v1/account/workspaces/current/audit-events", {
          params: { query },
        }),
      )
    : unwrap(
        await api.GET("/v1/platform/security-events", { params: { query } }),
      );
