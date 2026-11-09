import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { IndependentShell } from "@app/entries/IndependentShell";

vi.mock("@app/StudioSession", () => ({
  useStudioSession: () => ({ me: { user: { id: "test-owner" } } }),
}));
vi.mock("@platform/auth/AccountAccess", () => ({
  useAccountPermission: () => true,
}));
vi.mock("@shared/ui/NavigationProtection", () => ({
  NavigationProtection: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@app/layout/StudioSidebar", () => ({
  StudioShell: ({
    page,
    navigate,
    assistant,
    children,
  }: {
    page: string;
    navigate: (page: string) => void;
    assistant: (() => void) | null;
    children: ReactNode;
  }) => (
    <div
      data-testid="studio-shell"
      data-page={page}
      data-assistant={Boolean(assistant)}
    >
      <button onClick={() => navigate("files")}>文件管理</button>
      {children}
    </div>
  ),
}));
vi.mock("@app/entries/ApplicationUpdate", () => ({
  ApplicationUpdate: () => null,
}));

afterEach(() => window.history.replaceState({}, "", "/"));

test("顶层独立入口使用 Studio 导航并保留导航拦截", () => {
  window.history.replaceState({}, "", "/cloud-control");
  const prevent = vi.fn((event: Event) => event.preventDefault());
  window.addEventListener("future-props:before-navigation", prevent);
  render(<IndependentShell title="门户">内容</IndependentShell>);
  expect(screen.getByTestId("studio-shell")).toHaveAttribute(
    "data-page",
    "cloud-control",
  );
  expect(screen.getByTestId("studio-shell")).toHaveAttribute(
    "data-assistant",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "文件管理" }));
  expect(prevent).toHaveBeenCalledOnce();
  window.removeEventListener("future-props:before-navigation", prevent);
});

test("文件管理独立入口选中侧边栏并提供 Amadeus 入口", () => {
  window.history.replaceState({}, "", "/files");
  render(<IndependentShell title="文件管理">文件内容</IndependentShell>);
  expect(screen.getByTestId("studio-shell")).toHaveAttribute(
    "data-page",
    "files",
  );
  expect(screen.getByTestId("studio-shell")).toHaveAttribute(
    "data-assistant",
    "true",
  );
  expect(screen.getByText("文件内容")).toBeVisible();
});
