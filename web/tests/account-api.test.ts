import { beforeEach, expect, test, vi } from "vitest";
import {
  createApiKey,
  deleteApiKey,
  inviteWorkspaceMember,
  renewApiKey,
  switchWorkspace,
  updateProfile,
} from "@features/accounts/api";

const client = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  PUT: vi.fn(),
  DELETE: vi.fn(),
}));

vi.mock("@platform/api/client", () => ({
  api: client,
  unwrap: vi.fn(async (result) => result.data),
}));

beforeEach(() => {
  vi.clearAllMocks();
  client.POST.mockResolvedValue({ data: {} });
  client.PATCH.mockResolvedValue({ data: {} });
  client.DELETE.mockResolvedValue({ data: undefined });
});

test("uses the generated account routes for workspace and profile mutations", async () => {
  await switchWorkspace("workspace-2");
  expect(client.POST).toHaveBeenCalledWith("/v1/account/workspaces/switch", {
    body: { workspace_id: "workspace-2" },
  });

  await updateProfile("新名字", "user@example.com", 4);
  expect(client.PATCH).toHaveBeenCalledWith("/v1/account/profile", {
    body: {
      display_name: "新名字",
      email: "user@example.com",
      expected_revision: 4,
    },
  });
});

test("keeps invitation and one-time API key creation on the shared client", async () => {
  await inviteWorkspaceMember("developer");
  expect(client.POST).toHaveBeenCalledWith(
    "/v1/account/workspaces/current/invitations",
    { body: { username: "developer", role: "member" } },
  );

  await createApiKey("交付密钥", ["studio:read", "studio:write"], 180);
  expect(client.POST).toHaveBeenCalledWith("/v1/account/api-keys", {
    body: {
      name: "交付密钥",
      scopes: ["studio:read", "studio:write"],
      expires_in_days: 180,
    },
  });

  const key = {
    id: "key-1",
    name: "交付密钥",
    key_prefix: "fpm_example",
    scopes: ["studio:read"],
    expires_at: "2026-12-01T00:00:00Z",
    last_used_at: null,
    revoked_at: null,
    revision: 3,
    created_at: "2026-09-01T00:00:00Z",
  };
  await renewApiKey(key, 30);
  expect(client.POST).toHaveBeenCalledWith(
    "/v1/account/api-keys/{key_id}/renew",
    {
      params: { path: { key_id: "key-1" } },
      body: { expected_revision: 3, expires_in_days: 30 },
    },
  );
  await deleteApiKey(key);
  expect(client.DELETE).toHaveBeenCalledWith("/v1/account/api-keys/{key_id}", {
    params: { path: { key_id: "key-1" } },
    body: { expected_revision: 3 },
  });
});
