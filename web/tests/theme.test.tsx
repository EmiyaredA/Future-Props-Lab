import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "@shared/ui/ThemeToggle";

test("persists light and dark appearance", () => {
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole("button", { name: "深色" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("future_props_theme")).toBe("dark");
  fireEvent.click(screen.getByRole("button", { name: "浅色" }));
  expect(document.documentElement.dataset.theme).toBe("light");
});
