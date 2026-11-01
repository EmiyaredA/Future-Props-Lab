import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PageErrorBoundary } from "../src/app/PageErrorBoundary";
import { recoverPage } from "../src/app/recovery";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("contains a rendering failure and asks before leaving the failed editor", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  function Broken(): never {
    throw new Error("test render failure");
  }
  render(
    <PageErrorBoundary>
      <Broken />
    </PageErrorBoundary>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("test render failure");
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  expect(screen.getByText(/确认可以放弃/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "留在此页" }));
  expect(screen.queryByRole("button", { name: "确认继续" })).toBeNull();
});
it("lets the active navigation guard veto recovery without replaying a write", () => {
  const guard = vi.fn((e: Event) => e.preventDefault());
  window.addEventListener("future-props:before-navigation", guard);
  recoverPage();
  expect(guard).toHaveBeenCalledOnce();
  window.removeEventListener("future-props:before-navigation", guard);
});
