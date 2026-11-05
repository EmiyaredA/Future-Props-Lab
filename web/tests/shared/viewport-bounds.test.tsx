import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ViewportBounds } from "@shared/ui/ViewportBounds";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("style");
});

test("an open menu follows the visible viewport when an input keyboard reduces it", async () => {
  const viewport = Object.assign(new EventTarget(), {
    height: 640,
    offsetTop: 0,
  });
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("innerWidth", 390);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 280,
    y: 500,
    top: 500,
    bottom: 532,
    left: 280,
    right: 380,
    width: 100,
    height: 32,
    toJSON: () => ({}),
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return Math.min(180, Number.parseFloat(this.style.maxHeight) || 180);
    },
  );
  const { unmount } = render(
    <>
      <ViewportBounds />
      <CustomSelect
        ariaLabel="插入类型"
        value="table"
        options={[
          { value: "table", label: "表格" },
          { value: "image", label: "图片" },
        ]}
        onChange={() => {}}
      />
    </>,
  );
  await userEvent.click(screen.getByRole("combobox"));
  const menu = screen.getByRole("listbox");
  expect(
    Number.parseFloat(menu.style.left) + Number.parseFloat(menu.style.width),
  ).toBeLessThanOrEqual(378);
  act(() => {
    viewport.height = 220;
    viewport.offsetTop = 400;
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(
    document.documentElement.style.getPropertyValue("--visible-height"),
  ).toBe("220px");
  expect(document.documentElement.style.getPropertyValue("--visible-top")).toBe(
    "400px",
  );
  expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(412);
  expect(
    Number.parseFloat(menu.style.top) + menu.offsetHeight,
  ).toBeLessThanOrEqual(608);
  expect(menu).toBeVisible();
  unmount();
  act(() => {
    viewport.height = 100;
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(
    document.documentElement.style.getPropertyValue("--visible-height"),
  ).toBe("220px");
});
