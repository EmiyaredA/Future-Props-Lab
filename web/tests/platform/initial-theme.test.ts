import { afterEach, expect, test, vi } from "vitest";
import { themeBootstrap } from "../../themeBootstrap";
import { loadTheme, THEME_KEY } from "@shared/ui/themePreference";

afterEach(() => vi.restoreAllMocks());

async function bootstrap() {
  const hook = themeBootstrap().transformIndexHtml;
  if (!hook || typeof hook === "function")
    throw new Error("Missing HTML bootstrap hook");
  const tags: Awaited<ReturnType<typeof hook.handler>> = await Reflect.apply(
    hook.handler,
    undefined,
    ["<html></html>", { path: "/visual.html", filename: "/visual.html" }],
  );
  if (!Array.isArray(tags)) throw new Error("Missing startup tags");
  const script = tags.find((tag) => tag.tag === "script");
  expect(tags.find((tag) => tag.tag === "style")?.injectTo).toBe(
    "head-prepend",
  );
  // Execute the actual serialized HTML script, without importing its React runtime.
  new Function(String(script?.children))();
}

test.each([
  ["dark", false, "dark"],
  ["light", true, "light"],
  [null, true, "dark"],
  [null, false, "light"],
  ["unknown", true, "dark"],
] as const)(
  "HTML and runtime agree for stored=%s, system dark=%s",
  async (stored, dark, expected) => {
    if (stored !== null) localStorage.setItem(THEME_KEY, stored);
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: dark,
    } as MediaQueryList);
    await bootstrap();
    expect(document.documentElement.dataset.theme).toBe(expected);
    expect(loadTheme()).toBe(expected);
    expect(localStorage.getItem(THEME_KEY)).toBe(stored);
  },
);

test("storage denial still initializes the system theme without a module dependency", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Denied", "SecurityError");
  });
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
  } as MediaQueryList);
  await bootstrap();
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(loadTheme()).toBe("dark");
});
