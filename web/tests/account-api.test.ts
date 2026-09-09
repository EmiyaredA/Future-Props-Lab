import { beforeEach, expect, test, vi } from "vitest";
import {
  createApiKey,
  inviteWorkspaceMember,
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

  await createApiKey("交付密钥", ["studio:read", "studio:write"]);
  expect(client.POST).toHaveBeenCalledWith("/v1/account/api-keys", {
    body: {
      name: "交付密钥",
      scopes: ["studio:read", "studio:write"],
      expires_in_days: 90,
    },
  });
});
