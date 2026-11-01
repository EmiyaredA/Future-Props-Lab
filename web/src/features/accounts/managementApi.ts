import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";
export type AccountFilters = {
  q: string;
  status?: "active" | "disabled";
  is_platform_admin?: boolean;
  platform_role?: "admin" | "user";
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
export const fetchAudit = async (query: AuditFilters) =>
  unwrap(await api.GET("/v1/platform/security-events", { params: { query } }));
