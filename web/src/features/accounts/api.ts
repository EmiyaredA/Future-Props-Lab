import { createUploadTransfer } from "@platform/api/transfer";
import { type TransferOptions } from "@platform/api/transfer";
import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type AuthMe = components["schemas"]["AuthMeOut"];
export type AccountSession = components["schemas"]["AccountSessionOut"];
export type ApiKey = components["schemas"]["ApiKeyOut"];
export type ManagedAccount = components["schemas"]["AccountOut"];
export type SecurityEvent = components["schemas"]["SecurityAuditEventOut"];
export type AccountSessionContext = {
  me: AuthMe;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

export const getMe = async () => unwrap(await api.GET("/v1/auth/me"));

export const login = async (username: string, password: string) =>
  unwrap(await api.POST("/v1/auth/login", { body: { username, password } }));

export const logout = async () => unwrap(await api.POST("/v1/auth/logout"));

export const changePassword = async (
  currentPassword: string,
  newPassword: string,
) =>
  unwrap(
    await api.POST("/v1/auth/change-password", {
      body: {
        current_password: currentPassword,
        new_password: newPassword,
      },
    }),
  );

export const reauthenticate = async (password: string) =>
  unwrap(await api.POST("/v1/auth/reauth", { body: { password } }));

export const updateProfile = async (
  displayName: string,
  email: string | null,
  expectedRevision: number,
) =>
  unwrap(
    await api.PATCH("/v1/account/profile", {
      body: {
        display_name: displayName,
        email,
        expected_revision: expectedRevision,
      },
    }),
  );

export const putAvatar = async (
  file: File,
  expectedRevision: number,
  transfer: TransferOptions = {},
) => {
  const uploadTransfer = createUploadTransfer(transfer.onProgress);
  return unwrap(
    await api.PUT("/v1/account/profile/avatar", {
      fetch: uploadTransfer.fetch,
      body: {
        file: file as unknown as string,
        expected_revision: expectedRevision,
      },
      bodySerializer() {
        const form = new FormData();
        form.set("file", file);
        form.set("expected_revision", String(expectedRevision));
        return uploadTransfer.capture(form);
      },
    }),
  );
};

export const deleteAvatar = async (expectedRevision: number) =>
  unwrap(
    await api.DELETE("/v1/account/profile/avatar", {
      body: { expected_revision: expectedRevision },
    }),
  );

export const listAccountSessions = async () =>
  unwrap(await api.GET("/v1/account/sessions"));

export const deleteAccountSession = async (sessionId: string) =>
  unwrap(
    await api.DELETE("/v1/account/sessions/{session_id}", {
      params: { path: { session_id: sessionId } },
    }),
  );

export const revokeOtherSessions = async () =>
  unwrap(await api.POST("/v1/account/sessions/revoke-others"));

export const listApiKeys = async () =>
  unwrap(await api.GET("/v1/account/api-keys"));

export const createApiKey = async (
  name: string,
  scopes: ("studio:read" | "studio:write")[],
  expiresInDays: number,
) =>
  unwrap(
    await api.POST("/v1/account/api-keys", {
      body: { name, scopes, expires_in_days: expiresInDays },
    }),
  );

export const revokeApiKey = async (key: ApiKey) =>
  unwrap(
    await api.POST("/v1/account/api-keys/{key_id}/revoke", {
      params: { path: { key_id: key.id } },
      body: { expected_revision: key.revision },
    }),
  );

export const renewApiKey = async (key: ApiKey, expiresInDays: number) =>
  unwrap(
    await api.POST("/v1/account/api-keys/{key_id}/renew", {
      params: { path: { key_id: key.id } },
      body: {
        expected_revision: key.revision,
        expires_in_days: expiresInDays,
      },
    }),
  );

export const deleteApiKey = async (key: ApiKey) =>
  unwrap(
    await api.DELETE("/v1/account/api-keys/{key_id}", {
      params: { path: { key_id: key.id } },
      body: { expected_revision: key.revision },
    }),
  );

export const listSecurityEvents = async () =>
  unwrap(await api.GET("/v1/account/security-events"));

export const listPlatformAccounts = async () =>
  unwrap(await api.GET("/v1/platform/accounts"));

export const createPlatformAccount = async (
  username: string,
  displayName: string,
) =>
  unwrap(
    await api.POST("/v1/platform/accounts", {
      body: { username, display_name: displayName, is_platform_admin: false },
    }),
  );

export const updatePlatformAccount = async (
  account: ManagedAccount,
  status: ManagedAccount["status"],
) =>
  unwrap(
    await api.PATCH("/v1/platform/accounts/{user_id}", {
      params: { path: { user_id: account.id } },
      body: { status, expected_revision: account.revision },
    }),
  );

export const resetPlatformAccountPassword = async (account: ManagedAccount) =>
  unwrap(
    await api.POST("/v1/platform/accounts/{user_id}/reset-password", {
      params: { path: { user_id: account.id } },
      body: { expected_revision: account.revision },
    }),
  );
