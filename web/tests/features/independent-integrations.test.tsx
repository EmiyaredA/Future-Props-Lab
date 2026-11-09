import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import IntegrationsApplication from "@app/entries/IntegrationsApplication";

const access = vi.hoisted(() => ({
  canManage: false,
  register: vi.fn(),
  unregister: vi.fn(),
}));
vi.mock("@platform/auth/AccountAccess", () => ({
  useAccountPermission: () => access.canManage,
}));
vi.mock("@shared/ui/navigationGuards", () => ({
  useNavigationProtection: () => ({ register: access.register }),
}));
vi.mock("@app/entries/StudioServiceShell", () => ({
  StudioServiceShell: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("@features/integrations/IntegrationCenterPage", () => ({
  IntegrationCenterPage: ({
    kind,
    canManage,
  }: {
    kind: string;
    canManage: boolean;
  }) => (
    <section aria-label="集成页面" data-kind={kind} data-manage={canManage} />
  ),
}));

afterEach(() => {
  access.canManage = false;
  window.history.replaceState({}, "", "/");
});

test("integration entry preserves deep links and read-only permissions", () => {
  window.history.replaceState(
    {},
    "",
    "/integrations/mcp?resource=owned&view=tools",
  );
  const view = render(<IntegrationsApplication />);
  const page = screen.getByRole("region", { name: "集成页面" });
  expect(page).toHaveAttribute("data-kind", "mcp");
  expect(page).toHaveAttribute("data-manage", "false");
  access.canManage = true;
  view.rerender(<IntegrationsApplication />);
  expect(page).toHaveAttribute("data-manage", "true");
  expect(location.search).toBe("?resource=owned&view=tools");
});

test("unknown integration pages show a recoverable navigation", () => {
  window.history.replaceState({}, "", "/integrations/missing");
  render(<IntegrationsApplication />);
  expect(screen.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  expect(screen.getByRole("link", { name: "返回集成中心" })).toHaveAttribute(
    "href",
    "/integrations",
  );
});
