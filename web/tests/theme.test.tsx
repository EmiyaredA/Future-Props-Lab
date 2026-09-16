import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { ThemeToggle } from "@shared/ui/ThemeToggle";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

test("persists light and dark appearance", () => {
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole("button", { name: "深色" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("future_props_theme")).toBe("dark");
  fireEvent.click(screen.getByRole("button", { name: "浅色" }));
  expect(document.documentElement.dataset.theme).toBe("light");
});

test("follows the system appearance until the user chooses a theme", () => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("dark"),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  })) as typeof window.matchMedia;

  render(<ThemeToggle />);
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("future_props_theme")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "浅色" }));
  expect(localStorage.getItem("future_props_theme")).toBe("light");
});
