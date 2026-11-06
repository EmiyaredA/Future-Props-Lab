import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CreativeApplication from "@app/entries/CreativeApplication";
import { creativePath, creativeRoute } from "@app/entries/creativeRoutes";

const access = vi.hoisted(() => ({ canWrite: false, canInstall: false }));
vi.mock("@platform/auth/AccountAccess", () => ({
  useAccountPermission: (name: string) =>
    name === "content.write" ? access.canWrite : access.canInstall,
}));
vi.mock("@app/entries/IndependentShell", () => ({
  IndependentShell: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("@features/creative-workshop/CreativeWorkshopPage", () => ({
  CreativeWorkshopPage: ({
    mode,
    itemId,
    canWrite,
    canInstall,
  }: {
    mode: string;
    itemId?: string;
    canWrite: boolean;
    canInstall: boolean;
  }) => (
    <section
      aria-label="创意页面"
      data-mode={mode}
      data-item={itemId}
      data-write={canWrite}
      data-install={canInstall}
    />
  ),
}));

afterEach(() => {
  access.canWrite = false;
  access.canInstall = false;
  window.history.replaceState({}, "", "/");
});

test("Creative standalone entry preserves decoded deep links and actual permissions", () => {
  window.history.replaceState(
    {},
    "",
    "/creative-workshop/edit/%E5%88%9B%E4%BD%9C?keep=1",
  );
  const view = render(<CreativeApplication />);
  const page = screen.getByRole("region", { name: "创意页面" });
  expect(page).toHaveAttribute("data-mode", "creative-workshop-editor");
  expect(page).toHaveAttribute("data-item", "创作");
  expect(page).toHaveAttribute("data-write", "false");
  access.canWrite = true;
  access.canInstall = true;
  view.rerender(<CreativeApplication />);
  expect(page).toHaveAttribute("data-write", "true");
  expect(page).toHaveAttribute("data-install", "true");
  expect(location.search).toBe("?keep=1");
  expect(creativePath("creative-workshop-detail", "创作/id")).toBe(
    "/creative-workshop/item/%E5%88%9B%E4%BD%9C%2Fid",
  );
});

test("invalid Creative URLs show a recoverable page", () => {
  expect(creativeRoute("/creative-workshop/edit/%ZZ")).toBeNull();
  window.history.replaceState({}, "", "/creative-workshop/unknown");
  render(<CreativeApplication />);
  expect(screen.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  expect(screen.getByRole("link", { name: "返回创意工坊" })).toHaveAttribute(
    "href",
    "/creative-workshop",
  );
});
